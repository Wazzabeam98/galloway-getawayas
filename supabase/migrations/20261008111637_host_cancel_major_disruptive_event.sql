-- A host's cancellation for a major disruptive event, recorded on the booking.
--
-- The cancellation policy (Major disruptive events) and the Host Agreement say:
-- when something official stops a stay going ahead — a government travel
-- restriction, an evacuation, police or the council closing access, or a
-- widespread loss of power or water at the property — the guest asks the host,
-- and the host cancels choosing "A major disruptive event stops this stay". The
-- guest is refunded in full (as on every host cancellation) and the 5% host
-- cancellation fee is not taken. The host says so; nobody at Galloway Getaways
-- reviews or decides it.
--
-- bookings.cancelled_for_major_event records that the host chose it, set only
-- by /api/stripe/refund (service role) when the HOST cancels a confirmed stay.
-- It is the record a later question about a waived fee is answered from. The
-- browser cannot write it: bookings insert/update are column grants and this
-- column is not added to them.

alter table "public"."bookings"
    add column if not exists "cancelled_for_major_event" boolean not null default false;

comment on column "public"."bookings"."cancelled_for_major_event" is
    'Host cancelled this confirmed stay for a major disruptive event (no 5% host cancellation fee). Set only by /api/stripe/refund.';

notify pgrst, 'reload schema';

-- Read back:
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--    where table_name = 'bookings' and column_name = 'cancelled_for_major_event';
--   -- expected: boolean NO false
--   select count(*) from information_schema.column_privileges
--    where table_name = 'bookings' and column_name = 'cancelled_for_major_event'
--      and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE');
--   -- expected: 0
