-- A room type whose price does NOT include breakfast can offer it as a paid
-- extra — a price per person per night the guest can add at booking, the same
-- extras mechanism a cottage listing uses (extras_total / extras_breakdown on
-- the booking). Null means no breakfast extra offered. Only read when
-- breakfast_included is false.
--
-- hotel_room_types already grants table-level SELECT to anon/authenticated (the
-- public page reads a published room), so this column is readable without a new
-- grant; it is written only through /api/hotels/save with the service role.

alter table public.hotel_room_types
    add column if not exists breakfast_price numeric check (breakfast_price is null or breakfast_price > 0);
