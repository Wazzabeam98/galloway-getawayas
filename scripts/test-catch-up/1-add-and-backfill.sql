-- TEST DATABASE ONLY. Step one of two. Run this BEFORE the deploy.
--
-- WHY THIS FILE EXISTS
--
-- The service migrations have never run on production, so they were corrected
-- in place rather than patched by a ninth migration: `service_providers` is
-- now two tables, a business and its trade listings. Production will get the
-- corrected version first time and will never know there was another shape.
--
-- Test already ran the old ones, and Supabase records a migration as applied by
-- filename — so an edited file will not re-run there. This script is what
-- brings test into line by hand. It is not a migration, it is never committed
-- to supabase/migrations, and it runs exactly once.
--
-- It exists at all because the test database is not disposable: the payout
-- work has been tested against it and `supabase db reset` would take that with
-- it.
--
-- THE ORDER MATTERS
--
-- This step only ADDS. Every column the running site reads is still here when
-- it finishes, so the site keeps working between this and the deploy. The old
-- columns come off in `2-drop-old-columns.sql`, which runs AFTER the deploy is
-- up and confirmed — dropping `business_name` while the old code is still
-- serving would take out the sign-up, the admin queue and the submitted route
-- in the same second, and they would error rather than degrade.
--
-- Safe to run twice.

begin;

-- 1. The business table, exactly as 20260824 now declares it.
create table if not exists "public"."service_businesses" (
    "id"              uuid primary key default gen_random_uuid(),
    "owner_id"        uuid not null references "auth"."users"("id") on delete cascade,
    "business_name"   text not null,
    "logo"            text,
    "contact_email"   text,
    "contact_phone"   text,
    "kind"            text not null default 'external',
    "plan"            text not null default 'trial',
    "trial_ends_at"   timestamptz,
    "settlement"      text not null default 'cash_on_arrival',
    "commission_rate" numeric not null default 0.10,
    "notify_user_ids" uuid[] not null default '{}',
    "created_at"      timestamptz not null default now(),
    "updated_at"      timestamptz not null default now(),

    constraint "service_businesses_owner_key" unique ("owner_id"),
    constraint "service_businesses_kind_check"
        check ("kind" in ('external', 'in_house')),
    constraint "service_businesses_plan_check"
        check ("plan" in ('trial', 'commission', 'subscription')),
    constraint "service_businesses_settlement_check"
        check ("settlement" in ('cash_on_arrival', 'invoice', 'net_off_payout'))
);

create index if not exists "service_businesses_owner_idx"
    on "public"."service_businesses" ("owner_id");

alter table "public"."service_businesses" enable row level security;
grant all on table "public"."service_businesses" to "anon", "authenticated", "service_role";

-- 2. One business per person, built from their oldest listing.
--
-- distinct on, not an aggregate: if somebody on test already has two rows with
-- different phone numbers, this takes the older one rather than inventing a
-- blend of the two. Which one wins matters less than it being a real answer
-- somebody actually typed.
insert into "public"."service_businesses" (
    owner_id, business_name, logo, contact_email, contact_phone,
    kind, plan, trial_ends_at, settlement, commission_rate, notify_user_ids, created_at
)
select distinct on (p.owner_id)
    p.owner_id,
    coalesce(nullif(btrim(p.business_name), ''), 'Untitled business'),
    p.logo,
    p.contact_email,
    p.contact_phone,
    p.kind,
    p.plan,
    p.trial_ends_at,
    p.settlement,
    coalesce(p.commission_rate, 0.10),
    p.notify_user_ids,
    p.created_at
from "public"."service_providers" p
order by p.owner_id, p.created_at
on conflict ("owner_id") do nothing;

-- 3. Point each listing at its business.
alter table "public"."service_providers"
    add column if not exists "business_id" uuid references "public"."service_businesses"("id") on delete cascade;

update "public"."service_providers" p
   set business_id = b.id
  from "public"."service_businesses" b
 where b.owner_id = p.owner_id
   and p.business_id is distinct from b.id;

-- Refuses to go on if anything was left behind. A listing with no business is
-- invisible under the new policies, which looks like the row was deleted.
do $$
declare
    orphans integer;
begin
    select count(*) into orphans from "public"."service_providers" where business_id is null;
    if orphans > 0 then
        raise exception 'STOP: % listing(s) have no business. Nothing has been changed.', orphans;
    end if;
