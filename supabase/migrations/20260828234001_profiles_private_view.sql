-- SPLIT IN TWO, AND THE ORDER IS THE WHOLE POINT.
--
-- This pair of changes cannot land as one migration, because a REVOKE is the
-- case where "schema ahead of code" is not free. The standing rule in
-- MAINTENANCE.md says a migration goes to production before the code that
-- depends on it, and the reasoning it gives is that an unused column or a
-- widened check costs nothing while a missing one fails at the database.
--
-- Taking a grant away inverts that. Run the revoke first and the LIVE code —
-- which still reads those columns directly — breaks until the deploy lands.
-- Deploy first and the new code reads views that do not exist yet. Either
-- single order has a window in which the site is broken.
--
-- So there are three steps and no window:
--
--   1. this file, and its bookings twin — create the views. Additive; nothing
--      reads them yet and nothing breaks.
--   2. deploy the code, which starts reading the views.
--   3. the revoke files — take the grants away, once nothing needs them.
--
-- A stranger gets a name, an avatar and nothing else.
--
-- WHAT WAS WRONG
--
-- `Public profiles are viewable by everyone.` is USING (true), and select was
-- granted on the whole table to anon. Row-level security is per ROW, so that
-- policy — which is right, a guest has to see a host's name — handed over
-- every COLUMN of every profile to anybody holding the key compiled into the
-- front end: email, phone, residential_address, stripe_account_id,
-- payout_balance_owed, the lot.
--
-- Verified before and after with scripts/data-privacy-rls.mjs, which asks with
-- the anon key. Before this migration it read a phone number and a home
-- address straight out.
--
-- NO POLICY IS TOUCHED, AND THAT IS DELIBERATE
--
-- The obvious fix is to narrow the SELECT policy, and it is the wrong one: it
-- is how the listings work an hour earlier ended up refusing the home page,
-- and a policy that reads `profiles` to decide who may read `profiles` is the
-- recursion waiting underneath it. The requirement here is per COLUMN and the
-- same for every row, which grants express exactly and policies cannot express
-- at all. So USING (true) stays and the columns move.
--
-- THE READERS, ALL OF THEM, AND WHERE EACH ENDS UP
--
--   the platform          reads through the service role, which no grant here
--                         binds. Every cron, the Stripe webhook and the admin
--                         API routes are untouched.
--
--   a stranger            keeps id, full_name, preferred_name,
--                         show_full_name, avatar_url and the flags a listing
--                         page needs. That is what a guest sees of a host.
--
--   yourself              the whole row, through profile_private below.
--
--   your counterparty     a host needs their guest's phone; a guest needs
--                         their host's. Both have a booking between them, and
--                         the view says so in SQL rather than in a comment.
--
--   an admin              everything, through the same view.
--
-- stripe_payouts_enabled goes private with the rest. It says only "this host
-- can be paid", which is mild on its own — but it tells anyone looking which
-- hosts are not set up to take money, and one Stripe field left public is the
-- exception that gets forgotten and then extended. app/homes/[id]/page.tsx is
-- a server component and reads it through the service role instead, which
-- costs nothing there.
--
-- YOURSELF, YOUR COUNTERPARTY, OR AN ADMIN.
--
-- SECURITY DEFINER, like service_provider_own_contacts and for the same
-- reason: security_invoker would re-check the column privileges just revoked
-- and the view would be as blind as its caller.
--
-- Definer means the row filter is the whole of the protection, so it is
-- written to be read: three branches, no defaults, and auth.uid() null for a
-- signed-out caller matches none of them.
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
        -- guest": a row has to exist joining the two of you.
        or exists (
            select 1 from "public"."bookings" b
             where (b."guest_id" = auth.uid() and b."host_id" = p."id")
                or (b."host_id" = auth.uid() and b."guest_id" = p."id")
        )

        -- an admin. Reads profiles to decide, which is safe here and would not
        -- be in a policy: a view is not consulted while evaluating itself.
        or exists (
            select 1 from "public"."profiles" me
             where me."id" = auth.uid() and me."is_admin" = true
        );

revoke all on "public"."profile_private" from "anon";
grant select on "public"."profile_private" to "authenticated";

-- Read back:
--   select count(*) from information_schema.views where table_name = 'profile_private';
-- Expected: 1. Nothing is revoked by this file.
