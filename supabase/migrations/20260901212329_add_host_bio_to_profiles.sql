-- A host can say a line about themselves, shown on their listings.
--
-- WHY
--
-- The whole pitch is "book direct with the people who own them", and the
-- listing then introduced the owner as a name and an avatar with nothing to
-- read. A guest deciding whether to hand over a card wants a sentence: who
-- they are, that they live nearby, that they answer the phone. This is the
-- column that sentence lives in.
--
-- GRANTS, THE SAME SHAPE AS THE REST OF profiles
--
-- profiles has table-level INSERT/UPDATE revoked and the safe columns granted
-- back by name (20260829010000). A new column is invisible to the browser
-- until it is named here too, on BOTH paths, because the account page saves
-- with upsert() and a column granted for one path breaks the form on the
-- other. SELECT is granted to anon and authenticated because the bio is public
-- — it renders on a listing a signed-out visitor reads.
--
-- The 500-character ceiling is a hard stop the paste-from-GitHub flow cannot
-- get around, in the one place it can be enforced regardless of the client.
-- The input caps typing; this caps everything.
--
-- ORDERING. This column must exist in production BEFORE the code that reads it
-- (app/homes/[id] selects host_bio, app/account writes it) merges — a select
-- naming a column that is not there fails at the database and the listing page
-- 500s. Apply to production first, then test, then merge the branch.
--
-- Pre-flight: none — an added nullable column touches no existing row.

alter table "public"."profiles"
    add column if not exists "host_bio" text
    constraint "profiles_host_bio_length" check (host_bio is null or char_length(host_bio) <= 500);

grant select ("host_bio") on table "public"."profiles" to "anon", "authenticated";
grant insert ("host_bio") on table "public"."profiles" to "authenticated";
grant update ("host_bio") on table "public"."profiles" to "authenticated";

-- Read back. The first must list host_bio for anon (public read); the second
-- must list it for authenticated on INSERT and UPDATE (the host can save it):
--
--   select grantee, privilege_type from information_schema.column_privileges
--    where table_name='profiles' and column_name='host_bio' order by 1,2;
