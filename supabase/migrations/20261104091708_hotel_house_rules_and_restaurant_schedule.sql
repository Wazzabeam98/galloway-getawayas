-- Hotel house rules (parity with the holiday-let flow) + a per-day restaurant
-- schedule. Liam's second walkthrough: the hotel check-in/house-rules step must
-- copy /addhome's fields exactly, and restaurant hours must be per day of the
-- week with a "closed" option and split times (Google-style).
--
-- The granular house-rule columns mirror the listings columns the reused
-- HouseRulesCard writes (events_allowed, smoking_allowed,
-- commercial_photography_allowed, quiet_hours_*, additional_rules, max_pets).
-- Pets-allowed stays in facilities[] (the 'Pets allowed' entry), as the cottage
-- flow keeps it in amenities[]. restaurant_schedule is jsonb:
--   { "mon": [{"from":"10:00","to":"14:00"},{"from":"17:00","to":"21:00"}], ... }
-- an empty array (or missing day) = closed that day.
--
-- All additive, TEST only, behind hotelsOpen(). Not destructive.

alter table public.hotels
    add column if not exists events_allowed boolean not null default false,
    add column if not exists smoking_allowed boolean not null default false,
    add column if not exists commercial_photography_allowed boolean not null default false,
    add column if not exists quiet_hours_enabled boolean not null default false,
    add column if not exists quiet_hours_start text not null default '22:00',
    add column if not exists quiet_hours_end text not null default '07:00',
    add column if not exists additional_rules text,
    add column if not exists max_pets smallint,
    add column if not exists restaurant_schedule jsonb not null default '{}';

-- The browser reads these on the owner editor and the public page (none sensitive).
grant select (
    events_allowed, smoking_allowed, commercial_photography_allowed,
    quiet_hours_enabled, quiet_hours_start, quiet_hours_end, additional_rules,
    max_pets, restaurant_schedule
) on public.hotels to anon, authenticated;

notify pgrst, 'reload schema';

-- Read back:
--   select count(*)::text from information_schema.columns where table_name='hotels' and column_name in ('events_allowed','smoking_allowed','commercial_photography_allowed','quiet_hours_enabled','quiet_hours_start','quiet_hours_end','additional_rules','max_pets','restaurant_schedule');  -- 9
