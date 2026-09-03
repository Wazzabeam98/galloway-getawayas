-- profile_private's counterparty branch required status='confirmed' (added in
-- 20260903011742). But a host can flip a booking on their OWN listing to
-- status='confirmed' directly, WITHOUT payment — the bookings UPDATE grant is
-- {status, confirmed_at} and its policy checks only host_id = auth.uid(), with no
-- value constraint (proven on test 2026-09-03). So 'confirmed' alone does not
-- mean money moved, and this view is what releases the counterparty's email,
-- phone, home address and Stripe/payout fields.
--
-- Bring the SQL twin into step with lib/bookingEntitlement.ts: a booking confers
-- sight of the other party's private columns only when it is confirmed AND paid.
-- 'paid' and 'deposit_paid' both count — a deposit guest with a confirmed stay is
-- a real guest; requiring 'paid' alone would lock a deposit guest out. 'unpaid'
-- (the host-self-confirmed edge, and any planted row) and 'refunded' do not.
--
-- Everything else about the view is unchanged from 20260903011742: the yourself
-- and admin branches, the columns, SECURITY DEFINER, and the grants (restated so
-- a read-back proves nothing regressed).
--
-- ORDERING. Pure tightening of a row filter; no app code depends on it (the app
-- already treats a non-releasing counterparty as none). Lands on production on
-- its own, before its branch merges. `create or replace view` swaps atomically.

create or replace view "public"."profile_private" as
    select p."id", p."full_name", p."preferred_name", p."show_full_name",
           p."avatar_url", p."email", p."phone", p."residential_address",
           p."stripe_account_id", p."stripe_charges_enabled",
           p."stripe_payouts_enabled", p."stripe_details_submitted",
           p."stripe_requirements_due", p."stripe_updated_at",
           p."payout_balance_owed"
      from "public"."profiles" p
     where
        -- yourself
        p."id" = auth.uid()

        -- the other side of a booking you are on — and only a real one: confirmed
        -- AND paid (or deposit-paid). A confirmed-but-unpaid row (a host can make
        -- one on their own listing) no longer counts. Twin of
        -- lib/bookingEntitlement.ts bookingReleasesPrivateData.
        or exists (
            select 1 from "public"."bookings" b
             where b."status" = 'confirmed'
               and b."payment_status" in ('paid', 'deposit_paid')
               and ((b."guest_id" = auth.uid() and b."host_id" = p."id")
                 or (b."host_id" = auth.uid() and b."guest_id" = p."id"))
        )

        -- an admin.
        or exists (
            select 1 from "public"."profiles" me
             where me."id" = auth.uid() and me."is_admin" = true
        );

revoke all on "public"."profile_private" from "anon";
grant select on "public"."profile_private" to "authenticated";

-- Read back:
--   select view_definition from information_schema.views where table_name='profile_private';
-- Expected: the counterparty branch carries payment_status in ('paid','deposit_paid').
