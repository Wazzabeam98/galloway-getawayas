-- A hotel booking has no single listing, so bookings.listing_id becomes nullable.
--
-- WHY. A cottage booking is one listing for one set of nights, and the GiST
-- exclusion constraint bookings_no_overlapping_confirmed (listing_id WITH =,
-- daterange WITH &&, WHERE status='confirmed') makes that pair unique. A hotel
-- booking references a ROOM TYPE (room_type_id, added in 20261104070128), of
-- which there are N identical rooms, so uniqueness is the wrong model — it is
-- counted against inventory instead (lib/hotelAvailability). A hotel booking
-- therefore carries NO listing_id.
--
-- A NULL listing_id is automatically ignored by the exclusion constraint (an
-- exclusion constraint, like a unique index, skips rows whose key is NULL), so
-- hotel bookings never take part in it and the constraint is left exactly as it
-- is — no change, no weakening. Every cottage booking still has a listing_id,
-- so the cottage money path is untouched: the places that read a booking's
-- listing (settle, host-payouts, balance-charges, cancel) already use
-- .maybeSingle(), and a hotel booking's frozen commission_rate /
-- cancellation_policy mean nothing more is needed from a listing row.
--
-- A booking must still reference exactly one of the two — a listing OR a room
-- type — which the CHECK below enforces, so a booking can never be attached to
-- neither (or both).
--
-- PRE-FLIGHT. Not destructive: one column loosened from NOT NULL, one CHECK
-- added. No data changes — every existing row has a listing_id and no
-- room_type_id, which satisfies the new CHECK.

alter table public.bookings alter column listing_id drop not null;

alter table public.bookings
    drop constraint if exists bookings_listing_or_room_type;
alter table public.bookings
    add constraint bookings_listing_or_room_type
    check ((listing_id is not null) <> (room_type_id is not null));

notify pgrst, 'reload schema';

-- Read back:
--   select is_nullable from information_schema.columns where table_name='bookings' and column_name='listing_id';  -- YES
--   select count(*) from public.bookings where (listing_id is null) = (room_type_id is null);  -- 0 (every row has exactly one)
