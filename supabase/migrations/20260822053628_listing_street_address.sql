-- The street, kept out of `location`.
--
-- `location` was built from seven fields — flat, property name, street, town,
-- region, postcode, country — joined with commas, and it is the only address
-- the listings table has. Guests are not supposed to see the street, so
-- lib/places.ts strips it back off at render time with publicArea().
--
-- That only worked where publicArea() was actually called. It was not called on
-- the messages screen, the invite and trip-invite pages, the dashboard or the
-- booking-confirmed page — all of which printed `location` raw, and two of which
-- are links you send to somebody who has not booked. Those call sites were
-- fixed on 22 August 2026, in the same change as this migration.
--
-- So the street moves to its own column and comes out of `location` entirely.
-- After this, `location` is "Kirkcudbright, Dumfries and Galloway" and there is
-- no street in it to leak.
--
-- Nothing selects this column today. Keep it that way on guest-facing queries.
--
-- LIVE ON BOTH PROJECTS as of 22 August 2026 — nothing here needs running.
-- Additive and nullable, with `if not exists`, so re-running it is a no-op.

alter table public.listings
    add column if not exists "street_address" "text",
    add column if not exists "postcode" "text";

comment on column public.listings."street_address" is
    'Street line(s) only, never the town, region, postcode or country. Not for '
    'guest-facing screens - `location` is the public one. Added 22 August 2026 '
    'when the add-a-property address step moved to getAddress.io.';

comment on column public.listings."postcode" is
    'Postcode on its own. Was previously only ever stored inside `location`, '
    'which is now town and region only. Not guest-facing.';
