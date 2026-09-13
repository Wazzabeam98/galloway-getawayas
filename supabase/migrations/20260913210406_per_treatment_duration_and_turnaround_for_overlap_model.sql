-- per treatment duration and turnaround for overlap model
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- Massage is the first category where session length belongs to the ITEM, not
-- the provider: one masseuse sells 30/45/60/90-minute treatments at different
-- prices. Today a session's length is one number on the provider
-- (service_providers.slot_length_minutes) and the day is a fixed, non-overlapping
-- grid generated from it, so a start-time alone stands in for "the provider is
-- busy". Once treatments differ in length that stops being true — a 90-min
-- booking at 10:00 and a 30-min booking at 11:00 are two different start-times,
-- two different slot_sessions rows, and today's guard (unique(provider,date,time)
-- + the seats_taken CAS) sees no collision. That is a silent double-booking of
-- one person, with money taken. See GUEST-EXPERIENCES-MASSAGE-DURATION-SCOPE.md.
--
-- THIS MIGRATION IS DATA ONLY, AND DELIBERATELY INERT. It gives the rows the
-- information an interval-overlap check will need — a per-treatment duration, the
-- length carried onto the live session and the frozen order, and a per-provider
-- turnaround gap — and NOTHING that enforces it. No exclusion constraint, no
-- generated range column, no change to generation or the seat claim. Nothing
-- reads these columns yet. Applying this alone changes no behaviour: the overlap
-- bug is neither introduced nor fixed by it.
--
-- WHAT GOES WRONG IF THE NEXT PIECE IS SKIPPED. The columns are harmless on their
-- own, but they are the floor the claim rework stands on. If per-item durations
-- are ever shown to guests (the wizard piece) WITHOUT the claim rework that reads
-- these columns and refuses overlapping intervals, different-length treatments
-- will generate overlapping start grids and the claim will accept the overlaps —
-- turning today's latent double-booking into an everyday one. Order matters: the
-- claim rework must land before per-item durations reach a guest.
--
-- PRE-FLIGHT. None — every change is additive and nullable (or defaulted), so it
-- applies cleanly on any existing row and is safe to run twice. TEST ONLY for
-- now: this has deliberately NOT gone to production, so it must not be merged to
-- master until it has (the deploy-time gate enforces that on production builds;
-- preview builds fail open). See MAINTENANCE.md "The migration goes to production
-- BEFORE the code that needs it".

-- --------------------------------------------------------------------------
-- 1. The item carries its own length. NULL means "no per-item length" — the
--    generator falls back to the provider's slot_length_minutes, so every
--    existing single-length category (sauna, a fixed class, yoga) is unchanged.
--    A massage treatment sets it; that is what makes the times a guest sees
--    depend on the treatment they pick. service_provider_items is granted ALL to
--    the roles and governed by RLS, and is public-read for approved providers, so
--    a new column is writable by the owner and readable by the guest with no
--    extra grant.
-- --------------------------------------------------------------------------
alter table public.service_provider_items
    add column if not exists duration_minutes integer
        check (duration_minutes is null or duration_minutes > 0);

-- --------------------------------------------------------------------------
-- 2. The live session carries the length it was booked at. slot_sessions is the
--    contention row the claim reads and writes; for an overlap check to compute
--    "this provider is busy 10:00-11:30" it must know each session's length, not
--    infer it from a provider number that now varies per treatment. NULL until
--    the claim rework sets it (the claim will resolve item.duration_minutes ??
--    provider.slot_length_minutes and pin it here, the way it already pins mode
--    and capacity on the 0 -> >0 claim). The claim writes it under the service
--    role; authenticated/anon inherit only the same RLS-gated table grants that
--    capacity and seats_taken already carry (no write policy exists, so those
--    grants are inert), so no new grant is needed. Backfilled below for existing
--    rows.
-- --------------------------------------------------------------------------
alter table public.slot_sessions
    add column if not exists duration_minutes integer
        check (duration_minutes is null or duration_minutes > 0);

-- --------------------------------------------------------------------------
-- 3. The order freezes the length, exactly as it already freezes item_name,
--    item_unit, unit_price and price. What the guest bought and what the provider
--    is turning up for must outlive any later edit to the menu. service_orders is
--    revoked from anon and authenticated (read via the service role only), so
--    duration_minutes is safely non-browser-facing and needs no grant.
-- --------------------------------------------------------------------------
alter table public.service_orders
    add column if not exists duration_minutes integer
        check (duration_minutes is null or duration_minutes > 0);

