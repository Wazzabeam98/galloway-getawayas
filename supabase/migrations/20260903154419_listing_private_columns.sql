-- listings handed street_address, postcode, exact latitude/longitude, the
-- ical_token (calendar-export secret) and commission_rate to ANY signed-in
-- account, for ANY published listing, straight over PostgREST.
--
-- WHAT WAS WRONG
--
-- The base schema runs `grant all on listings to authenticated`. The
-- location-privacy work (20260828224500) re-scoped ANON to a safe column
-- allow-list — and its own comment says a column-level revoke does NOTHING while
-- a TABLE-level grant stands, so the table grant must go and the safe columns be
-- granted back by name. That was done for anon and, by that migration's
-- admission, "authenticated is untouched". So a signed-in stranger reads every
-- column of every published listing:
--
--   select street_address, postcode, latitude, longitude, ical_token,
--          commission_rate from listings where id = eq.<any published listing>
--
-- ical_token is a live credential (subscribe to a listing's private calendar
-- feed); the exact address is the very thing the location-privacy work hid from
-- anon; commission_rate is commercial. Proven on test 2026-09-03.
--
-- THE FIX (mirrors the anon scoping exactly)
--
--   1. Revoke the TABLE-level SELECT from `authenticated` and grant back the
--      safe columns as an allow-list — every column EXCEPT the six above. Named
--      as an allow-list, not revoked one by one, so a column added later
--      defaults to HIDDEN rather than leaking (the same choice anon's grant made).
--   2. Give the OWNER (and an active co-host) their sensitive columns back
--      through `listing_private`, a SECURITY DEFINER view — the same shape as
--      profile_private. A host editing their own cottage reads it there; a
--      confirmed guest's exact address already comes from a service-role reader
--      (the arrival page), untouched by this.
--
-- The four browser reads that selected sensitive columns — all of the host's OWN
-- listings (the listing editor, the add-a-home draft, the account listings list,
-- the trade service picker) — are repointed to `listing_private` in the same
-- branch. No non-owner browser read touches a sensitive column (verified: every
-- other authenticated listings read selects only safe columns, or runs under the
-- service role).
--
-- NOT IN HERE, reported separately: `authenticated` also holds table-level
-- UPDATE, which lets a host PATCH their OWN commission_rate to 0 (proven). That
-- is a money hole but its fix (re-scoping the UPDATE grant) carries write
-- fragility — a future host-editable column would silently fail to save — so it
-- wants its own change, not a rider on this read fix.
--
-- SECURITY DEFINER, no security_invoker: like profile_private, the view runs as
-- its owner so it can return the columns just revoked from the caller. The WHERE
-- is the whole of the protection — owner, or an ACTIVE co-host; auth.uid() null
-- (signed out) matches neither.
--
-- ORDERING. The CODE depends on the view existing (the repointed reads select
-- from it), so this is "schema before code": create the view on production
-- first, deploy the code, and the SELECT re-scope can land with it. The
-- pre-deploy app still reads `.from('listings').select('*')` on the host's own
-- editor; after the re-scope that returns the safe columns and omits the six
-- sensitive ones — a degraded editor for the minutes until deploy, never a crash
-- or wrong data. If that window matters, deploy the code first (the view is
-- additive) and apply the SELECT re-scope after.

-- 1: the safe read allow-list for the browser role (every column but the six).
revoke select on "public"."listings" from "authenticated";
grant select (
    additional_rules, advance_notice, amenities, approved_at, approx_latitude,
    approx_longitude, availability_window, bathrooms, bedrooms, beds,
    cancellation_policy, check_in_end_time, check_in_method, check_in_time,
    check_out_time, checkin_end, checkin_start, checkout_time, cleaning_fee,
    commercial_photography_allowed, created_at, damage_deposit, declined_at,
    description, events_allowed, extra_guest_after, extra_guest_fee,
    extra_guest_period, host_id, ical_import_url, id, images, instant_book,
    instant_book_requires_phone, instant_book_requires_verified_id,
    last_minute_discount, location, max_guests, max_nights, min_nights,
    monthly_discount, nearby, new_listing_promo, non_refundable_option, pet_fee,
    plot_band, preparation_time, price_per_night, privacy_type, property_type,
    quiet_hours_enabled, quiet_hours_end, quiet_hours_start, rating_accuracy,
    rating_avg, rating_checkin, rating_cleanliness, rating_communication,
    rating_count, rating_location, rating_value, review_note, smoking_allowed,
    status, stl_licence_expiry, stl_licence_number, stl_licence_status,
    storey_band, title, weekend_price, weekly_discount
) on "public"."listings" to "authenticated";

-- 2: the owner's (and active co-host's) private view of their own listing.
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

-- Read, not write (the browser-views trap, 20260903011803).
revoke all on "public"."listing_private" from "anon", "authenticated";
grant select on "public"."listing_private" to "authenticated";
revoke insert, update, delete, truncate, references, trigger
    on "public"."listing_private" from "authenticated", "anon";

-- PostgREST caches the schema; a brand-new view is invisible over the API until
-- it reloads. Nudge it so listing_private is reachable the moment this lands.
notify pgrst, 'reload schema';

-- Read back — the six must be absent from authenticated's SELECT, and the view
-- SELECT-only:
--   select column_name from information_schema.role_column_grants
--    where table_name='listings' and grantee='authenticated' and privilege_type='SELECT'
--      and column_name in ('street_address','postcode','latitude','longitude','ical_token','commission_rate');
--   -- expected: no rows
--   select grantee, privilege_type from information_schema.role_table_grants where table_name='listing_private';
--   -- expected: authenticated / SELECT only
