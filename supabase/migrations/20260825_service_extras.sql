-- What a provider offers on top of the job itself.
--
-- One table for three kinds of thing, because they differ in behaviour rather
-- than in shape:
--
--   toggle      a yes/no. Matching and comparison — equipment provided,
--               same-day changeover, damage reported with photos. `price` is
--               null and stays null.
--   priced      the provider sets the rate and it forms part of the ceiling
--               the commission comes off. Flat, like hot tub servicing, or per
--               unit, like bedding per bed — where the quantity is asked at
--               request time, because how many beds need changing is a fact
--               about the booking and not about the property.
--   reimbursed  the provider spends the host's money and is paid back by them
--               directly, against a receipt. **This never touches Stripe.** No
--               number exists when the quote is given, no payment passes
--               through the platform, and it is revenue for nobody — so it can
--               form no part of a ceiling and carries no commission.
--
-- Which key is which type is NOT recorded here. It lives in
-- lib/serviceProviders.ts beside the trades and the bands, so that adding
-- gardening's hedge cutting or green waste is one entry in a list rather than
-- a migration. That is a deliberate loosening: `extra_key` has a shape
-- constraint but no list of permitted values, so a typo is caught by a test
-- rather than by Postgres.
--
-- Pre-flight:
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name = 'service_provider_extras';
--
-- Safe to run twice. Run on test first, then production.

create table if not exists "public"."service_provider_extras" (
    "provider_id" uuid not null references "public"."service_providers"("id") on delete cascade,
    "extra_key"   text not null,
    "offered"     boolean not null default false,
    -- Priced extras only. Null for a toggle, and null for a reimbursed one
    -- because the amount is whatever the receipt says, weeks later.
    "price"       numeric,
    "notes"       text,
    "created_at"  timestamptz not null default now(),
    "updated_at"  timestamptz not null default now(),

    primary key ("provider_id", "extra_key"),

    -- Shape only, not a list. A list here would mean a migration every time
    -- somebody thinks of a new extra, which is the friction this avoids.
    constraint "service_provider_extras_key_check"
        check ("extra_key" ~ '^[a-z][a-z0-9_]{2,48}$'),
    constraint "service_provider_extras_price_check"
        check ("price" is null or "price" > 0)
);

create index if not exists "service_provider_extras_key_idx"
    on "public"."service_provider_extras" ("extra_key");

alter table "public"."service_provider_extras" enable row level security;

grant all on table "public"."service_provider_extras" to "anon", "authenticated", "service_role";

drop policy if exists "owners manage their own extras" on "public"."service_provider_extras";
create policy "owners manage their own extras"
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

-- A host is comparing providers on these before anybody has asked for
-- anything, exactly like the coverage areas and the band prices.
drop policy if exists "extras of approved providers are public" on "public"."service_provider_extras";
create policy "extras of approved providers are public"
    on "public"."service_provider_extras"
    for select
    using (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_provider_extras"."provider_id"
           and p."status" = 'approved'
    ));