end $$;

alter table "public"."service_providers"
    alter column "business_id" set not null;

create index if not exists "service_providers_business_idx"
    on "public"."service_providers" ("business_id");

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_providers_business_trade_key'
    ) then
        alter table "public"."service_providers"
            add constraint "service_providers_business_trade_key" unique ("business_id", "trade");
    end if;
end $$;

-- 4. The retired trade.
--
-- 'spanner' was "Maintenance & repairs" as a trade of its own. It is now a
-- group on the picker rather than a stored value, so any row still carrying it
-- points at a trade that no longer exists and would render as "Service" with
-- no prices and no questions.
--
-- Handyman is the honest landing place: it is the general-maintenance trade,
-- which is what 'spanner' meant.
update "public"."service_providers"
   set trade = 'handyman', updated_at = now()
 where trade = 'spanner';

-- 5. The policies that read ownership through the business.
--
-- Added now rather than in step two, because they are what the deployed code
-- relies on. The old owner_id policies stay alongside until the column goes;
-- two permissive policies on the same table are OR'd, so the owner is allowed
-- by either and nobody is locked out mid-deploy.
drop policy if exists "owners manage their own business" on "public"."service_businesses";
create policy "owners manage their own business"
    on "public"."service_businesses"
    using ("owner_id" = auth.uid())
    with check ("owner_id" = auth.uid());

drop policy if exists "businesses with an approved listing are public" on "public"."service_businesses";
create policy "businesses with an approved listing are public"
    on "public"."service_businesses"
    for select
    using (exists (
        select 1 from "public"."service_providers" p
         where p."business_id" = "service_businesses"."id"
           and p."status" = 'approved'
    ));

drop policy if exists "owners manage their own provider via business" on "public"."service_providers";
create policy "owners manage their own provider via business"
    on "public"."service_providers"
    using (exists (
        select 1 from "public"."service_businesses" b
         where b."id" = "service_providers"."business_id"
           and b."owner_id" = auth.uid()
    ))
    with check (exists (
        select 1 from "public"."service_businesses" b
         where b."id" = "service_providers"."business_id"
           and b."owner_id" = auth.uid()
    ));

drop policy if exists "owners manage their own areas via business" on "public"."service_areas";
create policy "owners manage their own areas via business"
    on "public"."service_areas"
    using (exists (
        select 1 from "public"."service_providers" p
          join "public"."service_businesses" b on b."id" = p."business_id"
         where p."id" = "service_areas"."provider_id"
           and b."owner_id" = auth.uid()
    ))
    with check (exists (
        select 1 from "public"."service_providers" p
          join "public"."service_businesses" b on b."id" = p."business_id"
         where p."id" = "service_areas"."provider_id"
           and b."owner_id" = auth.uid()
    ));

drop policy if exists "owners manage their own prices via business" on "public"."service_provider_prices";
create policy "owners manage their own prices via business"
    on "public"."service_provider_prices"
    using (exists (
        select 1 from "public"."service_providers" p
          join "public"."service_businesses" b on b."id" = p."business_id"
         where p."id" = "service_provider_prices"."provider_id"
           and b."owner_id" = auth.uid()
    ))
    with check (exists (
        select 1 from "public"."service_providers" p
          join "public"."service_businesses" b on b."id" = p."business_id"
         where p."id" = "service_provider_prices"."provider_id"
           and b."owner_id" = auth.uid()
    ));

drop policy if exists "owners manage their own extras via business" on "public"."service_provider_extras";
create policy "owners manage their own extras via business"
    on "public"."service_provider_extras"
    using (exists (
        select 1 from "public"."service_providers" p
          join "public"."service_businesses" b on b."id" = p."business_id"
         where p."id" = "service_provider_extras"."provider_id"
           and b."owner_id" = auth.uid()
    ))
    with check (exists (
        select 1 from "public"."service_providers" p
          join "public"."service_businesses" b on b."id" = p."business_id"
         where p."id" = "service_provider_extras"."provider_id"
           and b."owner_id" = auth.uid()
    ));

commit;

-- What it did, to read back before deploying:
--
--   select b.business_name, b.contact_email, count(p.id) as listings,
--          array_agg(p.trade order by p.trade) as trades
--     from public.service_businesses b
--     left join public.service_providers p on p.business_id = b.id
--    group by b.id, b.business_name, b.contact_email;
