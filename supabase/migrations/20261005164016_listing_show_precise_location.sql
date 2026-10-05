-- Airbnb's "Location sharing → Show the precise location" for holiday lets.
--
-- One new column on listings:
--   show_precise_location  boolean not null default false
--
-- Off (every existing listing, and every new one until the host says otherwise)
-- the public listing map keeps the approximate pin exactly as now. On, the
-- listing page shows the exact pin. The written street address is untouched by
-- this: it still only reaches a guest after booking.
--
-- NO BROWSER GRANT. The listing page reads this flag — and, only when it is on,
-- the exact latitude/longitude — through the service role on the server, so
-- latitude/longitude stay unreadable by anon exactly as 20260828224500 set
-- them. The host writes it through /api/listings/save (service role), so it is
-- classified PLATFORM_ONLY ("editor via service route") in
-- tests/listings-writable-columns-guard.test.ts, like neighbourhood before it.

alter table "public"."listings"
    add column if not exists "show_precise_location" boolean not null default false;

-- listing_private is `select l.*`, frozen to the columns that existed when it
-- was last created; recreate it (same body) so the owner's editor sees the new
-- column, and re-apply the read-only grant (the browser-views write trap,
-- 20260903011803).
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
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_name = 'listings' and column_name = 'show_precise_location';
--   -- expected: boolean, NO, false
--   select count(*) from information_schema.role_column_grants
--    where table_name = 'listings' and column_name = 'show_precise_location'
--      and grantee in ('anon', 'authenticated');
--   -- expected: 0
--   select count(*) filter (where show_precise_location) from public.listings;
--   -- expected: 0 (nothing changes for any listing)
