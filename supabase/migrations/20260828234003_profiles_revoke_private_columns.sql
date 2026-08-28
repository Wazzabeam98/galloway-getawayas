-- Take the grants away, now that nothing reads those columns directly.
--
-- STEP THREE OF THREE. Run this ONLY after the code that reads
-- profile_private is live. See the header of the view migration for why the
-- order matters — running this first breaks the account page, the host
-- dashboard, messages and admin payouts on the live site.
--
-- Pre-flight, which is a question about the DEPLOY rather than the database:
--   is the running production build reading profile_private? If not, stop.
--
-- Safe to run twice.

-- Table-level grant out, columns back in. A column-level revoke against a
-- table-level grant is accepted and does NOTHING — see
-- 20260828202340_contact_details_are_not_public.sql, which was written that
-- way first and left everything readable.
revoke select on table "public"."profiles" from "anon", "authenticated";

grant select (
    "id", "full_name", "is_host", "created_at", "preferred_name",
    "show_full_name", "welcome_message", "welcome_message_enabled",
    "identity_verified", "identity_verified_at", "avatar_url", "is_admin"
) on table "public"."profiles" to "anon", "authenticated";

-- Read back:
--   select count(*) from information_schema.column_privileges
--    where table_name = 'profiles' and grantee = 'anon'
--      and privilege_type = 'SELECT'
--      and column_name in ('email','phone','residential_address',
--                          'stripe_account_id','payout_balance_owed');
-- Expected: 0.
