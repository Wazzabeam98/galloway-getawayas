-- A dated class — a slot_sessions row with an identity that reserves its interval.
--
-- WHAT THIS IS. The weekly template can only say "every Thursday 7–9pm"; it
-- cannot say "a class this Thursday 7pm, and the next one a fortnight on Tuesday",
-- nor a one-off, nor a monthly. A dated class is a specific, named, dated session
-- with its own capacity that EXISTS BEFORE anyone books it — announced, visible at
-- zero seats, holding its time so an open-hours booking can't land on top of it.
--
-- WHY IT LIVES IN slot_sessions (scope decision 1). The collision core is already
-- dated-interval-native: slot_sessions_no_overlap refuses two rows for one
-- provider on one date whose block_minutes overlap (20260914120000), and a partial
-- block already rides it as "a row that occupies its interval without being a
-- booking" (20260914194212). A dated class is the same shape — a pre-created row
-- that reserves [start, start+duration+turnaround) — but UNLIKE a block it carries
-- a real capacity and an identity, and is offered to guests. Modelling it as a
-- slot_sessions row keeps ONE collision source: a booking inside a class, a class
-- over a booking, and a class over a block are all refused by the same constraint.
-- No second interval engine.
--
-- WHAT THIS MIGRATION IS (piece one of three). This is the DECLARATION PRIMITIVE
-- and its RESERVATION only — the columns that give a session a class identity, and
-- the one predicate change that makes a declared class hold its time even at zero
-- seats. It does NOT add the scheduler that creates classes, nor the guest
-- timetable that books them; those are the next two pieces. Until they land, a
-- class row is created out-of-band (a script) and its only visible effect is that
-- the open-hours grid can no longer offer, and the database can no longer accept,
-- a booking overlapping it.
--
-- THE GAP THE NAIVE VERSION LEAVES, AND THE FIX. The exclusion fires only
-- `where (seats_taken > 0 or blocked)` — a class announced at zero seats is
-- neither, so a naive class row would reserve nothing and a guest could book a
-- private hour straight over an empty-but-announced class. So a class needs its
-- own mark that the predicate counts. This adds `is_class` and widens the
-- predicate to `(seats_taken > 0 or blocked or is_class)` — the same move the
-- partial-block migration made for `blocked`, for the same reason.
--
-- TEST ONLY, like the slot migrations it builds on. It must not merge to master
-- until it has reached production (the deploy-time gate enforces that on
-- production builds; preview builds fail open). Additive and idempotent.

-- btree_gist backs the exclusion; created already by 20260914120000, harmless here.
create extension if not exists btree_gist;

-- --------------------------------------------------------------------------
-- 1. The mark and the identity. `is_class` distinguishes a declared class (a
--    real, bookable, capacity-bearing session created up front) from an
--    open-hours session materialised lazily on first booking. `title` is the
--    class's name — the identity an open hour has never had. Default false / null:
--    every existing row is an ordinary session, unchanged.
-- --------------------------------------------------------------------------
alter table public.slot_sessions
    add column if not exists is_class boolean not null default false;
alter table public.slot_sessions
    add column if not exists title text;

-- A class must have a length, or its block_minutes is an empty range that reserves
-- nothing — the same silent hole a booked session and a block each guard against.
-- (seats_taken = 0 lets a fresh class past slot_sessions_booked_has_duration, so a
-- class needs its own.)
alter table public.slot_sessions
    drop constraint if exists slot_sessions_class_has_duration;
alter table public.slot_sessions
    add constraint slot_sessions_class_has_duration
        check (not is_class or duration_minutes is not null);

-- A row is a class XOR a block: a block holds a closed interval with no offer, a
-- class holds an OPEN interval that is exactly the thing being offered. They are
-- disjoint marks, never both on one row.
alter table public.slot_sessions
    drop constraint if exists slot_sessions_class_not_block;
alter table public.slot_sessions
    add constraint slot_sessions_class_not_block
        check (not (is_class and blocked));

-- --------------------------------------------------------------------------
-- 2. Widen the guard to count declared classes. A class now reserves its interval
--    whether or not anyone has booked it: a booking (or block, or other class)
--    whose interval overlaps it is refused, exactly as it is against a booked
--    session. The predicate is the only change; the columns it ranges over are
--    unchanged, so a fixed-grid provider with no classes behaves exactly as
--    before. (Two rows at the SAME start are still stopped by the existing
--    unique(provider_id, session_date, session_time); the exclusion adds the
--    overlapping-but-different-start case.)
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
        where (seats_taken > 0 or blocked or is_class);

comment on column public.slot_sessions.is_class is
    'True for a DATED CLASS: a provider-declared, capacity-bearing session created '
    'up front (before any booking), with an identity (title). Unlike a block it is '
    'offered to guests and carries real seats; unlike an open hour it exists at '
    'zero seats and reserves its interval. Counted by slot_sessions_no_overlap so '
    'an open-hours booking cannot land on top of an announced class.';
comment on column public.slot_sessions.title is
    'A dated class''s name — the identity an open-hours session has never had. '
    'NULL for an ordinary session or a block.';
comment on constraint slot_sessions_no_overlap on public.slot_sessions is
    'Authoritative non-overlap guard: for one provider on one date, no two rows '
    'that are BOOKED (seats_taken > 0), a BLOCK (blocked), or a declared CLASS '
    '(is_class) may hold overlapping block_minutes. No-op for a fixed-grid '
    'provider with none of these; bites per-treatment overlaps, partial blocks, '
    'and any booking overlapping an announced class.';

-- PostgREST caches the schema; the new columns are written and read under the
-- service role and are invisible over the API until it reloads.
notify pgrst, 'reload schema';

-- Read back (after --apply --read, or by hand on test):
--   -- the two new columns exist:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_name='slot_sessions' and column_name in ('is_class','title') order by 1;
--   -- the exclusion predicate now counts is_class, and the class checks exist:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.slot_sessions'::regclass
--      and conname in ('slot_sessions_no_overlap','slot_sessions_class_has_duration','slot_sessions_class_not_block')
--    order by conname;
