-- How many properties a holiday-let registrant has. On the register-interest
-- flow the holiday-let path asks this with a number stepper instead of the free
-- "anything else" line (a let has a countable answer; an experience or a trade
-- does not). Kept as its own integer column so the list sorts and totals by it —
-- the whole reason for a number rather than a sentence.
--
-- Nullable: null for the guest-experience and tradesman rows (which carry `notes`
-- instead) and for any row made before this column existed.

alter table "public"."interest_registrations"
    add column if not exists "property_count" integer
        check ("property_count" is null or "property_count" >= 1);

notify pgrst, 'reload schema';

-- Read back:
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name='interest_registrations' and column_name='property_count';
