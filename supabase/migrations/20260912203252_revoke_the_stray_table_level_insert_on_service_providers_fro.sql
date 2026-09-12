-- Revoke a stray TABLE-LEVEL insert grant on service_providers from authenticated.
--
-- WHAT WAS WRONG (test only — production is already correct)
--
-- 20260827185827_provider_status_grants made INSERT/UPDATE a column allow-list so
-- a provider cannot write their own status/stripe/money columns (a provider who
-- could write `status` could approve themselves). Production still reflects that:
-- authenticated has INSERT and UPDATE on the same 24-ish owner columns and on no
-- sensitive one — checked directly, prod grants authenticated no INSERT on status,
-- commission_rate, settlement, plan, subscription_status, or any stripe_* column.
--
-- The TEST database had drifted. Its service_providers ACL carried a table-level
-- INSERT grant to authenticated (relacl `authenticated=ad` — the `a`), which no
-- migration in this folder creates and production does not have. A table-level
-- grant covers EVERY column, so on test a signed-in user could INSERT a provider
-- row setting status='approved', stripe_payouts_enabled, commission_rate — the
-- exact hole the column allow-list exists to close, reopened for the whole table.
-- It only ever existed on test, but a guard that reads the live test grants (and
-- a person reading them to reason about prod) would both be misled by it.
--
-- A column-level revoke cannot cut a hole in a table-level grant (the trap
-- 20260828202340 documents), so the fix is the table-level revoke below. Removing
-- it drops INSERT on every column whose insert came ONLY from the table grant —
-- the sensitive ones (intended) and also the nine owner columns granted in
-- 20260912202042, whose column-level insert had been masked by the table grant
-- and so never registered. Those nine are re-granted at column level here so they
-- stay insertable; the 28 owner columns that already hold a column-level insert
-- grant are untouched.
--
-- On production this whole migration is a no-op: there is no table-level insert to
-- revoke (authenticated=d there), and the nine column grants arrive with
-- 20260912202042 anyway. It is applied to TEST only, to converge test onto the
-- grant model production already has.
--
-- Pre-flight (the drift, on test):
--   select unnest(relacl)::text from pg_class where relname='service_providers';
--     -> expect an `authenticated=ad/...` entry on test; `authenticated=d/...` on prod.
--
-- Safe to run twice.

revoke insert on table "public"."service_providers" from "authenticated";

-- Re-establish column-level INSERT for the nine owner columns the table grant had
-- been masking (companion to the UPDATE grant in 20260912202042). The other owner
-- columns keep their own column-level insert; every sensitive column now has none.
grant insert (
    "shape",
    "slot_length_minutes",
    "slot_capacity",
    "slot_min_people",
    "lead_time_days",
    "dietary_note",
    "declarations",
    "custom_label",
    "exclusive_per_date"
) on table "public"."service_providers" to "authenticated";

-- PostgREST caches the schema/grants; without this the change 403s until reload.
notify pgrst, 'reload schema';

-- Read back (INSERT is now the same allow-list as UPDATE — no sensitive column):
--   select privilege_type, count(*) from information_schema.column_privileges
--    where table_name='service_providers' and grantee='authenticated'
--      and privilege_type in ('INSERT','UPDATE') group by 1;   -- expect 37 and 37
--   select column_name from information_schema.column_privileges
--    where table_name='service_providers' and grantee='authenticated'
--      and privilege_type='INSERT' and column_name in
--      ('status','commission_rate','settlement','stripe_payouts_enabled');  -- expect none
