-- The third booking shape: a slot. Instant, timed, capacity-limited.
--
-- The two existing shapes — made-for-a-date (a cake) and comes-to-you (a chef) —
-- are the request→confirm engine, split by exclusive_per_date. This adds the
-- shape that does not fit it: a sauna, a walk, a tasting, where the guest books a
-- date AND a time into a session with capacity, pays now, and nobody approves it.
-- See GUEST-EXPERIENCES-MARKETPLACE.md.
--
-- Shape lives on the provider, assigned by the owner at review beside category
-- and MCC. exclusive_per_date folds into it (comes_to_you ⇔ exclusive) and is
-- kept in sync so the existing order-route pre-check and partial unique index
-- keep working unchanged.

-- --------------------------------------------------------------------------
-- 1. Shape and its per-shape config on the provider.
-- --------------------------------------------------------------------------
alter table public.service_providers
    -- 'made_to_order' | 'comes_to_you' | 'slot'. Default made_to_order so every
    -- existing guest provider keeps a sensible shape; the update below moves the
    -- exclusive ones (chefs) to comes_to_you.
    add column if not exists shape text not null default 'made_to_order',
    -- Slot only: how long a session runs, and how many it holds. Capacity counts
    -- people for a per-person price, or is 1 for a whole-slot (private) price —
    -- the item's unit decides which, so no separate kind column is needed.
    add column if not exists slot_length_minutes integer,
    add column if not exists slot_capacity integer,
    -- Made-to-order only: notice needed, in days. Gates which dates a guest may
    -- pick — no cake for tomorrow if she needs three days.
    add column if not exists lead_time_days integer not null default 0,
    -- The free-cancellation cutoff, in HOURS, so one column serves both units:
    -- the request shapes store days×24 (48, 72, 168); a slot stores 24/12/4.
    add column if not exists cancellation_window_hours integer not null default 48;

update public.service_providers
   set shape = 'comes_to_you'
 where audience = 'guest' and exclusive_per_date is true;

-- --------------------------------------------------------------------------
-- 2. The weekly availability template — recurring opening hours.
--    Sessions are generated from this within a guest's stay; kept deliberately
--    small (no per-date pricing, no seasonal variation).
-- --------------------------------------------------------------------------
create table if not exists public.slot_availability (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references public.service_providers(id) on delete cascade,
    day_of_week smallint not null check (day_of_week between 0 and 6),  -- 0 = Sunday
    open_time time not null,
    close_time time not null,
    created_at timestamptz not null default now()
);
create index if not exists slot_availability_provider_idx on public.slot_availability(provider_id);

-- --------------------------------------------------------------------------
-- 3. Blocked dates — a day taken off, the one exception the v1 schedule allows.
-- --------------------------------------------------------------------------
create table if not exists public.slot_blocks (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references public.service_providers(id) on delete cascade,
    blocked_date date not null,
    created_at timestamptz not null default now(),
    unique (provider_id, blocked_date)
);

-- --------------------------------------------------------------------------
-- 4. A concrete session, materialised on first booking so capacity has a row to
--    decrement. seats_taken <= capacity is the whole contention guard: a booking
--    claims seats with one conditional UPDATE, and an oversell rolls back.
-- --------------------------------------------------------------------------
create table if not exists public.slot_sessions (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references public.service_providers(id) on delete cascade,
    session_date date not null,
    session_time time not null,
    capacity integer not null check (capacity >= 1),
    seats_taken integer not null default 0,
    created_at timestamptz not null default now(),
    unique (provider_id, session_date, session_time),
    check (seats_taken >= 0 and seats_taken <= capacity)
);
create index if not exists slot_sessions_provider_date_idx
    on public.slot_sessions(provider_id, session_date);

-- --------------------------------------------------------------------------
-- 5. Slot bookings reuse service_orders — payouts, refunds and the webhook
--    already understand that table. A slot booking adds the session link and the
--    time; the 'holding' status is the 15-minute seat reservation held across
--    Checkout, turned to 'confirmed' on payment or swept to 'expired' (releasing
--    the seat) if the guest never pays. shape is snapshotted like price.
-- --------------------------------------------------------------------------
alter table public.service_orders
    add column if not exists shape text,
    add column if not exists slot_session_id uuid references public.slot_sessions(id) on delete set null,
    add column if not exists service_time time;

-- --------------------------------------------------------------------------
-- RLS + grants — the join-based owner rule the other service child tables use.
-- The guest side and the atomic seat-claim run under the service role, which is
-- not subject to RLS; these policies are for the provider editing their own
-- schedule from the wizard.
-- --------------------------------------------------------------------------
alter table public.slot_availability enable row level security;
alter table public.slot_blocks enable row level security;
alter table public.slot_sessions enable row level security;
grant all on table public.slot_availability to anon, authenticated, service_role;
grant all on table public.slot_blocks to anon, authenticated, service_role;
grant all on table public.slot_sessions to anon, authenticated, service_role;

drop policy if exists "owners manage their own availability" on public.slot_availability;
create policy "owners manage their own availability" on public.slot_availability
    using (exists (select 1 from public.service_providers p
                    where p.id = slot_availability.provider_id and p.owner_id = auth.uid()))
    with check (exists (select 1 from public.service_providers p
                    where p.id = slot_availability.provider_id and p.owner_id = auth.uid()));

drop policy if exists "owners manage their own blocks" on public.slot_blocks;
create policy "owners manage their own blocks" on public.slot_blocks
    using (exists (select 1 from public.service_providers p
                    where p.id = slot_blocks.provider_id and p.owner_id = auth.uid()))
    with check (exists (select 1 from public.service_providers p
                    where p.id = slot_blocks.provider_id and p.owner_id = auth.uid()));

drop policy if exists "owners read their own sessions" on public.slot_sessions;
create policy "owners read their own sessions" on public.slot_sessions
    for select
    using (exists (select 1 from public.service_providers p
                    where p.id = slot_sessions.provider_id and p.owner_id = auth.uid()));

comment on column public.service_providers.shape is
    'made_to_order | comes_to_you | slot. Assigned at review. exclusive_per_date '
    'is kept in sync (comes_to_you ⇔ true). See GUEST-EXPERIENCES-MARKETPLACE.md.';
comment on table public.slot_sessions is
    'A concrete bookable session, materialised on first booking. seats_taken <= '
    'capacity is the contention guard; a booking claims seats with one atomic UPDATE.';
