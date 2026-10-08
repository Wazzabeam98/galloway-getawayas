-- Per-offering VAT treatment for a VAT-registered experience provider.
--
-- Not every supply is standard-rated: most food is zero-rated, and lessons or
-- tuition can be exempt. Guessing from the category gets it wrong both ways, so
-- the provider says, per offering: standard (20%), zero-rated or exempt. The
-- guest's receipt then prints the 20% split only for a standard-rated supply;
-- zero-rated and exempt show the supplier and their VAT number with no split.
--
-- 1. service_provider_items.vat_treatment — 'standard' | 'zero' | 'exempt',
--    NOT NULL DEFAULT 'standard', so every existing and every new item is
--    standard until the provider changes it. Written by the listing save route
--    (lib/vat.ts normaliseVatTreatment), the same as every other item field. The
--    table is already public-read (the marketplace lists items), so this column
--    is too: it describes the offering, not the provider's private registration.
--
-- 2. service_orders.supplier_vat_treatment — the treatment frozen onto the order
--    when it is made, by the existing BEFORE INSERT stamp trigger, and only when
--    the provider is VAT registered (null otherwise, like the number and name).
--    One item → that item's treatment; a food cart → its items' treatment if
--    they all agree, 'mixed' if they don't (no split); no item → 'standard'.
--    A value sent on insert is never trusted: the trigger always overwrites it.
--    Existing orders that already carry a VAT number are set to 'standard',
--    which is what their receipts showed.
--
-- Bookings (stays) are unchanged: a holiday let is standard-rated.

alter table "public"."service_provider_items"
    add column if not exists "vat_treatment" text not null default 'standard';

alter table "public"."service_provider_items"
    add constraint "service_provider_items_vat_treatment_check"
    check ("vat_treatment" in ('standard', 'zero', 'exempt'));

comment on column "public"."service_provider_items"."vat_treatment" is
    'VAT treatment of this offering when the provider is VAT registered: standard (20%), zero or exempt. Decides whether the receipt prints a 20% split.';

alter table "public"."service_orders"
    add column if not exists "supplier_vat_treatment" text;

alter table "public"."service_orders"
    add constraint "service_orders_supplier_vat_treatment_check"
    check ("supplier_vat_treatment" is null or "supplier_vat_treatment" in ('standard', 'zero', 'exempt', 'mixed'));

comment on column "public"."service_orders"."supplier_vat_treatment" is
    'VAT treatment of what was ordered, frozen at insert by the stamp trigger when the provider is VAT registered (standard/zero/exempt/mixed); null if not registered.';

update "public"."service_orders"
   set "supplier_vat_treatment" = 'standard'
 where "supplier_vat_number" is not null and "supplier_vat_treatment" is null;

create or replace function public.service_orders_stamp_supplier_vat()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
    treatments text[];
begin
    new.supplier_vat_number := null;
    new.supplier_vat_name := null;
    new.supplier_vat_treatment := null;
    if new.provider_id is not null then
        select sp.vat_number, sp.vat_name
          into new.supplier_vat_number, new.supplier_vat_name
          from public.service_providers sp
         where sp.id = new.provider_id and sp.vat_registered;
    end if;
    if new.supplier_vat_number is not null then
        if new.item_id is not null then
            select array_agg(distinct i.vat_treatment) into treatments
              from public.service_provider_items i
             where i.id = new.item_id;
        elsif jsonb_typeof(new.line_items) = 'array' then
            select array_agg(distinct i.vat_treatment) into treatments
              from jsonb_array_elements(new.line_items) l
              join public.service_provider_items i
                on i.id::text = l->>'item_id' and i.provider_id = new.provider_id;
        end if;
        new.supplier_vat_treatment := case
            when treatments is null or cardinality(treatments) = 0 then 'standard'
            when cardinality(treatments) = 1 then treatments[1]
            else 'mixed'
        end;
    end if;
    return new;
end;
$fn$;

revoke all on function public.service_orders_stamp_supplier_vat() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Read back:
--   select table_name, column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where (table_name = 'service_provider_items' and column_name = 'vat_treatment')
--       or (table_name = 'service_orders' and column_name = 'supplier_vat_treatment');
--   -- expected: vat_treatment text NO 'standard'::text; supplier_vat_treatment text YES null
--   select count(*) from service_orders where supplier_vat_number is not null and supplier_vat_treatment is null;
--   -- expected: 0
--   select prosrc like '%supplier_vat_treatment%' from pg_proc where proname = 'service_orders_stamp_supplier_vat';
--   -- expected: true
