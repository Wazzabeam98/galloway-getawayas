-- Gardening and window cleaning move onto the subscription.
--
-- THE RULE, WIDENED
--
-- 20260827135718_provider_trial_and_plan.sql put the six maintenance trades on £20 a
-- month after 90 free days. The rule is now every host trade EXCEPT cleaning
-- and waste, which adds two:
--
--   trees      Gardening & grounds
--   droplet    Window cleaning
--
-- Cleaning (`sponge`) and waste (`bin`) stay on 10% a job with no trial. The
-- four guest trades — chef, cake, basket, paw — are out of scope of the rule
-- and stay on commission, untouched by this file.
--
-- WHY THERE IS NO REASONING HERE ABOUT WHY THESE TWO
--
-- The earlier migration justified the split as "quoted on site and paid
-- off-platform". That described the six exactly and describes the eight not at
-- all: both trades added here are banded, priced up front, and could perfectly
-- well be charged at acceptance. So this is a decision about these trades
-- rather than a consequence of something they share, and it is written down as
-- a decision. A rationale that has stopped being true is worse than none — it
-- invites the next person to derive the map from it and reach a different
-- answer.
--
-- The one true statement about all eight is the rule itself, and it lives in
-- lib/serviceProviders.ts TRADE_PLANS with COMMISSION_HOST_TRADES beside it.
--
-- RUN AFTER 20260827. Run alone on a fresh database and the six will still be
-- on commission, because moving them is that file's job and this one does not
-- repeat it.
--
-- ON TEST, THIS IS EXPECTED TO CHANGE NOTHING
--
-- Test holds one provider, a cleaner, who is unaffected by every statement
-- below. Zero rows updated is the correct result there, not a sign it failed —
-- the read-back at the bottom is what confirms it ran.
--
-- Pre-flight:
--   select trade, plan, commission_rate, trial_ends_at
--     from public.service_providers
--    where trade in ('trees', 'droplet');
--
-- Safe to run twice. Run on test first, then production.

-- The plan moves before the date, or the check constraint added by
-- 20260827 ('trial_ends_at is null or plan = subscription') rejects the row.
update "public"."service_providers"
   set plan = 'subscription', commission_rate = 0, updated_at = now()
 where trade in ('trees', 'droplet')
   and plan <> 'subscription';

-- 90 days from now rather than from their approval. Anybody already live was
-- approved under the commission model and told nothing about a trial;
-- backdating would hand them a free period that had already run out.
update "public"."service_providers"
   set trial_ends_at = now() + interval '90 days', updated_at = now()
 where trade in ('trees', 'droplet')
   and status = 'approved'
   and trial_ends_at is null;

-- Belt and braces: nothing on commission may carry a trial date. The check
-- constraint enforces this going forward; this clears anything that predates
-- it. Should update zero rows.
update "public"."service_providers"
   set trial_ends_at = null, updated_at = now()
 where plan = 'commission'
   and trial_ends_at is not null;

-- Read back:
--   select trade, plan, commission_rate, status, trial_ends_at
--     from public.service_providers order by trade;
--
-- Expected afterwards, for any row that exists:
--   sponge, bin                     commission, 0.10, no date
--   trees, droplet, and the six     subscription, 0, date if approved
--   chef, cake, basket, paw         commission, 0.10, no date
