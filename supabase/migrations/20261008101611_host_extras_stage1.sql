-- Host-sold optional extras on a stay (Stage 1).
--
-- Our first host sells sauna packs with her direct bookings and we had no way
-- to offer them. This adds the host's own paid extras — a sauna pack, a hamper,
-- a log delivery, late checkout — priced per stay or per night, chosen by the
-- guest at checkout, carried on the ONE stay charge and paid out in the ONE
-- stay payout.
--
-- Three settled decisions shape the columns:
--   * NO commission on an extra. It is the host's own supply and Airbnb takes
--     nothing on a Resolution-Center extra, so the payout nets commission off
--     the stay only, never the extra (see app/api/cron/host-payouts).
--   * VAT is set PER EXTRA. A zero-rated hamper must never print a 20% line
--     beside a standard-rated sauna, so each extra carries its own treatment,
--     fed through lib/vat.ts singleRateShape-style handling.
--   * Refunds follow the stay's tier in v1 — the extra rides inside the stay
--     total, so refundDue already tiers it with everything-but-cleaning; no
--     separate refundability yet, and the editor says so plainly to the host.
--
-- Modelled on calendar_overrides: a host-owned child of listings, cascade
-- deleted, readable by anyone (a guest must see an extra to choose it), writable
-- only by the listing's host. The price here is a host-set catalogue price, like
-- price_per_night, not a collected money column — RLS and the CHECK constraints
-- are the server-side half of the editor's own validation (lib/listingExtras.ts).
--
-- Safe to run twice. Additive only — no column is dropped or narrowed, so it
-- reaches production ahead of the code with nothing to break. Run on test first,
-- then production.

-- 1. The host's catalogue of extras.
create table if not exists "public"."listing_extras" (
    "id" uuid primary key default gen_random_uuid(),
    "listing_id" uuid not null references "public"."listings"("id") on delete cascade,
    "label" text not null,
    "description" text,
    "price" numeric not null,
    -- 'stay' charges once for the booking; 'night' charges once per night.
    "unit" text not null default 'stay',
    -- 'standard' is a 20% standard-rated supply (a receipt splits net + VAT);
    -- 'zero' is zero-rated (named supplier, no split) — a hamper, say.
    "vat_treatment" text not null default 'standard',
    "active" boolean not null default true,
    "sort_order" integer not null default 0,
    "created_at" timestamptz not null default now(),
    constraint "listing_extras_unit_check" check ("unit" in ('stay', 'night')),
    constraint "listing_extras_vat_check" check ("vat_treatment" in ('standard', 'zero')),
    constraint "listing_extras_price_positive" check ("price" > 0),
    constraint "listing_extras_label_len" check (char_length("label") between 1 and 80),
    constraint "listing_extras_description_len" check ("description" is null or char_length("description") <= 300)
);

create index if not exists "listing_extras_listing_idx"
    on "public"."listing_extras" using btree ("listing_id");

alter table "public"."listing_extras" enable row level security;

-- The service role is bound by none of this; RLS does the protecting.
grant all on table "public"."listing_extras" to "anon";
grant all on table "public"."listing_extras" to "authenticated";
grant all on table "public"."listing_extras" to "service_role";

-- Anyone may read the catalogue — a guest has to see the extras to choose them,
-- the same as calendar overrides and nightly prices. Nothing private lives here.
drop policy if exists "Anyone can view listing extras" on "public"."listing_extras";
create policy "Anyone can view listing extras"
    on "public"."listing_extras"
    for select
    to "authenticated", "anon"
    using (true);

-- A host manages the extras on their own listings, and no others'.
drop policy if exists "Hosts manage their own listing extras" on "public"."listing_extras";
create policy "Hosts manage their own listing extras"
    on "public"."listing_extras"
    to "authenticated"
    using ("listing_id" in (select "id" from "public"."listings" where "host_id" = auth.uid()))
    with check ("listing_id" in (select "id" from "public"."listings" where "host_id" = auth.uid()));

-- 2. The booking side.
--    extras_selection — the guest's CLAIM (which extras, how many), written by
--      the browser at booking insert exactly like total_price, and re-priced
--      from the catalogue server-side. Never trusted for money.
--    extras_total / extras_breakdown — FROZEN by the checkout route from the
--      server-side quote, the same moment and principle as cleaning_fee and
--      nightly_breakdown. Service-role only, never writable from a browser.
alter table "public"."bookings"
    add column if not exists "extras_selection" jsonb,
    add column if not exists "extras_total" numeric,
    add column if not exists "extras_breakdown" jsonb;

-- The guest may write ONLY the selection, and only at insert — the same shape
-- of grant as total_price in 20260829011000_a_booking_cannot_arrive_paid. The
-- two frozen columns are deliberately NOT granted: they stay server-role-only
-- with every other money column, so the browser can state what it wants but
-- never what it is charged or what the host is paid.
grant insert ("extras_selection") on table "public"."bookings" to "authenticated";

-- Read back. extras_selection must be insertable by authenticated; the two
-- frozen columns must NOT be:
--
--   select column_name, privilege_type
--     from information_schema.column_privileges
--    where table_name = 'bookings'
--      and grantee = 'authenticated'
--      and column_name in ('extras_selection','extras_total','extras_breakdown');
--   -- expect exactly one row: extras_selection / INSERT.
