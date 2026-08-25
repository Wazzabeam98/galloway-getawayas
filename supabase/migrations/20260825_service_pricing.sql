-- What a host-side provider charges.
--
-- Bands are defined by us, not by the provider, so that two cleaners are
-- comparable. A provider fills in the bands they cover and leaves the rest
-- blank; a blank band means "I do not cover that size" and filters them out of
-- results for it, rather than showing a host an empty price.
--
-- The axis differs by trade, the shape does not:
--
--   cleaning, waste   bedrooms — already on the listing, so the host enters
--                     nothing and cannot shade it to land in a cheaper band
--   gardening         plot size — bedrooms tell you nothing about a garden, a
--                     two-bed cottage can sit in an acre. Physical anchors
--                     rather than adjectives, so two hosts reading them mean
--                     the same thing
--   maintenance       neither. You cannot band a repair, so it is a call-out
--                     fee plus an hourly rate, held on the provider itself
--
-- `typical_hours` is a guide shown to the host — "£60 per visit, usually about
-- 2 hours". It is hours, never a rate, and it never enters a calculation. An
-- hourly figure as the price is what puts the total after the job, which is
-- the problem the bands exist to avoid. There is a test asserting no code path
-- multiplies by it.
--
-- Pre-flight:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_providers'
--      and column_name in ('callout_fee', 'hourly_rate', 'commission_rate');
--
-- Safe to run twice. Run on test first, then production.

create table if not exists "public"."service_provider_prices" (
    "provider_id"   uuid not null references "public"."service_providers"("id") on delete cascade,
    "band_key"      text not null,
    "price"         numeric not null,
    -- Optional, and shown next to the price rather than instead of it.
    "typical_hours" numeric,
    "created_at"    timestamptz not null default now(),
    "updated_at"    timestamptz not null default now(),

    primary key ("provider_id", "band_key"),

    constraint "service_provider_prices_band_check"
        check ("band_key" in (
            'beds_1_2', 'beds_3_4', 'beds_5_plus',
            'plot_yard', 'plot_garden', 'plot_grounds'
        )),
    constraint "service_provider_prices_price_check"
        check ("price" > 0),
    constraint "service_provider_prices_hours_check"
        check ("typical_hours" is null or "typical_hours" > 0)
);

-- Maintenance only. Two numbers rather than a band, because a repair cannot be
-- sized in advance.
alter table "public"."service_providers"
    add column if not exists "callout_fee" numeric;
alter table "public"."service_providers"
    add column if not exists "hourly_rate" numeric;

-- 10% a job. Held per provider and snapshotted onto a request when requests
-- exist, the same way bookings.commission_rate already works — so changing it
-- later never rewrites what somebody already agreed to. `plan` stays as it is:
-- the guest side converts to commission and the host side to a subscription,
-- and a provider on a subscription will want this at zero.
-- The deal is with the business, not with one of its trades. A firm on a
-- negotiated rate does not go back to the default by adding roofing to its
-- plumbing, so this sits alongside `plan` and `settlement`.
alter table "public"."service_businesses"
    add column if not exists "commission_rate" numeric not null default 0.10;

-- No plot field existed on a listing, and a plot is a fact about the property
-- rather than about a request: asked every time, two requests could answer it
-- differently and the quotes would stop being comparable. Filled in once by
-- the host. Null means they have not said yet, which is a prompt when they
-- first look at gardening, not a refusal.
--
-- NOTE: nothing writes this yet. The field on the listing form is not built.
alter table "public"."listings"
    add column if not exists "plot_band" text;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'listings_plot_band_check'
    ) then
        alter table "public"."listings"
            add constraint "listings_plot_band_check"
            check ("plot_band" is null or "plot_band" in ('plot_yard', 'plot_garden', 'plot_grounds'));
    end if;
end $$;

create index if not exists "service_provider_prices_band_idx"
    on "public"."service_provider_prices" ("band_key");

alter table "public"."service_provider_prices" enable row level security;

grant all on table "public"."service_provider_prices" to "anon", "authenticated", "service_role";

drop policy if exists "owners manage their own prices" on "public"."service_provider_prices";
create policy "owners manage their own prices"
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

-- A host comparing providers is reading these before anybody has requested
-- anything, so they are public for an approved provider — exactly like the
-- coverage areas.
drop policy if exists "prices of approved providers are public" on "public"."service_provider_prices";
create policy "prices of approved providers are public"
    on "public"."service_provider_prices"
    for select
    using (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_provider_prices"."provider_id"
           and p."status" = 'approved'
    ));
