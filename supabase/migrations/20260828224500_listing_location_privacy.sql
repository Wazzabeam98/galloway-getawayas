-- Keep a property's exact location off the public API.
--
-- PRE-FLIGHT: none. Two generated columns and a change of grants. No row is
-- modified. Safe to run twice.
--
-- RUN THIS ON PRODUCTION AND CHECK IT THERE. `scripts/check-anon-exposure.mjs
-- --prod` before and after. Test cannot demonstrate this class of problem:
-- production and test have DIVERGED on grants, and on 28 August 2026 `anon`
-- held table-level SELECT on `bookings` and `profiles` on production and on
-- neither on test. A probe of test reported both safe while production was
-- handing out phone numbers.
--
-- WHAT WAS WRONG
--
-- `listings` granted table-level SELECT to `anon`, so every column was public.
-- Measured against production with the anon key on 28 August 2026:
--
--     4 bedroom Townhouse, Kirkcudbright   lat=54.83804  lon=-4.04878
--
-- That is the property, to a few metres. components/PropertyMap.tsx offsets the
-- pin by about 60m in the BROWSER — from coordinates already sent to it — and
-- the page says "the approximate area, not the exact property". Both were true
-- of the picture and neither was true of the data. The other two listings
-- returned nothing only because no address has been entered yet; the moment a
-- host completes that step, theirs is exposed the same way.
--
-- `ical_token` and `commission_rate` were public for the same reason. The token
-- is the whole secret in a listing's calendar-export URL, so anyone could have
-- pulled its bookings; that is why it is on the list below and it is the reason
-- to prefer naming what may be read over naming what may not.
--
-- THE APPROACH: GRANTS, NOT A NARROWER POLICY
--
-- A policy decides which ROWS. This is about which COLUMNS, which only grants
-- can express. The row rule stays exactly as it was — published listings are
-- public, everything else needs a relationship.
--
-- Revoking a column while a TABLE-level grant stands does nothing: the table
-- grant still permits the read. So the table grant goes and the columns that
-- may be read are named. That also makes `select('*')` fail for `anon`, which
-- is deliberate and is why app/homes/[id]/page.tsx now names its columns — a
-- new sensitive column can no longer arrive in the page source by accident.
--
-- THE PIN
--
-- approx_latitude/approx_longitude round to three decimal places, about 110m —
-- close to the 60m the browser was already applying, so the map is no less
-- useful than it was yesterday, and the exact figure never leaves the server.
-- Coarser is a product decision, not a technical one: change the 3 below.
--
-- An exact location for a confirmed guest is NOT part of this. Nothing shows it
-- today, and adding a route that hands it out belongs with the change that
-- needs it.

alter table public.listings
    add column if not exists approx_latitude  numeric
        generated always as (round(latitude::numeric, 3)) stored,
    add column if not exists approx_longitude numeric
        generated always as (round(longitude::numeric, 3)) stored;

comment on column public.listings.approx_latitude is
    'latitude rounded to ~110m, for the public map pin. The exact column is not '
    'readable by anon — see 20260828224500_listing_location_privacy.sql.';

-- Named as an allow-list rather than revoked one at a time, so a column added
-- later is private until somebody decides otherwise. That is the safe
-- direction: the cost of forgetting is a blank field on a page, not a leak.
revoke select on public.listings from anon;

grant select (
    id, host_id, title, description, location,
    approx_latitude, approx_longitude,
    price_per_night, max_guests, images, created_at,
    property_type, privacy_type, bedrooms, beds, bathrooms, amenities,
    new_listing_promo, last_minute_discount, weekly_discount, monthly_discount,
    status, ical_import_url, min_nights, max_nights,
    events_allowed, smoking_allowed, quiet_hours_enabled, quiet_hours_start,
    quiet_hours_end, commercial_photography_allowed,
    checkin_start, checkin_end, checkout_time, additional_rules,
    cancellation_policy, non_refundable_option, weekend_price, cleaning_fee,
    pet_fee, extra_guest_fee, advance_notice, preparation_time,
    availability_window, instant_book, instant_book_requires_phone,
    instant_book_requires_verified_id, check_in_time, check_out_time,
    stl_licence_number, stl_licence_expiry, stl_licence_status,
    check_in_method, nearby,
    rating_avg, rating_count, rating_cleanliness, rating_accuracy,
    rating_checkin, rating_communication, rating_location, rating_value,
    damage_deposit, extra_guest_after, extra_guest_period, check_in_end_time,
    storey_band, plot_band, review_note, approved_at, declined_at
) on public.listings to anon;

-- Deliberately NOT granted to anon:
--   latitude, longitude   the property, to a few metres
--   street_address        the doorstep
--   postcode              the doorstep, near enough
--   ical_token            the secret in the calendar-export URL
--   commission_rate       what this host pays us; nobody else's business
--
-- `authenticated` is untouched. A signed-in host reads their own listing, and
-- the row policy already holds them to their own, their co-hosted ones, and
-- ones they have booked.
