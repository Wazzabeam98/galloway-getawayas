-- Pets in house rules, checkout instructions and guest safety for holiday lets
-- (Airbnb's). Four new PUBLIC columns on listings — the listing page shows all
-- of them — written only through /api/listings/save (service role), which
-- cleans them with lib/listingSafety. So: SELECT to both browser roles, no
-- browser UPDATE, and PLATFORM_ONLY ("editor via service route") in
-- tests/listings-writable-columns-guard.test.ts.
--
--   max_pets          the most pets a booking may bring, 1–5, set in House
--                     rules beside "Pets allowed" (which stays the amenity the
--                     badge, the filter and the amenities list read). Null when
--                     the listing allows no pets.
--   checkout_tasks    Airbnb's checkout tick-list, as keys (lib/listingSafety
--                     CHECKOUT_TASKS); '{}' = none.
--   checkout_note     the host's "anything else" for checkout, up to 500.
--   guest_safety      { item: { yes, details? } } for Airbnb's safety
--                     considerations, devices and property info. '{}' = none
--                     answered. The two alarms stay amenities.
--
-- BACKFILL: a listing that allows pets today gets max_pets = 5, the top of the
-- range, so no booking that could be made before is refused by the new limit.
-- Nothing else changes for any listing.

alter table "public"."listings"
    add column if not exists "max_pets" smallint,
    add column if not exists "checkout_tasks" text[] not null default '{}'::text[],
    add column if not exists "checkout_note" text,
    add column if not exists "guest_safety" jsonb not null default '{}'::jsonb;

alter table "public"."listings" drop constraint if exists "listings_max_pets_range";
alter table "public"."listings"
    add constraint "listings_max_pets_range" check (max_pets is null or (max_pets between 1 and 5));

alter table "public"."listings" drop constraint if exists "listings_checkout_note_len";
alter table "public"."listings"
    add constraint "listings_checkout_note_len" check (checkout_note is null or char_length(checkout_note) <= 500);

update "public"."listings"
   set "max_pets" = 5
 where "max_pets" is null
   and "amenities" @> array['Pets allowed']::text[];

grant select ("max_pets", "checkout_tasks", "checkout_note", "guest_safety") on "public"."listings" to "anon";
grant select ("max_pets", "checkout_tasks", "checkout_note", "guest_safety") on "public"."listings" to "authenticated";

-- listing_private is `select l.*`, frozen to the columns that existed when it
-- was last created; recreate it (same body) so the owner's editor sees the new
-- columns, and re-apply the read-only grant (20260903011803).
create or replace view "public"."listing_private" as
    select l.*
      from "public"."listings" l
     where l."host_id" = auth.uid()
        or exists (
            select 1 from "public"."listing_access" la
             where la."listing_id" = l."id"
               and la."user_id" = auth.uid()
               and la."status" = 'active'
        );

revoke all on "public"."listing_private" from "anon", "authenticated";
grant select on "public"."listing_private" to "authenticated";
revoke insert, update, delete, truncate, references, trigger
    on "public"."listing_private" from "authenticated", "anon";

notify pgrst, 'reload schema';

-- Read back:
--   select count(*) filter (where amenities @> array['Pets allowed']) as pets_on,
--          count(*) filter (where max_pets = 5) as capped_5,
--          count(*) filter (where max_pets is not null and not amenities @> array['Pets allowed']) as stray
--     from public.listings;
--   -- expected: pets_on = capped_5, stray = 0
