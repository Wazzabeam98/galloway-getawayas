-- A menu, not a guess.
--
-- experience_price gave a guest provider ONE price for ONE thing. Right for a
-- chef — one experience, one price — and wrong for a baker, who sells a
-- celebration cake, a box of cupcakes and a tray bake at three prices nobody
-- could predict from the outside. So a guest provider now owns a list of items,
-- each with a name, a description and a price. A chef has a list of one (framed
-- as "your experience"); a baker has as many as she likes.
--
-- One model, chef = list of one — the shared-spine principle from
-- GUEST-EXPERIENCES-TRADE-SHAPE.md. The order snapshots the chosen item's name,
-- description and price at request, exactly as price already snapshots, so
-- editing or REMOVING an item never rewrites an order somebody already placed.
--
-- Lands on test first. Adds a table and three nullable columns; migrates the
-- existing single price into a one-item menu; leaves experience_price in place
-- (unread now) so nothing breaks mid-flight.

create table if not exists public.service_provider_items (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references public.service_providers(id) on delete cascade,
    name text not null,
    description text,
    price numeric not null check (price >= 0),
    -- The order they appear on the card. Ties broken by created_at.
    sort_order integer not null default 0,
    -- Hidden rather than deleted where the provider wants it off the menu for
    -- now; the guest card and the live-to-guests check read active only.
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists service_provider_items_provider_idx
    on public.service_provider_items(provider_id);

alter table public.service_provider_items enable row level security;
grant all on table public.service_provider_items to anon, authenticated, service_role;

-- Owners CRUD their own items, the same join-based rule service_areas uses.
drop policy if exists "owners manage their own items" on public.service_provider_items;
create policy "owners manage their own items"
    on public.service_provider_items
    using (exists (
        select 1 from public.service_providers p
         where p.id = service_provider_items.provider_id and p.owner_id = auth.uid()
    ))
    with check (exists (
        select 1 from public.service_providers p
         where p.id = service_provider_items.provider_id and p.owner_id = auth.uid()
    ));

-- Items of an approved provider are public to read (the guest side reads via
-- the service role, but this keeps the table consistent with service_areas).
drop policy if exists "items of approved providers are public" on public.service_provider_items;
create policy "items of approved providers are public"
    on public.service_provider_items
    for select
    using (exists (
        select 1 from public.service_providers p
         where p.id = service_provider_items.provider_id and p.status = 'approved'
    ));

-- The order carries the item it was for, snapshotted. item_id is a soft link
-- (set null if the item is later removed); item_name and item_description are
-- the copy that outlives the live menu, the same way price and
-- provider_business_name already do.
alter table public.service_orders
    add column if not exists item_id uuid references public.service_provider_items(id) on delete set null,
    add column if not exists item_name text,
    add column if not exists item_description text;

-- Migrate the existing single price into a one-item menu, for any guest
-- provider that has a price and no items yet. Idempotent — the not-exists guard
-- means a re-run adds nothing.
insert into public.service_provider_items (provider_id, name, description, price, sort_order, active)
select sp.id,
       case sp.trade
           when 'chef' then 'Private dinner'
           when 'cake' then 'Cake'
           when 'basket' then 'Hamper'
           else 'Experience'
       end,
       sp.description,
       sp.experience_price,
       0,
       true
from public.service_providers sp
where sp.audience = 'guest'
  and sp.experience_price is not null
  and sp.experience_price > 0
  and not exists (select 1 from public.service_provider_items i where i.provider_id = sp.id);

comment on table public.service_provider_items is
    'A guest provider''s menu — one item for a chef, many for a baker. The order '
    'snapshots the chosen item, so editing or removing one never rewrites a '
    'placed order. Replaces the single experience_price.';
