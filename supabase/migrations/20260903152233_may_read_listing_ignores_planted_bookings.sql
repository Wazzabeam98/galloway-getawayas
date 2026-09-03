-- may_read_listing() let a PLANTED booking unlock a draft or hidden listing.
--
-- The listings SELECT policy runs through may_read_listing(), whose guest and
-- companion branches asked only whether a bookings row EXISTS joining you to the
-- listing — no status filter. Any signed-in account can insert an unpaid
-- `pending_payment` booking on a listing for free (the checkout INSERT policy
-- allows it), so that existence proves nothing.
--
-- THE EXPLOIT, proven on test 2026-09-03. You cannot plant on a listing you
-- cannot already read (the booking INSERT policy reads the listing's host_id),
-- so a fresh draft is not directly reachable. But: plant on a listing WHILE IT
-- IS PUBLISHED, then the host hides or unpublishes it — the stale planted row
-- keeps the stranger reading the now-hidden listing for ever, through this
-- branch. That is the leak: a host taking a listing down does not shake off a
-- planted booking. (For a still-published listing the branch is moot; the
-- published branch already lets everyone read it.)
--
-- WHY NOT status = 'confirmed' HERE. This function is the floor under "can I see
-- this listing exists at all", not the gate on private data (that is the column
-- grants — see the listing_private view work — and the arrival page). Its own
-- comment states the intent: a guest keeps sight of a listing AFTER the host
-- takes it down, or Your trips loses the stay. A guest with a cancelled or
-- completed booking still needs to open that trip. So the rule is not "confirmed
-- only" — it is "a REAL booking, not a plantable one". The only state a browser
-- can insert is `pending_payment`; every other state (`pending`, `confirmed`,
-- `cancelled`, `completed`, `refunded`, ...) is reached only by the webhook/cron
-- under the service role. Excluding `pending_payment` closes the plant and keeps
-- every genuine booking's access intact.
--
-- The co-host branch is tightened to ACTIVE access at the same time: a revoked
-- or not-yet-accepted listing_access row should not keep sight of the listing.
-- (listing_access is owner-only to insert, so this was never forgeable — it is
-- correctness, not a hole.)
--
-- The owner branch (host = auth.uid()) is unchanged: you always see your own,
-- whatever state it is in.
--
-- ORDERING. Pure tightening of a read policy's helper. No app code depends on
-- the change (the app never relied on a planted booking granting listing read),
-- so it lands on production on its own, before this branch merges.

create or replace function public.may_read_listing(listing uuid, host uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
    select
        -- Yours, whatever state it is in.
        host = auth.uid()

        -- Somebody you trusted with it, and STILL trust: an active co-host.
        -- Any role — being able to READ is the floor under every co-host
        -- permission; the finer grain is decided in lib/access.ts, not here.
        or exists (
            select 1 from listing_access la
            where la.listing_id = listing
              and la.user_id = auth.uid()
              and la.status = 'active'
        )

        -- Somebody who really booked it — not a free planted pending_payment
        -- row. Still true after the host takes the listing down, and for a
        -- cancelled or finished stay, so Your trips and Passport never lose it.
        or exists (
            select 1 from bookings b
            where b.listing_id = listing
              and b.guest_id = auth.uid()
              and b.status <> 'pending_payment'
        )

        -- Somebody else on that real booking.
        or exists (
            select 1 from bookings b
            join booking_guests bg on bg.booking_id = b.id
            where b.listing_id = listing
              and bg.user_id = auth.uid()
              and b.status <> 'pending_payment'
        );
$function$;

-- Read back — the definition must now carry the two status guards:
--   select pg_get_functiondef(oid) from pg_proc where proname = 'may_read_listing';
-- Expected: `la.status = 'active'` and `b.status <> 'pending_payment'` present.
