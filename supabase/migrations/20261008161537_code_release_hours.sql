-- How long before check-in a listing's door code (and the rest of the way in)
-- is released — the host's own choice, because it is their security.
--
-- It lives on listing_access_codes, beside the code itself, so the code and the
-- moment it is handed over travel together and one server route owns both. That
-- table has no grants for anon or authenticated, so this column is unreachable
-- from a browser by construction, exactly like the code — read only by the
-- server surfaces that already read the code: the arrival screen, the trip
-- card, the message thread and the scheduled-message sender.
--
-- Hours, not days, because 24 hours before a 3pm check-in is 3pm the day before,
-- not the stroke of midnight; a security window wants that precision. Default
-- 24 — the same window every existing listing had in effect, give or take, now
-- made explicit and the host's to change. NOT NULL so a row always answers the
-- question "when does this open?" without a caller guessing.
--
-- The old behaviour was a single hard-coded three days for everyone
-- (ARRIVAL_SECRETS_LEAD_DAYS). Nobody agreed three days; 24 hours is the new
-- default and the host can widen it. Existing rows take the default.
--
-- Additive, loses nothing, safe to run twice. Run on test first, then production.

alter table "public"."listing_access_codes"
    add column if not exists "release_hours" integer not null default 24;

-- Belt and braces: anything already there (shouldn't be, column is new) lands on
-- the default, and the value stays sane.
update "public"."listing_access_codes"
    set "release_hours" = 24
    where "release_hours" is null;

alter table "public"."listing_access_codes"
    add constraint "listing_access_codes_release_hours_sane"
    check ("release_hours" >= 1 and "release_hours" <= 336);

-- Read back:
--   select column_name, column_default, is_nullable
--     from information_schema.columns
--    where table_name = 'listing_access_codes' and column_name = 'release_hours';
--   -- expect one row: integer, default 24, NOT NULL.
