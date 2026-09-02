-- The browser can WRITE to profile_private and service_provider_own_contacts,
-- and through them straight into the profiles / service_providers base tables,
-- bypassing RLS and the column revokes those tables carefully apply. This is a
-- payout-redirection vector and it is worse than the read leak the sibling
-- migration (20260903011742) closes.
--
-- HOW IT IS OPEN
--
-- Supabase's project bootstrap runs `grant all on all tables in schema public
-- to anon, authenticated`, and a VIEW is a table for that grant. The migrations
-- that built these two views (20260828234001 profile_private, and the provider
-- contacts view) added `grant select` and revoked anon — but never revoked the
-- inherited INSERT/UPDATE from `authenticated`. Live grants, test project
-- 2026-09-03:
--
--   profile_private                 authenticated: INSERT,REFERENCES,SELECT,TRIGGER,UPDATE
--   service_provider_own_contacts   authenticated: INSERT,REFERENCES,SELECT,TRIGGER,UPDATE
--
-- Both views are SECURITY DEFINER (security_invoker is OFF), owned by `postgres`,
-- which is rolbypassrls. A write through the view therefore executes AS postgres:
-- it bypasses the base table's RLS and ignores the very column privileges the
-- base table revoked from browser roles. And neither view has WITH CHECK OPTION,
-- so an UPDATE is not even confined to rows the WHERE returns for its SET list —
-- it may set the visible rows to anything.
--
-- THE CONSEQUENCE, PROVEN ON TEST 2026-09-03
--
-- A signed-in guest on a booking with a host (after 20260903011742, a CONFIRMED
-- booking; before it, any planted pending_payment booking) issues:
--
--   PATCH /rest/v1/profile_private?id=eq.<hostId>   { "stripe_account_id": "<attacker acct>" }
--
-- and the host's real profiles.stripe_account_id is overwritten. On a platform
-- whose entire job is paying other people's money to the right account, that is
-- the account the next payout is sent to. email, phone, residential_address and
-- payout_balance_owed are writable the same way. service_provider_own_contacts
-- exposes contact_email / contact_phone identically, and — no CHECK OPTION — an
-- INSERT can name another user's owner_id.
--
-- THE FIX
--
-- These views exist to be READ. Take every write privilege back from the browser
-- roles and leave SELECT exactly as each view intends (profile_private and the
-- provider contacts view: authenticated only; anon already has none). The
-- service role and postgres are unaffected — no grant here binds them — so every
-- cron, webhook and admin route that writes profiles/service_providers through
-- the service key keeps working. listing_busy_nights is already SELECT-only to
-- both roles (verified) and is left alone.
--
-- This is a general trap, so the revoke is written to be copied for any future
-- browser-facing view: create the view, grant SELECT, revoke the rest.
--
-- ORDERING. Pure privilege tightening. No application code writes these views
-- (all writes go through the service role), so nothing depends on the grant and
-- this lands on production on its own, before the branch merges. Alongside its
-- sibling 20260903011742; order between the two does not matter.
--
-- Read-back is at the foot.

revoke insert, update, delete, truncate, references, trigger
    on "public"."profile_private" from "authenticated", "anon";
revoke insert, update, delete, truncate, references, trigger
    on "public"."service_provider_own_contacts" from "authenticated", "anon";

-- Restate the reads these views are for, so a read-back proves the end state and
-- an accidental over-revoke would show up here.
grant select on "public"."profile_private" to "authenticated";
grant select on "public"."service_provider_own_contacts" to "authenticated";

-- Read back — both must show SELECT and nothing else for authenticated, and no
-- anon row:
--   select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) privs
--     from information_schema.role_table_grants
--    where table_name in ('profile_private','service_provider_own_contacts')
--      and grantee in ('anon','authenticated')
--    group by table_name, grantee;
