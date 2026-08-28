-- A tradesman's phone number stops being readable by anyone with the site key.
--
-- WHAT WAS WRONG
--
-- Withholding contact details until somebody accepts is not a feature of the
-- enquiry flow, it IS the flow — the accept is the only event the platform can
-- charge for, and the details are the thing it is trading. That was enforced
-- entirely by which columns each page chose to SELECT, which is not
-- enforcement: 20260827185827_provider_status_grants granted `select` on the
-- whole of service_providers to anon, so one REST call with the public key
-- returned every approved tradesman's number and address whatever any page
-- rendered.
--
-- Verified rather than assumed. scripts/enquiry-rls.mjs asks for
-- business_name, contact_phone and contact_email as an anonymous caller, and
-- before this migration it got all three for every approved provider.
--
-- WHY COLUMN GRANTS AND NOT A POLICY
--
-- Row-level security is per row. The requirement here is per COLUMN and the
-- same for every row, so a policy cannot express it and column grants can.
--
-- THE THREE READERS THAT LEGITIMATELY EXIST, AND HOW EACH KEEPS WORKING
--
--   the shop            never selected these columns. Unaffected.
--
--   the platform        every email and every text reads the provider through
--                       adminClient under the service role, which no grant
--                       here binds. Nothing is put in front of the emails that
--                       reach tradesmen — that mattered enough to check first.
--
--   the tradesman       needs his own to edit them, and a column grant cannot
--                       say "his own row". Hence the view below.
--
--   the host, after     gets a SNAPSHOT on the enquiry rather than a live read,
--   an accept           written by the respond route under the service role.
--                       Same pattern as price_snapshot and business_name, and
--                       better than a join: the number as it was when he
--                       accepted, on a row the host already owns.
--
-- ANON IS REVOKED AND SO IS AUTHENTICATED, deliberately. Signing up is free
-- and automatic, so "signed in" is not a meaningfully smaller population than
-- "anyone with the key" — leaving it for authenticated would move the bar
-- rather than raise it.
--
-- Pre-flight:
--   select privilege_type, count(*) from information_schema.column_privileges
--    where table_name = 'service_providers' and grantee = 'anon'
--    group by privilege_type;
--
-- Safe to run twice. Run on test first, then production.

-- REVOKE THE TABLE, THEN GRANT THE COLUMNS BACK. This is the part that is easy
-- to get wrong and looks right either way.
--
-- `revoke select (contact_email, contact_phone) on service_providers from anon`
-- is accepted by Postgres and does NOTHING, because the existing privilege is
-- a TABLE-level grant and a column-level revoke cannot cut a hole in one. The
-- first version of this file did exactly that: it ran clean, committed, and
-- left the numbers as readable as before. The read-back at the bottom is what
-- caught it, which is why every migration in this folder has one.
--
-- So the table grant goes, and the columns that are safe are named. Anything
-- added to this table later is NOT readable until it is added here — which
-- fails closed, shows up the first time a page needs it, and is the right way
-- round for a table holding contact details.
revoke select on table "public"."service_providers" from "anon", "authenticated";

grant select (
    "id", "owner_id", "business_name", "trade", "description", "photos",
    "audience", "kind", "status", "review_note", "submitted_at", "approved_at",
    "declined_at", "plan", "settlement", "notify_user_ids", "created_at",
    "updated_at", "changes_pending_at", "approved_digest", "callout_fee",
    "hourly_rate", "commission_rate", "logo", "does_gas", "does_oil",
    "callout_waived", "trial_ends_at", "pricing_choice", "billable_hourly_rate",
    "covered_bands", "sms_opt_out"
) on table "public"."service_providers" to "anon", "authenticated";

-- HIS OWN, AND NOBODY ELSE'S.
--
-- A SECURITY DEFINER view on purpose, which is the unusual choice and the
-- correct one here. `security_invoker = true` would re-check the caller's
-- column privileges on service_providers — the very privileges just revoked —
-- so the view would be as blind as the caller and useless.
--
-- Definer means the row filter has to live in the view itself rather than in a
-- policy, and it does: `owner_id = auth.uid()` is not a default that a caller
-- can widen, it is the whole of what the view can ever return. A caller with
-- no session gets auth.uid() = null and therefore nothing.
create or replace view "public"."service_provider_own_contacts" as
    select "id", "owner_id", "contact_email", "contact_phone"
      from "public"."service_providers"
     where "owner_id" = auth.uid();

revoke all on "public"."service_provider_own_contacts" from "anon";
grant select on "public"."service_provider_own_contacts" to "authenticated";

-- WHAT THE HOST GETS ON AN ACCEPT
--
-- Written by the respond route under the service role, never from a browser —
-- there is no grant for these and there must not be one. A host who could
-- write their own copy of a phone number would have given themselves the thing
-- the accept exists to release.
alter table "public"."service_enquiries"
    add column if not exists "provider_phone" text;
alter table "public"."service_enquiries"
    add column if not exists "provider_email" text;

-- Read back:
--   select column_name from information_schema.column_privileges
--    where table_name = 'service_providers' and grantee = 'anon'
--      and column_name in ('contact_email', 'contact_phone');
--
-- Expected: no rows. And scripts/enquiry-rls.mjs should go green.
