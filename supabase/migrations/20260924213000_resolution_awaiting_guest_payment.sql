-- A guest accepting a money request now parks the row in a new
-- 'awaiting_guest_payment' state and remembers the Stripe Checkout session that
-- was opened for it, so a second click reuses that one session instead of
-- opening another. A single request can then only ever produce one payment.
--
-- Follows on from 20260924203041_booking_resolutions.sql, which created the
-- table with the status enum inline; this widens that CHECK and adds the column.
-- Additive and safe to run twice. Test first, then production.

alter table public.booking_resolutions
    drop constraint if exists booking_resolutions_status_check;

alter table public.booking_resolutions
    add constraint booking_resolutions_status_check
    check (status in (
        'pending', 'countered', 'paid', 'declined', 'escalated',
        'cancelled', 'expired', 'awaiting_host_payment',
        'awaiting_guest_payment', 'completed'
    ));

-- The Checkout session opened when the guest accepted. Held so a repeat accept
-- returns the same session's URL rather than creating a new one. Service-role
-- only, like the rest of this table — no browser grant.
alter table public.booking_resolutions
    add column if not exists stripe_checkout_session_id text;
