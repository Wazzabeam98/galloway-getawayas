-- Custom, host-authored scheduled messages.
--
-- Until now a host could only fill in the four message types we chose
-- (booking_confirmation, checkin_details, checkin_day, checkout_details). This
-- adds a fifth kind, 'custom', for a message a host writes themselves with their
-- own trigger and their own timing — the Airbnb-style "scheduled message" that
-- isn't one of our four purposes.
--
-- The timing engine already supports every anchor a custom message needs
-- (booking / check_in / check_out / after_check_in / before_check_out, plus a
-- new after_check_out handled in code) off the existing offset columns, so no
-- new columns are needed. Two guardrails built for the four fixed types have to
-- make room for the new kind.

-- 1. The template_type CHECK allowed exactly the four preset keys, so any other
--    value was refused outright. Widen it to accept 'custom'. (Widen the
--    constraint before the new value is ever written, never the other way round.)
alter table public.message_templates
    drop constraint if exists message_templates_template_type_check;

alter table public.message_templates
    add constraint message_templates_template_type_check
    check (template_type = any (array[
        'booking_confirmation',
        'checkin_details',
        'checkin_day',
        'checkout_details',
        'custom'
    ]));

-- 2. One-template-per-type-per-listing is right for the four fixed purposes — a
--    listing has one check-in message, and the index stops a second naming the
--    same place and sending a guest the wrong door code. It is wrong for custom
--    messages, which are independent of one another: a host may well want two or
--    three custom messages all covering the same listing. Rebuild the unique
--    scope index so it does NOT apply to 'custom' rows. The four fixed types are
--    still held to one per listing exactly as before.
drop index if exists public.message_template_listings_one_per_type_idx;

create unique index message_template_listings_one_per_type_idx
    on public.message_template_listings (user_id, template_type, listing_id)
    where template_type <> 'custom';
