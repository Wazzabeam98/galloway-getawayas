-- Guest-selectable paid EXTRAS for experiences/services, the same idea as a
-- stay's listing_extras but owned by a service_provider. An extra is an
-- optional add-on a guest ticks on when ordering — a sauna pack beside a
-- massage, club hire beside a round of golf.
--
-- Modelled on listing_extras (20261008101611_host_extras_stage1), with two
-- differences that are real for experiences, not accidents:
--   * units are 'booking' (charged once) or 'person' (once per guest on the
--     order). There is NO 'night' — a night is a stay concept.
--   * commission IS taken on a provider extra, exactly as on the experience
--     itself (the stays "no commission on an extra" rule was reversed on
--     26 Oct 2026; experiences never had that carve-out and never will).
--
-- VAT is per extra (standard or zero), like listing_extras. max_qty is an
-- optional per-extra cap; null means the platform default.

create table if not exists "public"."provider_extras" (
    "id" uuid primary key default gen_random_uuid(),
    "provider_id" uuid not null references "public"."service_providers"("id") on delete cascade,
    "label" text not null,
    "description" text,
    "price" numeric not null,
    -- 'booking' charges once for the order; 'person' once per guest on it.
    "unit" text not null default 'booking',
    -- 'standard' is 20% standard-rated; 'zero' is zero-rated (a hamper, say).
    "vat_treatment" text not null default 'standard',
    "active" boolean not null default true,
    "sort_order" integer not null default 0,
    -- Optional per-extra quantity cap (null = platform default). The server
    -- clamps the guest's quantity to it, mirroring the stepper.
    "max_qty" integer,
    -- Storage PATH of an optional photo (display only; never read for money).
    "photo" text,
    "created_at" timestamptz not null default now(),
    constraint "provider_extras_unit_check" check ("unit" in ('booking', 'person')),
    constraint "provider_extras_vat_check" check ("vat_treatment" in ('standard', 'zero')),
    constraint "provider_extras_price_positive" check ("price" > 0),
    constraint "provider_extras_label_len" check (char_length("label") between 1 and 80),
    constraint "provider_extras_description_len" check ("description" is null or char_length("description") <= 300),
    constraint "provider_extras_max_qty_range" check ("max_qty" is null or ("max_qty" >= 1 and "max_qty" <= 99))
);

create index if not exists "provider_extras_provider_idx"
    on "public"."provider_extras" using btree ("provider_id");

alter table "public"."provider_extras" enable row level security;

-- The service role is bound by none of this; RLS does the protecting. These are
-- a provider-set catalogue price and display fields — no collected money column
-- lives here, exactly like listing_extras.
grant all on table "public"."provider_extras" to "anon";
grant all on table "public"."provider_extras" to "authenticated";
grant all on table "public"."provider_extras" to "service_role";

-- A guest comparing or ordering an experience must see its extras, so an
-- approved provider's extras are public to read — the same rule the provider's
-- coverage areas and band prices already follow (service_provider_extras).
drop policy if exists "extras of approved providers are public" on "public"."provider_extras";
create policy "extras of approved providers are public"
    on "public"."provider_extras"
    for select
    using (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "provider_extras"."provider_id"
           and p."status" = 'approved'
    ));

-- The owner, or a co-host with the LISTING permission, manages them — the same
-- gate the provider's other child tables use (service_areas,
-- service_provider_items, service_provider_extras: has_provider_permission
-- with 'can_listing'). There is no separate pricing permission in this app.
drop policy if exists "owner and listing co-hosts manage provider extras" on "public"."provider_extras";
create policy "owner and listing co-hosts manage provider extras"
    on "public"."provider_extras"
    for all
    to "authenticated"
    using (public.has_provider_permission("provider_id", 'can_listing'))
    with check (public.has_provider_permission("provider_id", 'can_listing'));

-- The order side. A service_order is created by the order route (service role),
-- so unlike a stay — where the browser inserts the booking — the guest never
-- writes these columns directly. The route receives the guest's selection in
-- its request body, re-prices it against this catalogue, and freezes the three:
--   extras_selection  — what the guest asked for (which extras, how many), kept
--                       for the record and the receipt.
--   extras_total      — the frozen total of the extras.
--   extras_breakdown  — the per-line series at the frozen prices, for the
--                       receipt and the VAT split.
-- service_orders has no browser grants (it is server-role-only), so these stay
-- server-role-only with every other money column — no grant is added.
alter table "public"."service_orders"
    add column if not exists "extras_selection" jsonb,
    add column if not exists "extras_total" numeric,
    add column if not exists "extras_breakdown" jsonb;
