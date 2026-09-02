-- profile_private handed a host's email, phone, home address, Stripe account id
-- and outstanding payout balance to ANY signed-in account that could get a
-- booking row to join the two of them — and any account can, for free.
--
-- WHAT WAS WRONG
--
-- The counterparty branch added in 20260828234001_profiles_private_view.sql was:
--
--   or exists (select 1 from bookings b
--      where (b.guest_id = auth.uid() and b.host_id = p.id)
--         or (b.host_id = auth.uid() and b.guest_id = p.id))
--
-- No status filter. The comment above it — "a row has to exist joining the two
-- of you" — is exactly the flaw: a row existing is not a relationship existing.
-- The bookings INSERT policy (20260901201957) deliberately lets a browser create
-- a `pending_payment` / `unpaid` booking on any listing (the checkout needs to),
-- so any signed-in account can manufacture a row joining itself to any host and
-- then read this view. Proven end to end on the test project 2026-09-03: an
-- attacker with no relationship to a host planted one unpaid booking and read the
-- host's email, phone, stripe_account_id and payout_balance_owed straight over
-- PostgREST; deleting the planted row made the read return null again. The
-- booking was the only key.
--
-- THE FIX
--
-- The counterparty branch now requires `b.status = 'confirmed'`. A booking
-- confers sight of the other party's private columns only once it is a real,
-- host-accepted, paid stay — the same rule the app's arrival page, /api/trips
-- and contactNumberVisible now share through lib/bookingEntitlement.ts
-- (bookingReleasesPrivateData), and the same rule the scheduled-message sender
-- and upcomingUntilCheckout already used. `pending_payment` (planted/abandoned),
-- `pending` (paid but not yet accepted), and cancelled/declined/refunded/expired
-- all stop conferring it. The `yourself` and `admin` branches are unchanged, so
-- a host never loses sight of their own row and admin tooling is untouched.
--
-- WHY A VIEW, NOT A POLICY (unchanged from the original, restated so this file
-- reads on its own): the requirement is per-COLUMN and identical for every row,
-- which grants express and policies cannot; and a policy that read `profiles` to
-- decide who may read `profiles` is a recursion. SECURITY DEFINER for the same
-- reason as before — security_invoker would re-check the revoked column
-- privileges and blind the view to its own caller. So the row filter is the
-- whole of the protection and is written to be read: three branches, no
-- defaults, auth.uid() null (a signed-out caller) matches none.
--
-- ORDERING. Pure tightening of a row filter. No application code depends on this
-- change — the app already treats a non-confirmed counterparty as no
-- counterparty — so it can and should land on production on its own, before this
-- branch merges. `create or replace view` swaps the definition atomically with
-- no window. No grant is touched.
--
-- Pre-flight, safe to run, read-only — the private rows a non-confirmed booking
-- can currently reach and will stop reaching:
--
--   select count(*) from public.bookings
--    where status <> 'confirmed'
--      and (guest_id is not null and host_id is not null);
--
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

        -- the other side of a booking you are on. Not "any host" and not "any
        -- guest", and — the fix — not any BOOKING: only a confirmed stay. A
        -- planted `pending_payment` row, or a paid-but-unaccepted `pending`
        -- request, no longer counts. See lib/bookingEntitlement.ts for the twin.
        or exists (
            select 1 from "public"."bookings" b
             where b."status" = 'confirmed'
               and ((b."guest_id" = auth.uid() and b."host_id" = p."id")
                 or (b."host_id" = auth.uid() and b."guest_id" = p."id"))
        )

        -- an admin. Reads profiles to decide, which is safe here and would not
        -- be in a policy: a view is not consulted while evaluating itself.
        or exists (
            select 1 from "public"."profiles" me
             where me."id" = auth.uid() and me."is_admin" = true
        );

-- The original file's grants stand — this touches only the WHERE. Restated so a
-- read-back proves nothing regressed: anon has no select, authenticated does.
revoke all on "public"."profile_private" from "anon";
grant select on "public"."profile_private" to "authenticated";

-- Read back:
--   select count(*) from information_schema.views where table_name = 'profile_private';
-- Expected: 1.
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'profile_private';
-- Expected: authenticated / SELECT only; no anon row.
