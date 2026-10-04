-- A hidden listing takes no new bookings.
--
-- THE HOLE. Hiding a listing (the host's Hide, an admin moderation hide, or the
-- account being deactivated or deleted — all three set status = 'hidden') never
-- stopped a NEW booking. The INSERT policy below only checked who the guest and
-- host were, and the Stripe checkout route never read listings.status. The
-- listings SELECT policy hides a hidden row from strangers, but NOT from anyone
-- who has really booked it before (may_read_listing) — so a past guest with an
-- old link could book and pay for a place the host had taken down.
--
-- THE FIX. Same shape as the experience gate (isLiveToGuests, enforced in
-- app/api/services/order/route.ts): the listing must be 'published' at the
-- moment the row is created. The host_id lookup already reads the listing, so
-- the status test rides on that same subquery — a non-published listing yields
-- NULL, and NULL = host_id is not true, so the insert is refused. The checkout
-- route checks the same thing (lib/listingBookable.ts) for a pending_payment row
-- made before the listing came down.
--
-- WHAT IT DOES NOT TOUCH. INSERT only. Every booking that already exists on a
-- hidden listing keeps working exactly as now — reading it, paying its balance,
-- changing, cancelling, refunding and paying out all run through other policies
-- or the service role, none of which this file changes.
--
-- ORDERING. Pure RLS tightening — no application code depends on it, so it can
-- land on production before or after the branch merges. Safe to run twice.

drop policy if exists "Guests can create their own bookings" on "public"."bookings";
create policy "Guests can create their own bookings"
    on "public"."bookings"
    for insert
    to authenticated
    with check (
        "guest_id" = auth.uid()
        and "host_id" = (
            select "host_id" from "public"."listings"
             where "id" = "listing_id"
               and "status" = 'published'
        )
        and "status" = 'pending_payment'
        and "payment_status" = 'unpaid'
        and "confirmed_at" is null
    );

-- Read back. Must return one row whose with_check carries
-- `status = 'published'::text` inside the listings subquery:
--
--   select policyname, with_check from pg_policies
--    where tablename = 'bookings' and cmd = 'INSERT';
