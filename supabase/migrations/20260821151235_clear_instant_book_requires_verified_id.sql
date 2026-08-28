-- Turn off any leftover Verified ID requirement on Instant Book.
--
-- The host setting for this has been removed from the account page. Identity
-- checks are not connected to anything — profiles.identity_verified is set only
-- for hosts, by Stripe Connect — so no guest can ever pass one, and
-- BookingWidget already ignores the flag deliberately rather than turning every
-- guest away.
--
-- The column stays. When identity checks are actually connected, the setting
-- can come back and start being honoured. This just makes sure no listing is
-- carrying a true value that nothing in the UI can reach any more.
--
-- Checked before writing this: no listing had it set on either the development
-- or the production database, so this is expected to update zero rows.

update public.listings
set instant_book_requires_verified_id = false
where instant_book_requires_verified_id;
