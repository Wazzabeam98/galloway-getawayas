-- The "Send or request money" flow gains its own reasons, stepped like Airbnb's
-- Resolution Centre: a REQUEST is for extra services, damage, or other; a SEND is
-- a goodwill refund, a change to the booking, or other. The money rules are
-- unchanged — only an extra-services request carries the 10% (see
-- lib/resolutions.ts commissionRateFor) — so this only widens the stored set of
-- reasons the column will accept. Dropping and re-adding the check loses no data;
-- every existing row is 'extra_services' or 'damage', both still allowed.
alter table booking_resolutions drop constraint if exists booking_resolutions_reason_check;

alter table booking_resolutions add constraint booking_resolutions_reason_check
    check (reason in ('extra_services', 'damage', 'other', 'goodwill_refund', 'booking_change'));
