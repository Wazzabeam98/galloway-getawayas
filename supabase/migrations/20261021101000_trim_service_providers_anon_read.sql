-- Take internal / commercial columns out of the public (anon) read of
-- service_providers.
--
-- WHY. A logged-out visitor's REST read of service_providers returned
-- notify_user_ids (internal user UUIDs), owner_id, plan, subscription_status
-- and trial_ends_at — the provider's commercial arrangement with the platform
-- and internal ids, on an endpoint anyone can hit. Audit 2026-10-21, finding
-- F2. None of these are guest-facing, and NOTHING in the app reads
-- service_providers through the anon/authenticated browser client — every
-- public experience/trade page loads it with the SERVICE ROLE (lib/experiencesData
-- uses adminClient), which is not subject to column grants — so revoking these
-- anon SELECT grants cannot empty a public page (there is no anon select on this
-- table in the codebase to break).
--
-- Scope is exactly the five columns the audit named. Other arguably-internal
-- anon-readable columns (registration_number, review_note, approved_digest) are
-- left for a separate, deliberate pass.
--
-- PRE-FLIGHT: none. REVOKE loses no data and needs no --destructive.

revoke select (owner_id, notify_user_ids, plan, subscription_status, trial_ends_at)
    on public.service_providers from anon;

notify pgrst, 'reload schema';

-- Read back (what to confirm on apply):
--   select column_name from information_schema.role_column_grants
--    where grantee='anon' and table_name='service_providers' and privilege_type='SELECT'
--      and column_name in ('owner_id','notify_user_ids','plan','subscription_status','trial_ends_at')
--    order by column_name;
--   -- expected: no rows.
