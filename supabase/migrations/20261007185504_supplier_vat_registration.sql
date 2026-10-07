-- A VAT-registered host or provider: their VAT number and registered business
-- name, kept privately on their own record and frozen onto every booking/order
-- they supply, so the guest's receipt names them as the supplier.
--
-- 1. profiles (hosts) and service_providers (experience providers and trades)
--    gain vat_registered / vat_number / vat_name. PRIVATE: no grant to anon or
--    authenticated — both tables are column-grant tables, so a new column has no
--    browser read or write until one is granted, and none is. They are read and
--    written only by /api/account/vat with the service role, after the shared
--    lib/vat.ts check. The CHECKs below are the database's own copy of the
--    format rule, so nothing can store a malformed number by another route.
--
-- 2. bookings and service_orders gain supplier_vat_number / supplier_vat_name,
--    stamped by a BEFORE INSERT trigger from the host (bookings.host_id) or the
--    provider (service_orders.provider_id) when, and only when, they are VAT
--    registered at that moment. A receipt then shows what was true when the
--    guest booked, not whatever the host's settings say later. The trigger
--    always overwrites, so a value supplied on insert is never trusted.
--    No app code that writes a booking or an order changes.
--
-- Nothing changes for anyone not VAT registered: the new columns default to
-- false/null, every existing row stays null, and a null snapshot shows nothing.
-- Galloway Getaways is NOT VAT registered: there is no VAT on our commission
-- and no VAT number of ours anywhere. A supplier's price already includes their
-- VAT by law, so a receipt only BREAKS the price paid into net + VAT + total —
-- it never adds VAT on top.

alter table "public"."profiles"
    add column if not exists "vat_registered" boolean not null default false,
    add column if not exists "vat_number" text,
    add column if not exists "vat_name" text;

alter table "public"."service_providers"
    add column if not exists "vat_registered" boolean not null default false,
    add column if not exists "vat_number" text,
    add column if not exists "vat_name" text;

alter table "public"."profiles"
    add constraint "profiles_vat_number_format" check (
        "vat_number" is null
        or "vat_number" ~ '^(GB|XI)([0-9]{9}|[0-9]{12}|GD[0-4][0-9]{2}|HA[5-9][0-9]{2})$'),
    add constraint "profiles_vat_complete" check (
        not "vat_registered" or ("vat_number" is not null and nullif(btrim("vat_name"), '') is not null));

alter table "public"."service_providers"
    add constraint "service_providers_vat_number_format" check (
        "vat_number" is null
        or "vat_number" ~ '^(GB|XI)([0-9]{9}|[0-9]{12}|GD[0-4][0-9]{2}|HA[5-9][0-9]{2})$'),
    add constraint "service_providers_vat_complete" check (
        not "vat_registered" or ("vat_number" is not null and nullif(btrim("vat_name"), '') is not null));

comment on column "public"."profiles"."vat_registered" is
    'Host says they are VAT registered. Private: written/read by /api/account/vat (service role) only.';
comment on column "public"."profiles"."vat_number" is
    'Host''s UK VAT number, normalised (GB123456789). Private; shown only on that host''s receipts/statements via the booking snapshot.';
comment on column "public"."profiles"."vat_name" is
    'Business name the host is VAT registered under. Private; printed as the supplier on receipts.';
comment on column "public"."service_providers"."vat_registered" is
    'Provider says they are VAT registered. Private: written/read by /api/account/vat (service role) only.';
comment on column "public"."service_providers"."vat_number" is
    'Provider''s UK VAT number, normalised. Private; shown only on that provider''s order receipts/statements via the snapshot.';
comment on column "public"."service_providers"."vat_name" is
    'Business name the provider is VAT registered under. Private; printed as the supplier on receipts.';

alter table "public"."bookings"
    add column if not exists "supplier_vat_number" text,
    add column if not exists "supplier_vat_name" text;

alter table "public"."service_orders"
    add column if not exists "supplier_vat_number" text,
    add column if not exists "supplier_vat_name" text;

comment on column "public"."bookings"."supplier_vat_number" is
    'The host''s VAT number when this booking was made (trigger-stamped on insert); null if not VAT registered.';
comment on column "public"."bookings"."supplier_vat_name" is
    'The host''s VAT-registered business name when this booking was made; null if not VAT registered.';
comment on column "public"."service_orders"."supplier_vat_number" is
    'The provider''s VAT number when this order was made (trigger-stamped on insert); null if not VAT registered.';
comment on column "public"."service_orders"."supplier_vat_name" is
    'The provider''s VAT-registered business name when this order was made; null if not VAT registered.';

-- SECURITY DEFINER: the inserting role (a guest, or the service role) may not
-- be able to read the private columns; the function reads exactly one row and
-- writes only the two snapshot columns of the row being inserted.
create or replace function public.bookings_stamp_supplier_vat()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    new.supplier_vat_number := null;
    new.supplier_vat_name := null;
    if new.host_id is not null then
        select p.vat_number, p.vat_name
          into new.supplier_vat_number, new.supplier_vat_name
          from public.profiles p
         where p.id = new.host_id and p.vat_registered;
    end if;
    return new;
end;
$fn$;

create or replace function public.service_orders_stamp_supplier_vat()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    new.supplier_vat_number := null;
    new.supplier_vat_name := null;
    if new.provider_id is not null then
        select sp.vat_number, sp.vat_name
          into new.supplier_vat_number, new.supplier_vat_name
          from public.service_providers sp
         where sp.id = new.provider_id and sp.vat_registered;
    end if;
    return new;
end;
$fn$;

revoke all on function public.bookings_stamp_supplier_vat() from public, anon, authenticated;
revoke all on function public.service_orders_stamp_supplier_vat() from public, anon, authenticated;

drop trigger if exists bookings_stamp_supplier_vat on public.bookings;
create trigger bookings_stamp_supplier_vat
    before insert on public.bookings
    for each row execute function public.bookings_stamp_supplier_vat();

drop trigger if exists service_orders_stamp_supplier_vat on public.service_orders;
create trigger service_orders_stamp_supplier_vat
    before insert on public.service_orders
    for each row execute function public.service_orders_stamp_supplier_vat();

notify pgrst, 'reload schema';

-- Read back:
--   select table_name, column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where (table_name in ('profiles','service_providers') and column_name like 'vat_%')
--       or (table_name in ('bookings','service_orders') and column_name like 'supplier_vat_%')
--    order by 1, 2;
--   -- expected: 10 rows; vat_registered boolean NO false, the rest text YES null
--   select count(*) from information_schema.column_privileges
--    where table_name in ('profiles','service_providers') and column_name like 'vat_%'
--      and grantee in ('anon','authenticated');
--   -- expected: 0
--   select count(*) from pg_trigger where tgname like '%stamp_supplier_vat';
--   -- expected: 2
