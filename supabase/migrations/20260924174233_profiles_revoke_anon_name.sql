-- Finding (overnight audit 2026-09-24, LAUNCH BLOCKER): the anon role holds a
-- column-level SELECT grant on profiles.full_name, preferred_name and
-- show_full_name (granted in 20260828234003_profiles_revoke_private_columns.sql),
-- and the profiles SELECT policy is USING (true) for everyone. So any logged-out
-- visitor could read every guest's and host's legal name straight over
-- /rest/v1/profiles?select=full_name — the show_full_name switch only ever gated
-- what the app RENDERED, never the raw REST read.
--
-- Fix: revoke the three name columns from anon. The only anon-facing surfaces
-- that show a person's name are the cottage page's host block and its reviews
-- list; both now read these columns through the SERVICE ROLE and resolve the
-- display name server-side, sending only a first name to the browser. Every
-- other public name surface (the experience marketplace and listings) already
-- reads through the service role, so nothing anon-facing depends on this grant.
--
-- The authenticated grant is deliberately KEPT: signed-in features (e.g. the
-- host reviews dashboard, booking counterparties) read other people's names
-- through the authenticated role under RLS, so this is an anon-only revoke. The
-- authenticated SELECT-grant decision for profiles is unchanged
-- (tests/select-grant-decision-guard.test.ts).
--
-- ORDERING: this is a REVOKE with no additive half. Deploy the code in this PR
-- FIRST (the cottage page then reads names via the service role), THEN apply this
-- on production. Applying before the deploy would only make the logged-out
-- cottage page fall back to "Host"/"Guest" until the deploy — no data exposure,
-- just degraded copy.

revoke select (full_name, preferred_name, show_full_name)
    on table public.profiles from anon;
