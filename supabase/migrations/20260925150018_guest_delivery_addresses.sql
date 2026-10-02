-- Saved delivery addresses — a guest's own address book for experience deliveries.
--
-- WHY A TABLE. A guest ordering a delivered made-to-order item (a cake from a
-- baker) types a delivery address in the basket. Until now that address was used
-- once and forgotten, so a guest who orders again — or from a second provider —
-- retypes it. This remembers the ones they save, so next time the basket offers
-- them as a one-tap pick. It is a convenience, never a source of truth: the
-- ORDER still freezes its own service_address (service_orders.service_address),
-- so editing or deleting a saved row never reaches an order already placed.
--
-- WHOSE IT IS. Each row belongs to one signed-in guest (guest_id = auth.uid()).
-- It is the guest's own postal address — low-sensitivity, and theirs — so unlike
-- the private cottage address it is theirs to read and write directly under RLS,
-- gated to their own rows. An anonymous standalone booker has no account to hang
-- these on, so they simply do not get a saved list (they type the address, and
-- the minted account starts empty).
--
-- WHAT IS STORED. The four labelled fields the modal fills (a house name or flat,
-- the street, the town, the postcode) plus `line` — the one composed string the
-- order route actually sends and validates. The parts are kept so the modal can
-- reopen a saved address for editing without re-parsing the line.

create table if not exists public.guest_delivery_addresses (
    id uuid primary key default gen_random_uuid(),

    -- The owner. Defaulting to auth.uid() lets the authenticated client insert a
    -- row without naming itself, and the RLS with-check below pins it regardless.
    guest_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

    created_at timestamptz not null default now(),
    -- Bumped when the same address is picked or re-saved, so the basket can offer
    -- the most-recently-used first.
    last_used_at timestamptz not null default now(),

    -- A house name or flat/sub-building — the first line of the address, optional.
    house text not null default '',
    -- The street line (number + street), the part a driver navigates by.
    street text not null default '',
    -- The town, shown in the summary and the pick list.
    town text not null default '',
    -- The postcode. Required — the order route refuses a delivery address with no
    -- postcode, and the reach check places the guest by it.
    postcode text not null,

    -- The one composed line the basket submits as serviceAddress. Held so the
    -- pick list and the order send the exact same string the guest saw.
    line text not null
);

-- Newest-used first, per guest — the order the basket lists them in.
create index if not exists guest_delivery_addresses_guest_used
    on public.guest_delivery_addresses (guest_id, last_used_at desc);

-- Dedupe: one row per guest per composed line, case-insensitive. A repeat save of
-- the same address bumps last_used_at (see the route's upsert) rather than piling
-- up near-duplicates in the pick list.
create unique index if not exists guest_delivery_addresses_guest_line
    on public.guest_delivery_addresses (guest_id, lower(line));

alter table public.guest_delivery_addresses enable row level security;

-- A guest sees and manages only their own rows. Both USING (which rows are
-- visible / updatable / deletable) and WITH CHECK (what an insert/update may
-- write) pin guest_id to the caller, so a row can neither be read for, nor minted
-- against, another account.
drop policy if exists "guests manage their own delivery addresses" on public.guest_delivery_addresses;
create policy "guests manage their own delivery addresses"
    on public.guest_delivery_addresses
    using (guest_id = auth.uid())
    with check (guest_id = auth.uid());

-- The grants. Table-level to authenticated (RLS restricts to their own rows);
-- there are no columns to withhold — every field is the guest's own address, and
-- guest_id is pinned by the policy, not by a column grant. anon gets nothing: a
-- delivery address belongs to an account. Stated as a revoke-then-grant so the
-- intent reads in one place.
revoke all on public.guest_delivery_addresses from anon, authenticated;
grant select, insert, update, delete on public.guest_delivery_addresses to authenticated;

-- PostgREST caches the schema; reload it so the table is reachable over the API.
notify pgrst, 'reload schema';

comment on table public.guest_delivery_addresses is
    'A signed-in guest''s saved experience-delivery addresses, offered as one-tap '
    'picks in the food basket. Convenience only — the order freezes its own '
    'service_address, so editing these never touches a placed order. RLS gates '
    'every row to guest_id = auth.uid(); anon has no access.';

-- Read back:
--   select column_name, is_nullable from information_schema.columns
--    where table_name='guest_delivery_addresses';
--   -- authenticated has the four write grants, anon has none:
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name='guest_delivery_addresses' and grantee in ('anon','authenticated');
