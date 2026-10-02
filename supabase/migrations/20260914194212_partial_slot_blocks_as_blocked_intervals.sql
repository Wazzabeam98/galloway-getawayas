-- Partial slot blocks — a provider closes PART of a day, not just the whole one.
--
-- WHAT THIS IS. A yoga teacher free Tuesday afternoon but not the morning, a
-- masseuse blocking lunch, a sauna closing for a service, a tasting room shut for
-- a private function. Today slot_blocks closes a WHOLE date; this adds a block
-- that occupies a TIME RANGE within a date.
--
-- WHY IT LIVES IN slot_sessions, NOT A NEW TABLE. The booking engine already has
-- an authoritative non-overlap guard: slot_sessions_no_overlap refuses two BOOKED
-- sessions for one provider on one date whose block_minutes intervals overlap
-- (20260914120000). A partial block is, almost exactly, "a session nobody paid
-- for": it occupies [start, start+length) on the provider's day and nothing else
-- may. Modelling it as a slot_sessions row means a booking inside a block, and a
-- block over a booking, are BOTH refused by the same database constraint — no
-- second interval engine, and every slot category gets it for free.
--
-- WHERE THE NAIVE VERSION BREAKS, AND THE FIX. The exclusion's predicate is
-- `where (seats_taken > 0)` — literally "has a paid booking". An unpaid row
-- (seats_taken = 0) is the empty-placeholder case the guard deliberately IGNORES,
-- so a block left at seats_taken = 0 would block nothing. So a block is NOT just
-- an unpaid session; it needs a mark, and the predicate must count it. This adds
-- a `blocked` flag and widens the predicate to `(seats_taken > 0 OR blocked)`.
-- Now a block participates in the exclusion without pretending to be a booking:
-- it carries no seats, no capacity beyond the minimum, no payment.
--
-- TEST ONLY, like the two migrations it builds on. Must not merge to master until
-- it has reached production (the deploy-time gate enforces that on production
-- builds; preview builds fail open). Additive and idempotent; safe to run twice.

-- btree_gist backs the exclusion; created already by 20260914120000, harmless here.
create extension if not exists btree_gist;

-- --------------------------------------------------------------------------
-- 1. The mark. A blocked row occupies its interval but is not a booking: no
--    seats, capacity stays at its floor of 1 (never offered), private is
--    meaningless. Default false: every existing row is a real session, unchanged.
-- --------------------------------------------------------------------------
alter table public.slot_sessions
    add column if not exists blocked boolean not null default false;

-- A block must have a length, or block_minutes is an empty range that overlaps
-- nothing — a silent hole. (The booked-session equivalent is enforced by
-- slot_sessions_booked_has_duration; seats_taken = 0 lets a block past that one,
-- so a block needs its own.) And a block never carries a paid seat: the two
-- concepts are disjoint — a row is a booking xor a block.
alter table public.slot_sessions
    drop constraint if exists slot_sessions_block_has_duration;
alter table public.slot_sessions
    add constraint slot_sessions_block_has_duration
        check (not blocked or duration_minutes is not null);
alter table public.slot_sessions
    drop constraint if exists slot_sessions_block_has_no_seats;
alter table public.slot_sessions
    add constraint slot_sessions_block_has_no_seats
        check (not (blocked and seats_taken > 0));

-- --------------------------------------------------------------------------
-- 2. Widen the guard to count blocks. A block is now a participating interval:
--    a booking whose interval overlaps it is refused (the establishing seat CAS
--    raises exclusion_violation, exactly as it does against another booking), and
--    a block whose interval overlaps a booked session is refused on INSERT — so a
--    block can never silently shadow a booking someone has already paid for. The
--    predicate is the only change; the columns it ranges over are unchanged, so a
--    fixed-grid provider with no blocks behaves exactly as before.
-- --------------------------------------------------------------------------
alter table public.slot_sessions
    drop constraint if exists slot_sessions_no_overlap;
alter table public.slot_sessions
    add constraint slot_sessions_no_overlap
        exclude using gist (
            provider_id with =,
            session_date with =,
            block_minutes with &&
        )
        where (seats_taken > 0 or blocked);

comment on column public.slot_sessions.blocked is
    'True for a PARTIAL BLOCK: a provider-created row that occupies [start, '
    'start+duration) on the day so nothing may be booked there. Carries no seats '
    '(seats_taken = 0) and no payment; it exists only to hold the interval. '
    'Counted by slot_sessions_no_overlap so a booking inside it, and it over a '
    'booking, are both refused by the database.';
comment on constraint slot_sessions_no_overlap on public.slot_sessions is
    'Authoritative non-overlap guard: for one provider on one date, no two rows '
    'that are either BOOKED (seats_taken > 0) or a BLOCK (blocked) may hold '
    'overlapping block_minutes. Reduces to a no-op for a fixed-grid provider with '
    'no blocks; bites per-treatment overlaps and every partial block.';

-- PostgREST caches the schema; the new column is invisible over the API (written
-- and read under the service role) until it reloads.
notify pgrst, 'reload schema';

-- Read back (after --apply --read, or by hand on test):
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--    where table_name='slot_sessions' and column_name='blocked';
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.slot_sessions'::regclass and conname like 'slot_sessions_%'
--    order by conname;
