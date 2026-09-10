-- Per-person slot minimum — the smallest group a session will run for.
--
-- WHY
--
-- A tasting or a cooking class priced per person isn't worth running for one:
-- the host needs a floor. `slot_capacity` is the CEILING (the most a session
-- holds); this is the FLOOR (the fewest a single booking may be). They are
-- different numbers, so this is its own column beside slot_capacity rather than
-- anything capacity could carry.
--
-- The rule is a per-BOOKING minimum, Airbnb-style: a guest booking a per-person
-- session with a minimum of four books and pays for four — no pooling of
-- strangers up to a minimum, no waiting list, no refunds. It is enforced in the
-- booking route (slots/book), which is the real invariant; the wizard's picker
-- floor is only a convenience.
--
-- Default 1 = no effective minimum, so it is inert for every existing row and
-- for any per-person slot whose host doesn't set one. It is meaningful only on a
-- per-person price (a whole-group flat price is one booking regardless of head
-- count); the app writes it only there and reads max(min, 1) in the route.
--
-- GRANTS. Writes to service_providers are table-granted minus a revoked set, so
-- a new column is writable by the owner (RLS limits which row). SELECT is an
-- allow-list, so a new column is hidden until granted — grant it, so the
-- returning wizard can read the value back to repopulate the stepper, exactly
-- as slot_capacity is granted (20260909121121). The booking route reads it via
-- the service role, which bypasses grants either way.

alter table "public"."service_providers"
    add column if not exists "slot_min_people" integer not null default 1
        check ("slot_min_people" >= 1);

grant select ("slot_min_people") on "public"."service_providers" to "authenticated";

-- PostgREST caches the schema/grants; the new column and grant are invisible
-- over the API until it reloads.
notify pgrst, 'reload schema';

-- Read back:
--   -- authenticated CAN select it (like slot_capacity):
--   select column_name from information_schema.column_privileges
--    where table_name='service_providers' and grantee='authenticated'
--      and privilege_type='SELECT' and column_name='slot_min_people';
--   -- the check is present and the default backfilled:
--   select slot_min_people from service_providers limit 1;
