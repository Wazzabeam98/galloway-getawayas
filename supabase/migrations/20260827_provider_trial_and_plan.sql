-- What a service provider pays, and when the free period ends.
--
-- THE MODEL
--
--   commission    10% a job, held in `commission_rate` and snapshotted onto
--                 an enquiry when it is accepted. Cleaning, waste, gardening,
--                 window cleaning, and all four guest trades.
--   subscription  £20 a month after 90 free days from approval. The six
--                 maintenance trades: plumber, electrician, handyman, roofer,
--                 joiner, painter.
--
-- WIDENED THE NEXT DAY. Gardening and window cleaning joined the subscription
-- on 28 August 2026, making the rule "every host trade except cleaning and
-- waste" — see 20260828_gardening_and_windows_subscription.sql, which must be
-- run after this one. This file is left exactly as it ran rather than edited,
-- because it has already been applied and a migration that no longer matches
-- what it did is worse than one that is out of date.
--
-- The line below is also superseded. It described the six exactly and does not
-- describe the eight: gardening and window cleaning are banded, priced up
-- front, and perfectly chargeable at acceptance.
--
-- The line between them is who takes the customer's money. The platform
-- charges the customer at acceptance on the commission trades, so there is a
-- transaction to take a percentage of. Maintenance work is quoted on site and
-- paid off-platform — there is nothing to take a percentage of, and a per-job
-- commission could not police one if there were.
--
-- A per-accepted-enquiry lead fee was considered and dropped. It never reached
-- the code, so there is nothing here undoing it.
--
-- NOTHING BILLS ANYBODY YET
--
-- There is no Stripe subscription behind this, on purpose. What this migration
-- adds is the record of which model somebody is on and when their free period
-- ends, so that the day billing is built it is charging against dates that
-- were stamped when the promise was made rather than dates invented
-- afterwards.
--
-- THIS REVERSES 20260824_service_providers.sql, WHICH SAID THERE WAS NO TRIAL
--
-- That file argued a dormant `trial_ends_at` is one query away from becoming a
-- promise on a page again, and it was right about the failure it had seen:
-- TRIAL_DAYS outlived the copy it belonged to by several commits.
--
-- The answer is not to have no trial. It is to stamp it where the promise is
-- actually made — in the admin approve route, in the same write that sets
-- `approved_at`, and said out loud in the email that tells them they are live.
-- A draft nobody has accepted starts nothing, and submission starts nothing;
-- there is a test for each.
--
-- It is also a different shape from the one that was removed. 'trial' used to
-- be a value of `plan`, which left the plan unable to say what happened when
-- the trial ended. `plan` now says which model they are on for good, and
-- `trial_ends_at` is a date that passes. The plan check is unchanged and still
-- ('commission', 'subscription').
--
-- scripts/test-catch-up/undo-the-split.sql used to drop this column. It now
-- raises instead of dropping it, rather than silently undoing this file on
-- somebody's test database.
--
-- Pre-flight:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_providers'
--      and column_name in ('plan', 'trial_ends_at', 'commission_rate');
--
-- Safe to run twice. Run on test first, then production.

-- Null means no free period is running: either they are on commission, or
-- they have not been approved yet. It is deliberately NOT defaulted — a
-- default would start a clock on every draft row that exists, which is the
-- promise-by-accident this is trying to avoid.
alter table "public"."service_providers"
    add column if not exists "trial_ends_at" timestamptz;

-- A date without a plan behind it is meaningless, and a commission provider
-- carrying a trial date would be read by any later billing job as somebody
-- owed free months they were never promised.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_providers_trial_needs_subscription'
    ) then
        alter table "public"."service_providers"
            add constraint "service_providers_trial_needs_subscription"
            check ("trial_ends_at" is null or "plan" = 'subscription');
    end if;
end $$;

-- The queue reads this per row when deciding, so it wants an index no more
-- than `approved_at` does. Partial, because the only interesting rows are the
-- ones with a clock running.
create index if not exists "service_providers_trial_idx"
    on "public"."service_providers" ("trial_ends_at")
    where "trial_ends_at" is not null;

-- Existing rows.
--
-- Approved maintenance providers are already live and were told nothing about
-- a trial, so they get 90 days from now rather than 90 days from an approval
-- that happened before the offer existed. Backdating would hand somebody a
-- free period that had already expired.
--
-- The plan moves first, or the check constraint above rejects the date.
update "public"."service_providers"
   set plan = 'subscription', commission_rate = 0, updated_at = now()
 where trade in ('plumber', 'electrician', 'handyman', 'roofer', 'joiner', 'painter')
   and plan <> 'subscription';

update "public"."service_providers"
   set trial_ends_at = now() + interval '90 days', updated_at = now()
 where plan = 'subscription'
   and status = 'approved'
   and trial_ends_at is null;

-- Read back:
--   select trade, plan, commission_rate, status, trial_ends_at
--     from public.service_providers order by trade;
--
-- Every maintenance trade should read subscription with a rate of 0, and only
-- the approved ones should carry a date.
