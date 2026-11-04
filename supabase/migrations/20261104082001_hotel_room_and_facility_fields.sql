-- Hotel room + facility fields, for the reworked sign-up (Liam's walkthrough).
--
-- The phase-one hotel tables carried the minimum. The reworked wizard (mirroring
-- /addhome) asks what Booking.com asks per room — a proper bed picker, bathroom,
-- view, smoking, accessibility, in-room amenities, and breakfast-per-room — and a
-- few hotel-level extras a holiday let has no field for (parking type + cost,
-- restaurant hours). These are those columns. All additive and NULLABLE (or with
-- a safe default), applied to TEST only; hotels stay off master/production until
-- Liam says so.
--
-- Notes:
--   * max_occupancy stays a column (availability/pricing read it) but the wizard
--     no longer asks for it — it is set to max_adults + max_children on save.
--   * breakfast_included is per ROOM here, following Liam's instruction. (On
--     Booking.com breakfast is a rate-plan attribute; rate plans are a later
--     phase, so per-room is the phase-one home for it.)
--   * In-room amenities reuse the existing hotel_room_types.amenities text[].
--   * Hotel facilities reuse the existing hotels.facilities text[]; only the
--     sub-fielded extras (parking cost, restaurant hours) need columns.
--
-- PRE-FLIGHT. Not destructive: new nullable/defaulted columns on two tables.

alter table public.hotel_room_types
    add column if not exists bathroom_type text
        check (bathroom_type in ('private', 'shared')),
    add column if not exists bathroom_features text[] not null default '{}',
    add column if not exists views text[] not null default '{}',
    add column if not exists smoking text not null default 'non_smoking'
        check (smoking in ('non_smoking', 'smoking', 'both')),
    add column if not exists accessibility text[] not null default '{}',
    add column if not exists breakfast_included boolean not null default false;

alter table public.hotels
    add column if not exists parking_type text not null default 'none'
        check (parking_type in ('none', 'private', 'public', 'street')),
    -- NULL / 0 = free (or no parking); a positive number = price per night.
    add column if not exists parking_price numeric,
    add column if not exists restaurant_hours text;

-- The browser reads these back on the public hotel page and the owner editor, so
-- grant SELECT on the new hotel columns to the browser roles (none is sensitive;
-- the sensitive set stays commission_rate + vat_number, untouched here).
grant select (parking_type, parking_price, restaurant_hours) on public.hotels to anon, authenticated;

notify pgrst, 'reload schema';

-- Read back:
--   select column_name from information_schema.columns where table_name='hotel_room_types' and column_name in ('bathroom_type','bathroom_features','views','smoking','accessibility','breakfast_included') order by column_name;  -- 6 rows
--   select column_name from information_schema.columns where table_name='hotels' and column_name in ('parking_type','parking_price','restaurant_hours') order by column_name;  -- 3 rows
