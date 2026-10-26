-- Host-sold extras, two additions the editor and the guest panel asked for:
--
--   * a THIRD charge type, 'person' — charged once for each guest on the
--     booking (club hire £5pp for a party of four = £20, once). The existing
--     'stay' (once) and 'night' (once per night) are unchanged, so every extra
--     already saved keeps its exact price. The CHECK is widened, never
--     narrowed, so no stored row can fall foul of it.
--
--   * an optional per-extra MAXIMUM QUANTITY (max_qty). Null means "use the
--     platform default cap" (EXTRA_DEFAULT_QTY_CAP in lib/listingExtras.ts);
--     a number caps how many of this one extra a guest may add. It is a
--     catalogue limit like the price, not a money column — the server clamps
--     the guest's chosen quantity to it in resolveSelection, mirroring the
--     stepper, so the browser can never buy past the cap.
--
-- Non-destructive: an added nullable column and a widened CHECK only.

alter table "public"."listing_extras"
    drop constraint if exists "listing_extras_unit_check";
alter table "public"."listing_extras"
    add constraint "listing_extras_unit_check"
    check ("unit" in ('stay', 'night', 'person'));

alter table "public"."listing_extras"
    add column if not exists "max_qty" integer;

-- A sane ceiling, so a slipped key ("100" for a cap of 10) is caught. Null is
-- allowed (no explicit cap); a value must be a real, small positive number.
alter table "public"."listing_extras"
    drop constraint if exists "listing_extras_max_qty_range";
alter table "public"."listing_extras"
    add constraint "listing_extras_max_qty_range"
    check ("max_qty" is null or ("max_qty" >= 1 and "max_qty" <= 99));
