-- The interval-overlap guard — the authoritative half of the per-treatment
-- duration work. This is the money-correctness core.
--
-- WHAT THE PRIOR MIGRATION LEFT OPEN. 20260913210406 gave the rows the columns an
-- overlap check needs (per-item duration_minutes on the item, session and order;
-- a per-provider slot_turnaround_minutes) and said, in writing, that the guard's
-- SHAPE was a decision for a human. The decision: the DATABASE is the authority.
-- The claim carries a friendly in-app check for the message and the greying, but
-- it must NOT be the real guard — a race that slips past app code, or a future
-- code path that forgets it, must still be refused. So the non-overlap invariant
-- lives here as a constraint the database enforces on every booked row, the same
-- way seats_taken <= capacity already does.
--
-- HOW IT WORKS. A booked session blocks a minutes-of-the-day interval on its
-- provider's day: [start, start + duration + turnaround). Two BOOKED sessions for
-- the same provider on the same date may not overlap that interval. A fixed-grid
-- provider (one length, turnaround 0) tiles the day in adjacent, non-overlapping
-- intervals, so this reduces to today's behaviour for sauna/tasting/class and
-- changes nothing for them. A one-at-a-time provider (per-treatment durations)
-- has variable-length intervals that CAN overlap — and now cannot both commit.
--
-- WHY A PARTIAL EXCLUSION (seats_taken > 0). Sessions materialise as empty
-- placeholders (seats_taken = 0) before the establishing claim fills them, and a
-- cancellation reopens a row to 0. Those rows hold no booking and must not block
-- anything; the seats_taken > 0 predicate scopes the guard to sessions that are
-- actually booked, exactly the rows seats_taken already governs.
--
-- FROZEN AT CLAIM. duration_minutes is pinned on the session by the claim (from
-- item.duration_minutes ?? provider.slot_length_minutes) and turnaround_minutes
-- is copied onto the session here too — so a host later editing a treatment's
-- length or their reset gap never changes what an ALREADY-booked session blocks.
-- The block interval is a stored generated column off those two frozen numbers.
--
-- TEST ONLY, like the migration it builds on. It must not merge to master until
-- both have reached production (the deploy-time gate enforces that on production
-- builds; preview builds fail open). Additive and idempotent; safe to run twice.

-- GiST equality opclasses for uuid/date, so the exclusion can say "same provider,
-- same date" alongside the range overlap. btree_gist is a standard contrib
-- extension; create is idempotent.
create extension if not exists btree_gist;

-- --------------------------------------------------------------------------
-- 1. Freeze the reset gap onto the session. Turnaround is a provider property,
--    but what a booked session BLOCKS must outlive a later change to it — so the
--    claim copies the provider's slot_turnaround_minutes here when it establishes
--    the session, and the block interval below is computed from this frozen copy,
--    never from the live provider row. Default 0: every existing row, and every
--    category with no reset gap, blocks exactly its duration.
-- --------------------------------------------------------------------------
alter table public.slot_sessions
    add column if not exists turnaround_minutes integer not null default 0
        check (turnaround_minutes >= 0);

-- --------------------------------------------------------------------------
-- 2. A booked session must know its length, or its block interval would be a
--    zero-length range that overlaps nothing — a silent hole in the guard. Empty
--    placeholders (seats_taken = 0) may still be NULL before the establishing
--    claim pins the length. NOT VALID so a stray legacy row (a slot provider that
--    never had a slot_length_minutes to backfill from) cannot fail this migration;
--    it still bites every INSERT and UPDATE from here on, which is what protects
--    new bookings.
-- --------------------------------------------------------------------------
alter table public.slot_sessions
    add constraint slot_sessions_booked_has_duration
        check (seats_taken = 0 or duration_minutes is not null) not valid;

-- --------------------------------------------------------------------------
-- 3. The interval this session blocks, in minutes from midnight:
--    [start, start + duration + turnaround). Generated + stored so it always
--    tracks the two frozen numbers and can be indexed by the exclusion below. A
--    NULL/absent duration yields an empty range (lower = upper), which overlaps
--    nothing — the placeholder case, harmless and also screened out by the
--    partial predicate.
-- --------------------------------------------------------------------------
alter table public.slot_sessions
    add column if not exists block_minutes int4range
        generated always as (
            int4range(
                (extract(hour from session_time) * 60 + extract(minute from session_time))::int,
                (extract(hour from session_time) * 60 + extract(minute from session_time))::int
                    + coalesce(duration_minutes, 0) + coalesce(turnaround_minutes, 0),
                '[)'
            )
        ) stored;

-- --------------------------------------------------------------------------
-- 4. THE GUARD. No two BOOKED sessions for one provider on one date may hold
--    overlapping block intervals. This is the authority; the claim's in-app check
--    is only a courtesy on top of it. A concurrent pair that both pass the app
--    check race here instead, and exactly one commits — the other's UPDATE raises
--    exclusion_violation (SQLSTATE 23P01), which the claim turns into the same
--    "that time just filled up" the seat guard already returns.
-- --------------------------------------------------------------------------
alter table public.slot_sessions
    add constraint slot_sessions_no_overlap
        exclude using gist (
            provider_id with =,
            session_date with =,
            block_minutes with &&
        )
        where (seats_taken > 0);

-- --------------------------------------------------------------------------
-- Comments.
-- --------------------------------------------------------------------------
comment on column public.slot_sessions.turnaround_minutes is
    'The provider''s reset gap, frozen onto the session by the establishing claim '
    'so a later change to slot_turnaround_minutes cannot alter what this booking '
    'blocks. Folded into block_minutes, never into the displayed duration.';
comment on column public.slot_sessions.block_minutes is
    'Generated [start, start + duration + turnaround) in minutes from midnight — '
    'the interval this session blocks on the provider''s day. Empty when unbooked. '
    'Backs the slot_sessions_no_overlap exclusion constraint.';
comment on constraint slot_sessions_no_overlap on public.slot_sessions is
    'Authoritative non-overlap guard: two booked sessions for one provider on one '
    'date cannot hold overlapping block_minutes. Reduces to a no-op for fixed-grid '
    '(one-length, zero-turnaround) providers; bites the per-treatment shape.';

-- PostgREST caches the schema; the new columns are invisible over the API (the
-- claim writes turnaround_minutes through it under the service role) until it
-- reloads.
notify pgrst, 'reload schema';

-- Read back (after --apply --read, or by hand on test):
--   -- the two new columns and the block range exist:
--   select column_name, data_type, is_generated
--     from information_schema.columns
--    where table_name='slot_sessions'
--      and column_name in ('turnaround_minutes','block_minutes') order by 1;
--   -- the exclusion + check constraints are present:
--   select conname, contype from pg_constraint
--    where conrelid='public.slot_sessions'::regclass
--      and conname in ('slot_sessions_no_overlap','slot_sessions_booked_has_duration')
--    order by 1;
--   -- btree_gist is installed:
--   select extname from pg_extension where extname='btree_gist';
