-- The cleaner chooses: a price per house size, or a rate per hour.
--
-- IN-HOUSE ONLY, AND WHY THAT IS NOT A HEDGE
--
-- Bands exist so two cleaners are comparable and so the total is knowable
-- before the job. 20260825_service_pricing.sql puts it plainly: an hourly
-- figure as the price is what puts the total after the job. Cleaning is a 10%
-- commission trade, and commission is taken when the customer is charged at
-- acceptance — so an hourly price has nothing to take a percentage of yet.
--
-- What makes hourly safe is not the trade, it is who sends the bill. On an
-- in-house provider Galloway Getaways is the one billing, knows the hours, and
-- takes no commission from itself. On an external cleaning firm none of that
-- is true, and hourly would reintroduce exactly the fault bands were built to
-- prevent.
--
-- So the check below is the rule, not a precaution: cleaning AND in-house, or
-- the row is refused. `kind` is not writable from the browser — the sign-up
-- never sends it and no route sets it — so this cannot be reached by an
-- applicant choosing something they should not have.
--
-- The existing rule stands everywhere else: for every other trade an hourly
-- rate is display-only and never enters a total.
--
-- THREE COLUMNS, NOT TWO, AND NOT A REUSED ONE
--
--   pricing_choice        'bands' or 'hourly'. Null means the trade has no
--                         choice to make, which is every trade but cleaning.
--   billable_hourly_rate  the rate that MAY be multiplied. Deliberately not
--                         `hourly_rate`, which already exists and means
--                         "display only, maintenance trades" — one column
--                         meaning two things depending on the trade is how a
--                         display figure becomes a charge by accident. And
--                         deliberately not `typical_hours`, which is a guide
--                         with a test asserting it never enters a calculation.
--   covered_bands         which house sizes an hourly cleaner will take.
--
-- WHY covered_bands EXISTS AT ALL
--
-- A blank band means "I do not cover this size" and filters the provider out
-- of results for it. An hourly cleaner prices no bands, so under that rule she
-- would silently vanish from every band-filtered list — the failure would be
-- invisible, because a provider who appears nowhere looks exactly like a
-- provider nobody searched for.
--
-- Coverage therefore becomes an explicit answer rather than something inferred
-- from the presence of a price. A banded cleaner is unchanged and her prices
-- still say what she covers; an hourly cleaner says so directly. Both go
-- through lib/serviceProviders.ts `coversBand`, so the two routes cannot
-- answer the same question differently.
--
-- "Hourly covers everything" was considered and rejected: a solo cleaner who
-- will not take a six-bedroom house would be sent six-bedroom houses for ever,
-- which is the mirror image of vanishing and no more correct.
--
-- Pre-flight:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_providers'
--      and column_name in ('pricing_choice', 'billable_hourly_rate',
--                          'covered_bands', 'hourly_rate', 'kind');
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_providers"
    add column if not exists "pricing_choice" text;

alter table "public"."service_providers"
    add column if not exists "billable_hourly_rate" numeric;

alter table "public"."service_providers"
    add column if not exists "covered_bands" text[] not null default '{}';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_providers_pricing_choice_check'
    ) then
        alter table "public"."service_providers"
            add constraint "service_providers_pricing_choice_check"
            check ("pricing_choice" is null or "pricing_choice" in ('bands', 'hourly'));
    end if;
end $$;

-- The rule itself. Hourly is cleaning, in-house, and nothing else.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_providers_hourly_is_in_house_cleaning'
    ) then
        alter table "public"."service_providers"
            add constraint "service_providers_hourly_is_in_house_cleaning"
            check (
                "pricing_choice" is distinct from 'hourly'
                or ("trade" = 'sponge' and "kind" = 'in_house')
            );
    end if;
end $$;

-- A rate is meaningless without the choice behind it, and a rate of zero is
-- not a rate. Guarded rather than left to the form, because the form is the
-- browser and the browser is not the authority on what a provider charges.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_providers_billable_rate_check'
    ) then
        alter table "public"."service_providers"
            add constraint "service_providers_billable_rate_check"
            check (
                "billable_hourly_rate" is null
                or ("billable_hourly_rate" > 0 and "pricing_choice" = 'hourly')
            );
    end if;
end $$;

-- Only the real band keys, and only bedroom ones: cleaning is banded on
-- bedrooms, so a plot band here would be a size that does not exist for this
-- trade and would match nothing for ever.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_providers_covered_bands_check'
    ) then
        alter table "public"."service_providers"
            add constraint "service_providers_covered_bands_check"
            check ("covered_bands" <@ array['beds_1_2', 'beds_3_4', 'beds_5_plus']::text[]);
    end if;
end $$;

-- Existing rows: every cleaner on the site today prices by band, so say so
-- rather than leaving the column null and letting the reader guess.
update "public"."service_providers"
   set pricing_choice = 'bands', updated_at = now()
 where trade = 'sponge'
   and pricing_choice is null;

-- Read back:
--   select business_name, trade, kind, pricing_choice, billable_hourly_rate,
--          covered_bands
--     from public.service_providers where trade = 'sponge';
