-- A hotel room type gains the same pricing, fee and availability settings a
-- cottage listing has, so the host calendar's right-hand panel (Pricing, Fees,
-- Availability) works per room type exactly as the holiday-let calendar does.
-- Only the fees that apply to a room (extra guest, pet — never cleaning) and the
-- discounts a room can offer. Names match listings so lib/pricing's PricingListing
-- and lib/stayRules read a room type the same way they read a listing.
--
-- min_nights and price_per_night already exist on hotel_room_types. These are
-- written only through /api/hotels/* with the service role; the table already
-- grants table-level SELECT to the browser, so no new grant is needed.

alter table public.hotel_room_types
    add column if not exists max_nights smallint check (max_nights is null or max_nights >= 1),
    add column if not exists advance_notice text,
    add column if not exists extra_guest_fee numeric not null default 0 check (extra_guest_fee >= 0),
    add column if not exists extra_guest_after smallint not null default 1 check (extra_guest_after >= 1),
    add column if not exists extra_guest_period text not null default 'night' check (extra_guest_period in ('night', 'stay')),
    add column if not exists pet_fee numeric not null default 0 check (pet_fee >= 0),
    add column if not exists weekly_discount boolean not null default false,
    add column if not exists monthly_discount boolean not null default false,
    add column if not exists last_minute_discount boolean not null default false;
