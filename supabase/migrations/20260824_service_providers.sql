-- Local businesses that sell services on the site: cleaners, gardeners,
-- bakers, chefs, and the maintenance trades.
--
-- Phase one only. There are no service bookings yet and no money moves — this
-- is the business itself, its trades, their coverage, and the approval that
-- lets each one appear.
--
-- TWO TABLES, NOT ONE
--
-- A business and a trade listing are different things, and one person can hold
-- several of the second. Somebody in Galloway who plumbs and joins is one
-- business with two listings — one name, one phone number, one logo, two shop
-- windows that are approved separately and priced separately.
--
-- The split is what stops that person typing their phone number twice and
-- watching the two copies drift the first time it changes.
--
--   service_businesses   who they are.   One row per person.
--   service_providers    what they do.   One row per trade.
--
-- What lives where is decided by one question: would a plumber-and-joiner
-- want to answer it once, or twice?
--
--   once   name, logo, phone, email, billing, whether we are the ones doing
--          the work. All on the business.
--   twice  description, photos, prices, coverage, the approval itself. All on
--          the listing, because a roofer's shop window is not a joiner's and
--          approving one says nothing about the other.
--
-- One business per person is enforced (`service_businesses_owner_key`), and it
-- is what lets every URL in the sign-up stay keyed on the trade alone —
-- /services/join/apply?trade=plumber is unambiguous without a business id in
-- it. Two genuinely separate firms under one login is not a case worth the
-- routing, and this constraint is what would be dropped if it ever arrived.
--
-- Three things are in here before they are used, on purpose:
--
--   `plan`        the trial converts to different things on each side. Guest
--                 facing goes to commission; host facing goes to subscription,
--                 because a cleaner visiting the same cottage every week will
--                 swap numbers with the host and no per-job commission can
--                 police that. A boolean would have to be replaced.
--   `settlement`  only 'cash_on_arrival' is implemented. Netting an in-house
--                 cleaning bill off a host's payout touches the payout engine
--                 and wants its own work, but not its own migration.
--   `trial_ends_at`  so the monthly summary email can say what happens next.
--
-- These sit on the business rather than the listing because the deal is with
-- the business. A firm on a subscription does not go back to a trial by adding
-- roofing to its plumbing.
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

-- Who they are. One per person.
create table if not exists "public"."service_businesses" (
    "id"              uuid primary key default gen_random_uuid(),
    "owner_id"        uuid not null references "auth"."users"("id") on delete cascade,

    "business_name"   text not null,
    "logo"            text,

    "contact_email"   text,
    "contact_phone"   text,

    -- 'external' accepts or declines. 'in_house' is Liam's own business: there
    -- is nobody to accept, only somebody to assign, and no commission.
    "kind"            text not null default 'external',

    "plan"            text not null default 'trial',
    "trial_ends_at"   timestamptz,
    "settlement"      text not null default 'cash_on_arrival',
    "commission_rate" numeric not null default 0.10,

    -- In-house work goes to a rota, not to one person's inbox.
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

-- What they do. One per trade, approved on its own.
create table if not exists "public"."service_providers" (
    "id"              uuid primary key default gen_random_uuid(),
    "business_id"     uuid not null references "public"."service_businesses"("id") on delete cascade,

    "trade"           text not null default 'sponge',
    "description"     text not null default '',
    "photos"          text[] not null default '{}',

    -- Which shop it appears in. Two sections on the site, one engine behind.
    -- Worked out from the trade rather than asked, so the row cannot disagree
    -- with itself.
    "audience"        text not null default 'both',

    -- Self-serve to fill in, reviewed before it appears. Per listing: a
    -- plumber whose Gas Safe number checks out goes live while their joinery
    -- listing is still waiting, and neither blocks the other.
    "status"          text not null default 'draft',
    "review_note"     text,
    "submitted_at"    timestamptz,
    "approved_at"     timestamptz,
    "declined_at"     timestamptz,

    "created_at"      timestamptz not null default now(),
    "updated_at"      timestamptz not null default now(),

    constraint "service_providers_audience_check"
        check ("audience" in ('guest', 'host', 'both')),
    constraint "service_providers_status_check"
        check ("status" in ('draft', 'pending_review', 'approved', 'declined', 'hidden'))
);

-- A service covers a radius, not an address. Several rows per listing on
-- purpose: a chef covering Kirkcudbright and Castle Douglas but not the moor
-- between them is two circles, not one that promises Stranraer.
--
-- Hung off the listing rather than the business, because the same person may
-- travel further for one trade than another — a roofer will drive to a job
-- they would not drive to for half an hour of handyman work.
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

create index if not exists "service_businesses_owner_idx"
    on "public"."service_businesses" ("owner_id");
create index if not exists "service_providers_business_idx"
    on "public"."service_providers" ("business_id");
create index if not exists "service_providers_status_idx"
    on "public"."service_providers" ("status");
create index if not exists "service_areas_provider_idx"
    on "public"."service_areas" ("provider_id");

alter table "public"."service_businesses" enable row level security;
alter table "public"."service_providers"  enable row level security;
alter table "public"."service_areas"      enable row level security;

grant all on table "public"."service_businesses" to "anon", "authenticated", "service_role";
grant all on table "public"."service_providers"  to "anon", "authenticated", "service_role";
grant all on table "public"."service_areas"      to "anon", "authenticated", "service_role";

-- Owners manage their own business, whatever state its listings are in.
drop policy if exists "owners manage their own business" on "public"."service_businesses";
create policy "owners manage their own business"
    on "public"."service_businesses"
    using ("owner_id" = auth.uid())
    with check ("owner_id" = auth.uid());

-- The business behind an approved listing is public, because the name and the
-- phone number are the listing. A business whose every listing is still a
-- draft stays private to its owner.
drop policy if exists "businesses with an approved listing are public" on "public"."service_businesses";
create policy "businesses with an approved listing are public"
    on "public"."service_businesses"
    for select
    using (exists (
        select 1 from "public"."service_providers" p
         where p."business_id" = "service_businesses"."id"
           and p."status" = 'approved'
    ));

-- Owners manage their own listings. Ownership is one hop away now, so every
-- policy below joins back to the business rather than reading an owner_id off
-- the row. Storing a second copy of owner_id here would be quicker to write
-- and is exactly the drift this split exists to remove.
drop policy if exists "owners manage their own provider" on "public"."service_providers";
create policy "owners manage their own provider"
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

drop policy if exists "areas of approved providers are public" on "public"."service_areas";
create policy "areas of approved providers are public"
    on "public"."service_areas"
    for select
    using (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_areas"."provider_id"
           and p."status" = 'approved'
    ));