-- --------------------------------------------------------------------------
-- 4. Turnaround — the provider's reset gap between treatments. A masseuse needs
--    a few minutes to change the couch and wash up before the next client; the
--    day cannot be booked truly back-to-back. It is a property of the person and
--    the room, not the treatment, so it lives on the provider (one number), not
--    the item, and roughly the same gap follows a 30- and a 90-minute treatment.
--    Default 0 = no gap, so it is inert for every existing provider and every
--    category that does not want one. It is meant to fold into the BLOCKING
--    interval, not the displayed duration: the guest still sees "60 min", while
--    the claim reserves [start, start + duration + turnaround) on the provider's
--    day. The claim rework applies that; storing it now means that piece needs no
--    second migration. Owner-editable (a masseuse knows their own reset time),
--    hence the write grants below.
-- --------------------------------------------------------------------------
alter table public.service_providers
    add column if not exists slot_turnaround_minutes integer not null default 0
        check (slot_turnaround_minutes >= 0);

-- --------------------------------------------------------------------------
-- 5. Backfill the rows that already exist, so a future overlap check never meets
--    a NULL length on live data. Both draw from the provider's current
--    slot_length_minutes — the only length these rows were ever booked at, since
--    per-item durations did not exist when they were written. Items are left NULL
--    on purpose (NULL = fall back to the provider length), and turnaround defaults
--    to 0, so neither needs a backfill.
-- --------------------------------------------------------------------------
update public.slot_sessions s
   set duration_minutes = p.slot_length_minutes
  from public.service_providers p
 where s.provider_id = p.id
   and s.duration_minutes is null
   and p.slot_length_minutes is not null
   and p.slot_length_minutes > 0;

update public.service_orders o
   set duration_minutes = p.slot_length_minutes
  from public.service_providers p
 where o.provider_id = p.id
   and o.shape = 'slot'
   and o.duration_minutes is null
   and p.slot_length_minutes is not null
   and p.slot_length_minutes > 0;

-- --------------------------------------------------------------------------
-- 6. GRANTS — service_providers only, and only for slot_turnaround_minutes.
--    Writes to service_providers are a COLUMN allow-list (INSERT and UPDATE, 37
--    columns each after the 2026-09-12 sweep); SELECT is an allow-list too. A new
--    column is unwritable and unreadable over the API until it is on each list —
--    the same step slot_min_people took (20260910171347).
--
--    Each privilege gets its OWN (column) statement on purpose. `grant insert,
--    update (col)` binds the column list to UPDATE only and grants INSERT at the
--    TABLE level (every column) — the exact drift that had to be revoked and
--    restored on 2026-09-12. Three statements, no ambiguity.
--
--    The item and session/order lengths need no grant: service_provider_items is
--    table-granted + RLS + public-read, and slot_sessions/service_orders are
--    written by the service role (service_orders is revoked from the browser
--    roles entirely).
-- --------------------------------------------------------------------------
grant insert ("slot_turnaround_minutes") on public.service_providers to authenticated;
grant update ("slot_turnaround_minutes") on public.service_providers to authenticated;
grant select ("slot_turnaround_minutes") on public.service_providers to authenticated;

-- PostgREST caches the schema and grants; without this the new column and its
-- grants are invisible over the API until it reloads.
notify pgrst, 'reload schema';

-- --------------------------------------------------------------------------
-- Comments.
-- --------------------------------------------------------------------------
comment on column public.service_provider_items.duration_minutes is
    'Per-treatment length in minutes for a slot item (massage). NULL = use the '
    'provider''s slot_length_minutes. The times a guest sees are generated from '
    'this once the claim/generation rework reads it.';
comment on column public.slot_sessions.duration_minutes is
    'The length this materialised session was booked at, pinned by the claim '
    '(item.duration_minutes ?? provider.slot_length_minutes). The input to the '
    'interval-overlap guard. Unread until the claim rework.';
comment on column public.service_orders.duration_minutes is
    'The treatment length frozen at purchase, alongside item_name/unit/price. '
    'Backfilled from the provider''s slot_length_minutes for pre-existing slot '
    'orders.';
comment on column public.service_providers.slot_turnaround_minutes is
    'Reset gap in minutes between a provider''s sessions, folded into the blocking '
    'interval [start, start + duration + turnaround) by the claim rework, NOT into '
    'the displayed duration. Default 0. Owner-editable.';

-- Read back (after --apply --read, or by hand on test):
--   -- the four columns exist with their checks:
--   select table_name, column_name, data_type, is_nullable
--     from information_schema.columns
--    where (table_name, column_name) in (
--            ('service_provider_items','duration_minutes'),
--            ('slot_sessions','duration_minutes'),
--            ('service_orders','duration_minutes'),
--            ('service_providers','slot_turnaround_minutes'))
--    order by table_name;
--   -- authenticated has INSERT, UPDATE and SELECT on the turnaround column
--   -- (expect three rows), and NOT on the order/session lengths:
--   select privilege_type from information_schema.column_privileges
--    where table_name='service_providers' and grantee='authenticated'
--      and column_name='slot_turnaround_minutes' order by 1;
--   -- turnaround defaulted to 0 on every existing provider:
--   select count(*) filter (where slot_turnaround_minutes = 0) as zeros,
--          count(*) as total from service_providers;
