-- Align the two registration surfaces, and decide who sees them (B's audit,
-- finding 3).
--
-- THE DECISION
--
-- A registration number is semi-public VERIFICATION data: a host is meant to be
-- able to check a trade's Gas Safe / SNIPEF / NICEIC number, and the per-scheme
-- service_provider_registrations table already publishes it to anon. But the
-- newer free-text service_providers.registration_number was granted to
-- `authenticated` only — so a signed-OUT visitor couldn't read it, which also
-- silently broke the public trade page (it selects and renders the number under
-- the anon key). The two surfaces disagreed.
--
-- Resolve it in favour of PUBLIC verification data, consistently:
--   * grant anon SELECT on service_providers.registration_number, matching the
--     per-scheme table and un-breaking the logged-out trade page; and
--   * stop publishing verified_by (an admin user id) on the per-scheme table —
--     it is not verification data a customer needs, so it comes off the public
--     column grant while the number, scheme and verified stamp stay public.
--
-- Safe to run twice.

-- Public read of the free-text number (authenticated already has it).
grant select ("registration_number") on table "public"."service_providers" to "anon";

-- Per-scheme table: keep the verification columns public, drop verified_by.
revoke select on table "public"."service_provider_registrations" from "anon", "authenticated";
grant select ("provider_id", "scheme", "number", "verified_at", "verified_number", "expires_at", "created_at", "updated_at")
    on table "public"."service_provider_registrations" to "anon", "authenticated";

notify pgrst, 'reload schema';
