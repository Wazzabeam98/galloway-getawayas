-- The free ninety days start at the first enquiry, not at approval.
--
-- WHAT CHANGED AND WHY
--
-- 20260827135718_provider_trial_and_plan.sql stamped `trial_ends_at` in the
-- admin approve route, arguing that approval is the moment the promise is
-- made. That is true and it is not the same as the moment the value arrives. A
-- tradesman approved in September who hears nothing until January would spend
-- his entire free period waiting for the site to find him work — which is a
-- bill for our lack of traffic rather than for anything he received.
--
-- So the clock now starts when the first enquiry is SENT to him, in
-- app/api/services/enquiries/route.ts. Accept, decline and expire are the
-- three endings an enquiry has and all three would start it, so every enquiry
-- starts it and only the date is in question; the most an answer can trail the
-- send is the expiry window, twenty minutes to five days, which against ninety
-- is not worth three code paths that have to agree.
--
-- This file fixes the rows that were stamped under the old rule.
--
-- WHY THIS RECOMPUTES RATHER THAN BLANKING
--
-- `update service_providers set trial_ends_at = null where plan = 'subscription'`
-- is correct today, because no provider has yet been sent a real enquiry. But
-- it is correct only because a table happens to be empty, and a migration that
-- is right for that reason is wrong the first time somebody runs it where the
-- table is not — on a seeded database, on a restored backup, or here in three
-- months if this has not been run yet.
--
-- So it derives the date from the history instead: the earliest enquiry ever
-- sent to that provider, plus ninety days, and null where there is none. That
-- is the new rule applied to the past. It gives exactly the same answer as
-- blanking when there is no history, and it needs nobody to have checked first.
--
-- It is also safe to run repeatedly and self-correcting: the earliest enquiry
-- for a provider does not change, so the answer does not either.
--
-- THE ONE THING IT CANNOT KNOW
--
-- Whether the email actually reached him. The application stamps only when
-- `sendEmail` returned true, because a lead he never received is not a lead —
-- but the row does not record that, so this uses "an enquiry was sent" as the
-- evidence. The only way it can be wrong is a provider whose very first
-- enquiry failed to send, which would start his clock a little early. With the
-- current data that is nobody.
--
-- WITHDRAWN AND EXPIRED ENQUIRIES COUNT. Every status counts. The lead arrived;
-- what he did about it, and what the host later did about it, is not the
-- question this is asking.
--
-- Pre-flight — what is about to move:
--   select p.id, p.business_name, p.trade, p.status, p.trial_ends_at,
--          (select min(e.sent_at) from public.service_enquiries e
--            where e.provider_id = p.id) as first_enquiry
--     from public.service_providers p
--    where p.plan = 'subscription'
--    order by p.trade;
--
-- Anybody approved before this ran was told "your first 90 days are free" in
-- their approval email, and this moves that period later. It can only move in
-- their favour — they get more free time, never less. With three of them, that
-- is a personal note rather than a system email.
--
-- Safe to run twice. Run on test first, then production.

-- The check constraint from 20260827 still holds throughout: only a
-- subscription provider may carry a date, and null is always allowed. Nothing
-- here touches `plan`, so nothing can fall foul of it.
update "public"."service_providers" p
   set trial_ends_at = (
           select min(e.sent_at) + interval '90 days'
             from "public"."service_enquiries" e
            where e.provider_id = p.id
       ),
       updated_at = now()
 where p.plan = 'subscription'
   and p.trial_ends_at is distinct from (
           select min(e.sent_at) + interval '90 days'
             from "public"."service_enquiries" e
            where e.provider_id = p.id
       );

-- Read back:
--   select p.business_name, p.trade, p.status, p.trial_ends_at,
--          (select count(*) from public.service_enquiries e
--            where e.provider_id = p.id) as enquiries
--     from public.service_providers p
--    where p.plan = 'subscription'
--    order by p.trade;
--
-- Expected afterwards: a provider with no enquiries carries no date, and a
-- provider with enquiries carries their first one plus ninety days. Today that
-- is every subscription provider reading null, which is the point — no clock
-- is running anywhere until the site actually sends somebody some work.
