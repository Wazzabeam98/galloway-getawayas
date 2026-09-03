-- A host could set their OWN commission_rate to zero and pay us nothing.
--
-- `grant all on listings to authenticated` gave the browser role table-level
-- UPDATE on every column. The row policy "Hosts can update their own listings"
-- limits WHICH ROWS (auth.uid() = host_id) but says nothing about which COLUMNS
-- or values — so on their own listing a host could
--
--   PATCH /rest/v1/listings?id=eq.<own> { "commission_rate": 0 }
--
-- and it stuck. Proven on test 2026-09-03 (15 -> 0, HTTP 200). commission_rate
-- is set by the admin commission tool (service role) and by nothing a host
-- touches; it had no business being in the host's UPDATE grant. The same was
-- true of every other platform-owned column: approved_at / declined_at (the
-- moderation verdict), the rating_* aggregates (computed from reviews),
-- ical_token (the calendar secret), the pricing extras the editor writes through
-- the /api/listings/save service route rather than directly.
--
-- THE FIX — an UPDATE ALLOW-LIST, the same shape as the read fixes.
--
-- Take the table-level UPDATE back from `authenticated` and grant it column by
-- column, naming ONLY the columns a host actually edits directly over PostgREST.
-- Two client paths write listings as the host without going through a service
-- route, and their union is the whole of the list:
--
--   app/addhome/page.tsx      the add-a-home wizard — writes the draft directly
--                             (title/description/location/address/coords/pricing
--                             discounts/check-in fields/amenities/images and
--                             status='draft').
--   app/account/page.tsx      the per-listing booking toggles — instant_book and
--                             its phone gate, and the three STL-licence fields.
--
-- The main editor (app/edit-listing) is NOT here: it saves through
-- /api/listings/save under the service role, so its columns (pet_fee,
-- cleaning_fee, min/max_nights, quiet hours, cancellation_policy, ...) are
-- written by the platform, not granted to the browser role. That is why they are
-- deliberately absent below and a host can still edit them.
--
-- PROVEN not to break the editor: scripts/prove-listings-update-allow-list.mjs
-- replays addhome's and account's exact write payloads as a signed-in host and
-- reads every column back — each one persists — then confirms commission_rate,
-- approved_at and the rating aggregates are refused. A column silently failing to
-- save is worse than the hole, so the allow-list is proven by save, not by eye.
--
-- host_id is included because addhome sends it, and it is safe: the row policy's
-- USING (auth.uid() = host_id) doubles as its WITH CHECK (none is set), so a host
-- can only ever set host_id to themselves. status is included because addhome
-- writes 'draft'; that a host can also PATCH status='published' is a separate,
-- value-level moderation-bypass — reported, not fixed here.
--
-- A new listings column now defaults to NOT host-writable: unless a later
-- migration adds it to this grant, the browser role cannot UPDATE it. The guard
-- tests/listings-writable-columns-guard.test.ts fails if a column exists that is
-- neither on this allow-list nor explicitly declared platform-only, so the next
-- column cannot quietly inherit the wrong answer.
--
-- ORDERING. Pure privilege tightening; no code depends on it (the two writers
-- only ever send allow-listed columns). Lands on production on its own, before
-- merge. INSERT is left as it is — a host creating a listing is a draft an admin
-- approves, and the commission is set at approval; the reachable abuse was the
-- UPDATE, and that is what this closes.

revoke update on "public"."listings" from "authenticated";

grant update (
    -- content the host writes (addhome + edit-listing forms)
    "title", "description", "location", "street_address", "postcode",
    "property_type", "privacy_type", "bedrooms", "beds", "bathrooms",
    "amenities", "images", "latitude", "longitude",
    -- pricing the host sets on the wizard
    "price_per_night", "max_guests", "new_listing_promo", "last_minute_discount",
    "weekly_discount", "monthly_discount",
    -- check-in details the host sets
    "check_in_method", "check_in_time", "check_in_end_time", "check_out_time",
    -- the account booking toggles
    "instant_book", "instant_book_requires_phone",
    "stl_licence_status", "stl_licence_number", "stl_licence_expiry",
    -- host_id (pinned to self by the row policy) and status='draft' from the wizard
    "host_id", "status"
) on "public"."listings" to "authenticated";

-- Read back — the platform columns must be ABSENT from authenticated's UPDATE:
--   select column_name from information_schema.role_column_grants
--    where table_name='listings' and grantee='authenticated' and privilege_type='UPDATE'
--      and column_name in ('commission_rate','approved_at','declined_at','rating_avg','ical_token');
--   -- expected: no rows
