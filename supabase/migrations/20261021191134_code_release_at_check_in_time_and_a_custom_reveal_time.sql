-- The host can now hand the door code over at check-in time, or at a clock time
-- of their own on the day of check-in — not only a fixed number of hours before.
--
-- Two additive changes to listing_access_codes, beside the code and its
-- release_hours, so the one row still owns both the code and the moment it is
-- handed over, and the one server gate (arrivalSecretsWindowOpen) still decides
-- when every surface reveals it:
--
--   1. release_hours may now be 0 — "at check-in time". The window used to
--      insist on at least an hour before; a host like Hazel wants to hold the
--      code right until the guest is due in. Widened from >= 1 to >= 0.
--
--   2. release_at_time (nullable) — a clock time on the CHECK-IN DAY to reveal
--      the code at ("on the day of check-in at 08:00"). When it is set the gate
--      uses it and ignores release_hours; when null the hours-before rule stands
--      exactly as before, so every existing row keeps its current behaviour.
--
-- The column lives on the same grant-less, service-role-only table as the code,
-- so it is unreachable from a browser by construction, read only by the server
-- surfaces that already read release_hours: the arrival screen, the trip card,
-- the message thread and the scheduled-message sender.
--
-- Additive, loses nothing, safe to run twice. Run on production first, then test.

-- 1. Allow "at check-in time" (0 hours). Drop the old 1..336 constraint and add
--    the widened 0..336 one. The name is reused so a second run replaces it
--    rather than piling up a duplicate.
alter table "public"."listing_access_codes"
    drop constraint if exists "listing_access_codes_release_hours_sane";

alter table "public"."listing_access_codes"
    add constraint "listing_access_codes_release_hours_sane"
    check ("release_hours" >= 0 and "release_hours" <= 336);

-- 2. The optional absolute reveal time on the check-in day. Null means "use
--    release_hours" — which is every existing row, so nothing changes for them.
alter table "public"."listing_access_codes"
    add column if not exists "release_at_time" time without time zone;

comment on column "public"."listing_access_codes"."release_at_time" is
    'Optional clock time on the check-in day to reveal the code at; when set it overrides release_hours. Null = use release_hours (hours before check-in).';

-- Read back:
--   select
--     pg_get_constraintdef((
--       select oid from pg_constraint
--        where conname = 'listing_access_codes_release_hours_sane')) as release_hours_check,
--     (select count(*) from information_schema.columns
--       where table_name = 'listing_access_codes' and column_name = 'release_at_time') as has_release_at_time;
--   -- expect: check ((release_hours >= 0) AND (release_hours <= 336)), has_release_at_time = 1.
