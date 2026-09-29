-- Two optional availability flags a trade sets on the "What you do" sign-up step
-- and edits later in account settings: whether they do emergency call-outs and
-- whether they do scheduled work. Both show on the public trade profile and hosts
-- filter on them when browsing. Both default false (an existing trade has said
-- neither until they tick it).
--
-- service_providers is a column-grant table (the blanket grants were revoked in
-- 20260828202340 / 20260827185827), so each new browser-writable column needs its
-- own insert/update/select grant to `authenticated`, and a schema reload, or the
-- browser 403s. Mirrors the pattern in 20260929143712 (provides_quote et al).

alter table "public"."service_providers"
    add column if not exists "does_emergency" boolean not null default false,
    add column if not exists "does_scheduled" boolean not null default false;

grant insert ("does_emergency", "does_scheduled")
    on table "public"."service_providers" to "authenticated";
grant update ("does_emergency", "does_scheduled")
    on table "public"."service_providers" to "authenticated";
grant select ("does_emergency", "does_scheduled")
    on table "public"."service_providers" to "authenticated";

-- The public browse page reads them under the anon key, so anon needs select too
-- (does_gas/does_oil are already anon-readable for the same reason).
grant select ("does_emergency", "does_scheduled")
    on table "public"."service_providers" to "anon";

notify pgrst, 'reload schema';
