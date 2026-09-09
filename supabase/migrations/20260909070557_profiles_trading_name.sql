-- An optional TRADING NAME on the account.
--
-- Guest experiences are individual people, not businesses: the listing title is
-- the person's name (from the account), with the professional title beneath.
-- Someone who genuinely trades under a name can add one here later — in account
-- settings, never asked at sign-up — and when set it takes over as the title.
--
-- It lives on `profiles` because it is account information, set once and reused,
-- and account settings already reads and writes `profiles`. The listing title
-- (service_providers.business_name) is DERIVED from it at write time
-- (trading_name || the person's name) and re-derived when either changes — the
-- read side is untouched, which is the whole reason business_name stays a
-- column rather than being resolved at read.
--
-- Grants mirror `full_name` exactly: it is a name, not a secret (it becomes a
-- public listing title), so it is publicly selectable and owner-updatable. The
-- row policy already restricts UPDATE to the owner's own row; a column grant
-- cannot say "his own row", so nothing here widens who may write, only which
-- columns.

alter table "public"."profiles" add column if not exists "trading_name" text;

grant select ("trading_name") on table "public"."profiles" to "anon", "authenticated";
grant insert ("trading_name") on table "public"."profiles" to "authenticated";
grant update ("trading_name") on table "public"."profiles" to "authenticated";

-- PostgREST caches the schema; without this the new column 404s on the API
-- until the next reload (see grant-and-view-migration-gotchas).
notify pgrst, 'reload schema';

-- Read back (grants landed for both roles):
--   select grantee, privilege_type
--     from information_schema.column_privileges
--    where table_name = 'profiles' and column_name = 'trading_name'
--    order by grantee, privilege_type;
