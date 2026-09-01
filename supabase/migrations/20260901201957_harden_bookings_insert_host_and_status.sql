-- A signed-in guest can no longer take another host's nights off the market
-- for free, nor put a confirmed stay on a calendar nobody paid for.
--
-- WHAT WAS STILL WRONG AFTER 20260829011000_a_booking_cannot_arrive_paid.sql
--
-- That migration stopped a booking arriving already CONFIRMED and PAID. It
-- deliberately left two things, and both are reachable from a browser with an
-- ordinary account, never going near the checkout route:
--
--   host_id was the caller's to choose. The INSERT policy only checked
--   guest_id = auth.uid(); host_id was in the granted column list and
--   unvalidated. So an account could post a booking on ANY listing while
--   naming ITSELF as the host:
--
--       listing_id: <someone else's cottage>   guest_id: me   host_id: me
--
--   The row is created 'pending_payment', which the busy-nights view does not
--   count — but the UPDATE policy is `host_id = auth.uid()`, so having named
--   myself the host I may then flip my own row to 'confirmed'. A confirmed,
--   unpaid stay on a cottage I do not own. The exclusion constraint stops it
--   clashing with a real confirmed booking, so it cannot double-book — but it
--   takes those nights off the market for nothing, exactly the outcome the
--   previous migration set out to prevent, reached by a different door.
--
--   'pending' was insertable. The previous policy allowed status in
--   ('pending', 'pending_payment') "because 'pending' is the column default".
--   But listing_busy_nights and the checkout clash query both count 'pending'
--   and 'confirmed' as busy, and NOTHING expires a bare 'pending' row (only
--   the 30-minute hold on 'pending_payment' frees dates again). So an account
--   could insert status:'pending' directly and block a listing's calendar for
--   ever, for free, without a card ever being touched.
--
--   The browser has only ever sent status:'pending_payment' — see
--   components/BookingWidget.tsx, which is the sole client insert. So allowing
--   'pending' bought a legitimate flow nothing and left a permanent-block
--   vector open. Proven on TEST 2026-09-01 (insert as pending → nights show
--   busy; insert with forged host_id → UPDATE to confirmed accepted). The
--   fixtures were deleted in the same session.
--
-- THE FIX
--
--   host_id must be the listing's real owner. A subquery against listings,
--   which anon and authenticated may already read, so the check is evaluable
--   by the caller. This is what closes the self-confirm route: an attacker can
--   no longer name themselves the host, so the host-scoped UPDATE policy can
--   never let them confirm a stranger's booking.
--
--   status must be exactly 'pending_payment'. The one state the browser
--   creates, and the one the busy-nights view does not treat as busy, so an
--   abandoned attempt frees the dates within the half hour instead of never.
--   The webhook and cron move a row on to 'pending' / 'confirmed' with the
--   service role, which no policy here binds.
--
-- Both halves leave the legitimate flow untouched: BookingWidget sends
-- guest_id = me, host_id = the listing's host_id (hostId={home.host_id} in
-- app/homes/[id]/page.tsx), status = 'pending_payment', payment_status default
-- 'unpaid', confirmed_at null.
--
-- ORDERING. Pure RLS tightening — no application code depends on it, so it can
-- and should land on production on its own, before this branch merges.
--
-- Pre-flight, worth a look either way — rows that could not exist under the
-- new rule:
--
--   select id, listing_id, guest_id, host_id, status, payment_status
--     from public.bookings b
--    where status in ('pending','confirmed')
--      and payment_status = 'unpaid'
--      and host_id <> (select host_id from public.listings l where l.id = b.listing_id);
--
-- Safe to run twice.

drop policy if exists "Guests can create their own bookings" on "public"."bookings";
create policy "Guests can create their own bookings"
    on "public"."bookings"
    for insert
    to authenticated
    with check (
        "guest_id" = auth.uid()
        and "host_id" = (
            select "host_id" from "public"."listings" where "id" = "listing_id"
        )
        and "status" = 'pending_payment'
        and "payment_status" = 'unpaid'
        and "confirmed_at" is null
    );

-- Read back. The first must return one row (the new policy); the second must
-- return NO rows (no way to insert anything but pending_payment as the real
-- host):
--
--   select policyname, with_check from pg_policies
--    where tablename = 'bookings' and cmd = 'INSERT';
