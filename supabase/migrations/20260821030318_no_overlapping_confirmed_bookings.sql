-- Two confirmed stays on one property for the same nights must be impossible.
--
-- The application already refuses overlapping dates at checkout, and holds them
-- for half an hour while a guest is at the payment page. Neither is a guarantee:
-- both are checks made before the money moves, and a guest who sits on the
-- Stripe page for longer than the hold can still pay for nights that have since
-- gone. Only the database can actually make it impossible.
--
-- 'confirmed' only. A booking at 'pending' is a request the host has not
-- accepted, and at 'pending_payment' it is somebody at the payment page — two
-- guests genuinely can be in both of those states for the same nights at once,
-- and the application decides between them. What must never happen is two of
-- them coming out the other side.
--
-- Dates are half-open: check_out is the morning the guest leaves, so one stay
-- ending on the 14th and another starting on the 14th do not overlap.

-- BEFORE RUNNING THIS ON PRODUCTION, check nothing already breaks it. The
-- statement below returns any pair of confirmed stays that already share a
-- night. It must return no rows, or the constraint will refuse to be created
-- and you will need to decide what to do about each pair first.
--
--   select a.id, b.id, a.listing_id, a.check_in, a.check_out, b.check_in, b.check_out
--   from public.bookings a
--   join public.bookings b
--     on a.listing_id = b.listing_id
--    and a.id < b.id
--    and a.status = 'confirmed'
--    and b.status = 'confirmed'
--    and daterange(a.check_in, a.check_out, '[)') && daterange(b.check_in, b.check_out, '[)');

create extension if not exists btree_gist;

alter table public.bookings
    add constraint bookings_no_overlapping_confirmed
    exclude using gist (
        listing_id with =,
        daterange(check_in, check_out, '[)') with &&
    )
    where (status = 'confirmed');

comment on constraint bookings_no_overlapping_confirmed on public.bookings is
    'Two confirmed stays cannot share a night on the same listing. The webhook '
    'catches the violation, refunds the guest and apologises.';
