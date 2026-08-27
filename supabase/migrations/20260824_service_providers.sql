-- Local businesses that sell services on the site: cleaners, gardeners,
-- bakers, chefs, emergency maintenance.
--
-- Phase one only. There are no service bookings yet and no money moves — this
-- is the provider themselves, their coverage, and the approval that lets them
-- appear.
--
-- ONE BUSINESS PER TRADE, AND ITS OWN NAME
--
-- A cleaning round and a window round are two businesses, and somebody running
-- both very often trades under two names. So the name, the logo and the
-- contact details sit on this row, per trade, and a second trade is set up
-- from scratch rather than inheriting the first one's identity.
--
-- This was briefly split into a business table and a listing table. It was the
-- wrong shape for the same reason: it made one name apply to everything a
-- person did, which is precisely what should not happen.
--
-- Two things are in here before they are used, on purpose:
--
--   `plan`        kept as a value rather than a boolean because the day the
--                 model changed it would be a value to set rather than a
--                 column to replace. That day came: see
--                 20260827_provider_trial_and_plan.sql. Both values are live
--                 now, decided by the trade, though nothing bills anybody
--                 yet.
--   `settlement`  only 'cash_on_arrival' is implemented. Netting an in-house
--                 cleaning bill off a host's payout touches the payout engine
--                 and wants its own work, but not its own migration.
--
-- SUPERSEDED ON 27 AUGUST 2026 by 20260827_provider_trial_and_plan.sql. This
-- paragraph used to say there was no free trial and no trial column, and that
-- a dormant `trial_ends_at` was one query away from becoming a promise on a
-- page again. The warning was right about the failure it had seen; the
-- conclusion has been reversed.
--
-- There is now a trial, and `trial_ends_at` is a real column. What changed is
-- where it is written: the clock is stamped in the admin approve route, in the
-- same write that sets `approved_at`, and said out loud in the email that
-- tells the provider they are live. A draft starts nothing and a submission
-- starts nothing. That is the answer to a promise made by accident — not
-- having no column, but having no way to set one without telling somebody.
--
-- The model, in full: 90 free days from approval and then £20 a month for the
-- six maintenance trades, whose work is quoted on site and paid off-platform;
-- 10% a job for everything else, where the platform charges the customer at
-- acceptance. Read the newer migration rather than this paragraph.
--
-- Attribution is deliberately NOT a counter here. Jobs and their value are a
-- query over the service bookings table when it exists; a stored count is one
-- missed write away from being wrong, and the monthly email is the thing that
-- sells the platform, so it has to be right.
--
-- Pre-flight, to see what is already there:
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name like 'service%';
--
-- Safe to run twice. Run on test first, then production.

create table if not exists "public"."service_providers" (
    "id"              uuid primary key default gen_random_uuid(),
    "owner_id"        uuid not null references "auth"."users"("id") on delete cascade,

    "business_name"   text not null,
    "trade"           text not null default 'sponge',
    "description"     text not null default '',
    "photos"          text[] not null default '{}',

    "contact_email"   text,
    "contact_phone"   text,

    -- Which shop it appears in. Two sections on the site, one engine behind.
    "audience"        text not null default 'both',

    -- 'external' accepts or declines. 'in_house' is Liam's own business: there
    -- is nobody to accept, only somebody to assign, and no commission.
    "kind"            text not null default 'external',

    -- Self-serve to fill in, reviewed before it appears.
    "status"          text not null default 'draft',
    "review_note"     text,
    "submitted_at"    timestamptz,
    "approved_at"     timestamptz,
    "declined_at"     timestamptz,

    "plan"            text not null default 'commission',
    "settlement"      text not null default 'cash_on_arrival',

    -- In-house work goes to a rota, not to one person's inbox.
    "notify_user_ids" uuid[] not null default '{}',

    "created_at"      timestamptz not null default now(),
    "updated_at"      timestamptz not null default now(),

    constraint "service_providers_audience_check"
        check ("audience" in ('guest', 'host', 'both')),
    constraint "service_providers_kind_check"
        check ("kind" in ('external', 'in_house')),
    constraint "service_providers_status_check"
        check ("status" in ('draft', 'pending_review', 'approved', 'declined', 'hidden')),
    constraint "service_providers_plan_check"
        check ("plan" in ('commission', 'subscription')),
    constraint "service_providers_settlement_check"
        check ("settlement" in ('cash_on_arrival', 'invoice', 'net_off_payout'))
);

-- A service covers a radius, not an address. Several rows per provider on
-- purpose: a chef covering Kirkcudbright and Castle Douglas but not the moor
-- between them is two circles, not one that promises Stranraer.
create table if not exists "public"."service_areas" (
    "id"           uuid primary key default gen_random_uuid(),
    "provider_id"  uuid not null references "public"."service_providers"("id") on delete cascade,
    "label"        text not null default '',
    "centre_lat"   double precision not null,
    "centre_lng"   double precision not null,
    "radius_miles" numeric(5,1) not null default 10,
    "created_at"   timestamptz not null default now(),

    constraint "service_areas_radius_check"
        check ("radius_miles" > 0 and "radius_miles" <= 200)
);

create index if not exists "service_providers_owner_idx"
    on "public"."service_providers" ("owner_id");
create index if not exists "service_providers_status_idx"
    on "public"."service_providers" ("status");
create index if not exists "service_areas_provider_idx"
    on "public"."service_areas" ("provider_id");

alter table "public"."service_providers" enable row level security;
alter table "public"."service_areas"     enable row level security;

grant all on table "public"."service_providers" to "anon", "authenticated", "service_role";
grant all on table "public"."service_areas"     to "anon", "authenticated", "service_role";

-- Owners manage their own, whatever state it is in.
drop policy if exists "owners manage their own provider" on "public"."service_providers";
create policy "owners manage their own provider"
    on "public"."service_providers"
    using ("owner_id" = auth.uid())
    with check ("owner_id" = auth.uid());

-- Anyone may read one that has been approved. A draft, a pending application
-- and a declined one stay private to their owner. Admin screens read with the
-- service role, which is not subject to this.
drop policy if exists "approved providers are public" on "public"."service_providers";
create policy "approved providers are public"
    on "public"."service_providers"
    for select
    using ("status" = 'approved');

drop policy if exists "owners manage their own areas" on "public"."service_areas";
create policy "owners manage their own areas"
    on "public"."service_areas"
    using (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_areas"."provider_id"
           and p."owner_id" = auth.uid()
    ))
    with check (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_areas"."provider_id"
           and p."owner_id" = auth.uid()
    ));

drop policy if exists "areas of approved providers are public" on "public"."service_areas";
create policy "areas of approved providers are public"
    on "public"."service_areas"
    for select
    using (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_areas"."provider_id"
           and p."status" = 'approved'
    ));
