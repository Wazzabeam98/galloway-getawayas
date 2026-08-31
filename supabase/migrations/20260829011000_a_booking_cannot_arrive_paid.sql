-- A guest stops being able to write their own booking into existence already
-- confirmed and already paid.
--
-- WHAT WAS WRONG
--
-- The booking row is created in the browser — components/BookingWidget.tsx —
-- and only then handed to app/api/stripe/checkout/route.ts. That is a
-- deliberate design and it is fine in itself: the checkout route recalculates
-- the price from the listing and refuses if the browser's total does not
-- match, so a made-up total buys nothing.
--
-- What was not fine is that the INSERT policy said only this:
--
--   "Guests can create their own bookings"  INSERT  WITH CHECK (guest_id = auth.uid())
--
-- Every other column was the caller's to choose, because the grant was the
-- Supabase default over all 37 of them. So a signed-in account could post a
-- row directly to PostgREST, never going near the checkout route:
--
--   status: 'confirmed'   payment_status: 'paid'   total_price: 0
--
-- A free confirmed stay in somebody else's cottage. Proven against PRODUCTION
-- on 29 August 2026 and deleted again in the same second.
--
-- The exclusion constraint bookings_no_overlapping_confirmed still stops those
-- nights clashing with a genuine confirmed booking, so this could not be used
-- to double-book. It could be used to take nights off the market for nothing,
-- and to put a stay on a host's calendar that nobody paid for.
--
-- Evidence: audit-evidence/01-before-all-four.txt (before),
--           audit-evidence/04-after-bookings.txt (after).
--
-- WHAT THE FIX IS
--
-- Two halves, because either alone leaves a hole:
--
--   the grant   narrowed to the twelve columns the browser actually sends.
--               payment_status, amount_paid, paid_at, commission_rate,
--               payout_amount, deposit_amount, balance_amount and the whole
--               Stripe set stop being writable from a browser at all. They
--               are written by the checkout route, the webhook and the cron
--               runs, every one of which uses the service role and is bound
--               by none of this.
--
--   the policy  a booking may only be CREATED in a state that owes money.
--               Without this, status is still in the granted list — the
--               widget sends it — so 'confirmed' would still be reachable.
--
-- 'pending' as well as 'pending_payment' because 'pending' is the column
-- default, and a row that arrives without a status must not be refused by the
-- rule that exists to stop it arriving CONFIRMED.
--
-- UPDATE IS NARROWED TO THE TWO COLUMNS A HOST ACTUALLY CHANGES. The only
-- browser write is components/BookingActions.tsx, where a host accepts or
-- declines: status and confirmed_at. The existing row filter already said
-- host_id = auth.uid(), which stopped a guest touching someone else's booking
-- — but it let the HOST rewrite total_price, amount_paid, commission_rate and
-- payout_amount on every booking on their own listings, which is a straight
-- line to a larger payout.
--
-- ORDERING. This lands on production before the code merges, so every column
-- here is one the currently deployed browser already sends. Checked by reading
-- every `.from('bookings')` in app/ and components/ that reaches .insert() or
-- .update(): there are exactly two.
--
-- Pre-flight:
--   select count(*) from public.bookings
--    where status = 'confirmed' and payment_status = 'unpaid';
--   -- anything here predates this rule and is worth a look either way.
--
-- Safe to run twice. Run on test first, then production.

revoke insert, update on table "public"."bookings" from "anon", "authenticated";

-- Exactly what components/BookingWidget.tsx sends, and nothing else.
grant insert (
    "listing_id", "guest_id", "host_id", "check_in", "check_out",
    "guests", "adults", "children", "pets", "total_price",
    "status", "confirmed_at"
) on table "public"."bookings" to "authenticated";

-- Exactly what components/BookingActions.tsx sends.
grant update ("status", "confirmed_at")
    on table "public"."bookings" to "authenticated";

-- A booking may be created owing money, and in no other state.
drop policy if exists "Guests can create their own bookings" on "public"."bookings";
create policy "Guests can create their own bookings"
    on "public"."bookings"
    for insert
    to authenticated
    with check (
        "guest_id" = auth.uid()
        and "status" in ('pending', 'pending_payment')
        and "payment_status" = 'unpaid'
        and "confirmed_at" is null
    );

-- Unchanged in what it allows, restated so the WITH CHECK is explicit rather
-- than inherited from USING.
drop policy if exists "Hosts can update booking status on their listings" on "public"."bookings";
create policy "Hosts can update booking status on their listings"
    on "public"."bookings"
    for update
    to authenticated
    using ("host_id" = auth.uid())
    with check ("host_id" = auth.uid());

-- Read back. Must return no rows:
--
--   select column_name, privilege_type
--     from information_schema.column_privileges
--    where table_name = 'bookings'
--      and grantee in ('anon','authenticated')
--      and privilege_type in ('INSERT','UPDATE')
--      and column_name in ('payment_status','amount_paid','amount_refunded',
--                          'paid_at','commission_rate','payout_amount',
--                          'payout_transfer_id','paid_out_at','deposit_amount',
--                          'balance_amount','stripe_payment_intent_id',
--                          'stripe_customer_id','stripe_payment_method_id');
