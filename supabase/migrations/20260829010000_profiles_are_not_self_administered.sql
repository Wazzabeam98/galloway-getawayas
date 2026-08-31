-- A user stops being able to make themselves an admin, or to say what they
-- are owed.
--
-- WHAT WAS WRONG
--
-- One policy, and it reads as though it were safe:
--
--   "Users can update own profile."  UPDATE  USING (auth.uid() = id)
--
-- A policy decides WHICH ROWS. It has nothing to say about WHICH COLUMNS —
-- those come from the grant, and the grant was the untouched Supabase default,
-- `grant all on all tables in schema public to anon, authenticated`. So "own
-- profile" meant all 22 columns of it, including:
--
--   is_admin              the whole of what the admin screens check
--   payout_balance_owed   what the platform believes it owes this person
--   identity_verified     the badge shown to hosts before they accept a guest
--   stripe_account_id     which connected account gets paid
--
-- Proven against PRODUCTION on 29 August 2026, not reasoned about. An account
-- created through the public signup form — no invitation, no approval — set
-- is_admin = true on its own row and the write went through. From there,
-- app/api/admin/commission/route.ts sets commission_rate on ANY listing to
-- anything between 0 and 100. The route is not at fault: it uses getUser()
-- rather than getSession() and re-checks is_admin server-side every time. The
-- fault is that is_admin was a column its subject could write.
--
-- Evidence: audit-evidence/01-before-all-four.txt (before),
--           audit-evidence/03-after-profiles.txt (after).
--
-- WHY COLUMN GRANTS AND NOT A BETTER POLICY
--
-- The same reasoning as 20260828202340_contact_details_are_not_public.sql.
-- The requirement is per COLUMN and identical for every row, so a policy
-- cannot express it and a grant can. A policy could be written with a
-- subquery comparing old and new values, but that is a trigger in disguise,
-- it runs per row, and it is one clever expression away from being wrong.
--
-- REVOKE THE TABLE, THEN NAME THE COLUMNS. A column-level revoke against a
-- table-level grant is accepted by Postgres and does NOTHING — the mistake
-- 20260828202340 was written with the first time, which ran clean and changed
-- nothing. So the table grant goes and the safe columns come back by name.
--
-- Anything added to profiles later is NOT writable until it is named here.
-- That fails closed, and shows up the first time a form needs it.
--
-- ANON GETS NOTHING. Both browser paths that write a profile — the signup
-- modal and the provider sign-up — upsert only after `data.session` exists, so
-- they are authenticated by then. A profile row is created for every new user
-- by the add_profile_for_new_user trigger regardless.
--
-- ORDERING. This runs on PRODUCTION BEFORE the code merges, so it must not
-- break the build that is live right now. Every column named below is one the
-- deployed browser code actually sends:
--
--   account page       full_name, preferred_name, phone, residential_address,
--                      avatar_url, show_full_name  (each upserted with id and
--                      email, which is why both of those are here too)
--   signup modal       id, email, full_name, is_host
--   provider sign-up   id, email, full_name, is_host
--
-- Checked by reading every `.from('profiles')` in app/ and components/ that
-- reaches .update() or .upsert(). welcome_message and welcome_message_enabled
-- are deliberately NOT granted: nothing in the repo reads or writes them.
--
-- Pre-flight, on the project you are about to run this against:
--   select privilege_type, count(*) from information_schema.column_privileges
--    where table_name = 'profiles' and grantee in ('anon','authenticated')
--    group by privilege_type;
--
-- Safe to run twice. Run on test first, then production.

revoke insert, update on table "public"."profiles" from "anon", "authenticated";

-- INSERT and UPDATE carry the same list. The account page uses upsert(), which
-- is INSERT ... ON CONFLICT DO UPDATE and sets every supplied column on both
-- paths — so a column granted for one and not the other breaks the form in a
-- way that only shows up on the second save.
--
-- `id` is in the UPDATE list for that reason and no other. It cannot be used
-- to become somebody else: the policy's USING clause is applied to the new row
-- as well as the old one, and the WITH CHECK added below says so out loud
-- rather than leaving it to be inferred.
grant insert (
    "id", "email", "full_name", "preferred_name", "phone",
    "residential_address", "avatar_url", "show_full_name", "is_host"
) on table "public"."profiles" to "authenticated";

grant update (
    "id", "email", "full_name", "preferred_name", "phone",
    "residential_address", "avatar_url", "show_full_name", "is_host"
) on table "public"."profiles" to "authenticated";

-- The policy already restricted the row. Restating the check explicitly so
-- that a future reader does not have to know that a missing WITH CHECK falls
-- back to USING — which is true, is easy to forget, and is the difference
-- between "you may edit your row" and "you may edit your row into somebody
-- else's".
drop policy if exists "Users can update own profile." on "public"."profiles";
create policy "Users can update own profile."
    on "public"."profiles"
    for update
    to authenticated
    using (auth.uid() = "id")
    with check (auth.uid() = "id");

drop policy if exists "Users can insert their own profile." on "public"."profiles";
create policy "Users can insert their own profile."
    on "public"."profiles"
    for insert
    to authenticated
    with check (auth.uid() = "id");

-- Read back. Both must return no rows:
--
--   select column_name, privilege_type
--     from information_schema.column_privileges
--    where table_name = 'profiles'
--      and grantee in ('anon','authenticated')
--      and privilege_type in ('INSERT','UPDATE')
--      and column_name in ('is_admin','payout_balance_owed','identity_verified',
--                          'identity_verified_at','stripe_account_id',
--                          'stripe_charges_enabled','stripe_payouts_enabled',
--                          'stripe_details_submitted','stripe_requirements_due',
--                          'stripe_updated_at','created_at');
--
--   select * from information_schema.column_privileges
--    where table_name = 'profiles' and grantee = 'anon'
--      and privilege_type in ('INSERT','UPDATE');
--
-- And scripts/write-side-rls.mjs --target prod should stop reporting
-- "user cannot make themselves an admin" and "user cannot set what they are
-- owed" as writable.
