-- Every cleaner may price per hour, not only the in-house ones.
--
-- WHAT CHANGES
--
-- 20260828_cleaning_hourly_option.sql added:
--
--     check (pricing_choice is distinct from 'hourly'
--            or (trade = 'sponge' and kind = 'in_house'))
--
-- Half of that is still the rule and half of it is not. Hourly is still
-- cleaning and nothing else — for every other trade an hourly rate is
-- display-only and never enters a total, and that is enforced here rather than
-- left to the form. The `kind = 'in_house'` half comes off: a cleaning round
-- that bills by the hour is an ordinary way to run one, and a public applicant
-- should be able to say so on the prices step.
--
-- WHAT IT COSTS, DEFERRED RATHER THAN SOLVED
--
-- The reasoning behind the in-house gate was not wrong and is not being
-- refuted. Bands make the total knowable before the job; cleaning takes 10% at
-- acceptance; an hourly price has nothing to take a percentage of yet.
-- In-house was safe because the platform bills, knows the hours, and takes no
-- commission from itself. None of that holds for an external cleaner charging
-- by the hour.
--
-- So the gap is real and it is being accepted knowingly: an external hourly
-- cleaner has no knowable total at acceptance and her commission cannot be
-- computed there. Nothing is wired into a live money path yet, and the answer
-- belongs with enquiries, where the hours are actually agreed. Whoever builds
-- that has to handle it. This paragraph is the handover.
--
-- `kind` itself is untouched. It is still not writable from the browser, the
-- admin review card still toggles it, and in-house still means no commission.
-- It simply no longer decides who may be asked the question.
--
-- Pre-flight:
--   select conname from pg_constraint
--    where conrelid = 'public.service_providers'::regclass
--      and conname like '%hourly%';
--
-- Expected before: service_providers_hourly_is_in_house_cleaning
-- Expected after:  service_providers_hourly_is_cleaning
--
-- Safe to run twice. TEST ONLY for now — production has none of the services
-- migrations.

alter table "public"."service_providers"
    drop constraint if exists "service_providers_hourly_is_in_house_cleaning";

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_providers_hourly_is_cleaning'
    ) then
        alter table "public"."service_providers"
            add constraint "service_providers_hourly_is_cleaning"
            check (
                "pricing_choice" is distinct from 'hourly'
                or "trade" = 'sponge'
            );
    end if;
end $$;

-- Read back:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.service_providers'::regclass
--      and conname like '%hourly%';
--
-- Nothing else moves. No row is rewritten: this only widens what is allowed,
-- so everything that satisfied the old constraint satisfies the new one.
