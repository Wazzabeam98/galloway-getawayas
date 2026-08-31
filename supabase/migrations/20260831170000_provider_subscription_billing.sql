-- What a subscription provider has agreed to pay with, and how far down the
-- reminder ladder they are.
--
-- WHAT THIS IS FOR
--
-- 20260827135718 recorded WHICH model somebody is on. 20260831140000 moved the
-- start of the free period to their first enquiry. Neither of them can charge
-- anybody, because there is nothing on file to charge: the card is asked for
-- near the END of the ninety days, so for the whole of the trial the only
-- thing standing between a free listing and a paying one is a sequence of
-- emails. This migration adds what those emails need to be sent once each, and
-- what Stripe needs to be reconciled against afterwards.
--
-- NOTHING HERE CHARGES ANYBODY EITHER. It is the record. The charging is
-- Stripe Billing's job — see app/api/services/billing/route.ts, which opens a
-- Checkout session in subscription mode with `trial_end` set from
-- `trial_ends_at`, so somebody who pays early keeps the rest of their free
-- period rather than losing it for being organised.
--
-- WHY subscription_status IS ITS OWN COLUMN AND NOT A VALUE OF `status`
--
-- `status` means "an admin has looked at this business and decided something",
-- and 'hidden' on it means "we took it down after a bad edit". Non-payment is
-- not an editorial decision and must not be filed as one.
--
-- There is also a concrete failure. The admin approve route writes its
-- decision guarded on the state it read the row in:
--
--     .update(patch).eq('id', id).eq('status', expected)
--
-- A row that the billing cron had flipped to 'hidden' would no longer match
-- `expected`, so the next admin decision on that provider would silently do
-- nothing and report success. Two unrelated systems writing one column is how
-- that gets discovered in about six months.
--
-- So: visibility is read as `status = 'approved' AND subscription_status is
-- distinct from 'unpaid'`, and the two columns never write each other.
--
-- THE VOCABULARY IS STRIPE'S, ON PURPOSE
--
-- 'trialing', 'active', 'past_due', 'unpaid', 'canceled' are Stripe's own
-- subscription statuses, copied across by the webhook rather than translated.
-- A parallel vocabulary would need a mapping, and a mapping is a thing that
-- can be wrong in a way nobody notices until somebody is either billed twice
-- or never.
--
-- 'none' is the extra one, and it is the ordinary state: every commission
-- provider, and every subscription provider for the whole ninety days before
-- they hand over a card. It is not a problem state.
--
-- Pre-flight:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_providers'
--      and column_name in ('stripe_customer_id', 'stripe_subscription_id',
--                          'subscription_status', 'reminders_sent',
--                          'billing_token_hash');
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_providers"
    add column if not exists "stripe_customer_id"     text,
    add column if not exists "stripe_subscription_id" text,
    add column if not exists "subscription_status"    text not null default 'none',
    -- Which reminders have gone. Keyed by the `key` in lib/serviceSubscription
    -- REMINDERS, which is why those keys must never be reused for a different
    -- email: a renamed key re-sends to everybody who already had the old one.
    add column if not exists "reminders_sent"         text[] not null default '{}',
    -- Only the hash. A leaked row must not be a working card link, and nothing
    -- needs to read the token back — the email is the only place it exists in
    -- the clear. Same reasoning, and the same shape, as the enquiry reply
    -- token in lib/enquiryToken.ts.
    add column if not exists "billing_token_hash"     text;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_providers_subscription_status_check'
    ) then
        alter table "public"."service_providers"
            add constraint "service_providers_subscription_status_check"
            check ("subscription_status" in
                ('none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled'));
    end if;
end $$;

-- A subscription id that is not unique would mean two providers reconciling
-- against one Stripe subscription, which is a double bill or a free listing
-- depending on which way round the webhook lands.
create unique index if not exists "service_providers_stripe_subscription_idx"
    on "public"."service_providers" ("stripe_subscription_id")
    where "stripe_subscription_id" is not null;

-- The card link is looked up by hash on every visit to the billing page.
create unique index if not exists "service_providers_billing_token_idx"
    on "public"."service_providers" ("billing_token_hash")
    where "billing_token_hash" is not null;

-- The cron reads "everybody with a clock running", which is already served by
-- service_providers_trial_idx from 20260827135718. What it also needs is the
-- much smaller set of people who are behind, for the visibility check.
create index if not exists "service_providers_subscription_status_idx"
    on "public"."service_providers" ("subscription_status")
    where "subscription_status" <> 'none';

-- ----------------------------------------------------------------- grants
--
-- 20260828202340 revoked table-level select and named the safe columns, so
-- ANYTHING added to this table is unreadable by anon and authenticated until
-- it is named here. That fails closed, which is the right way round, and it
-- means three of the five columns above need no thought: stripe_customer_id,
-- stripe_subscription_id and billing_token_hash must never be readable from a
-- browser and are already not.
--
-- reminders_sent is not granted either. It is nobody's business but the
-- cron's, and it is written only by the service role.
--
-- subscription_status IS granted, and has to be: the trade directory at
-- app/services/[trade]/page.tsx is a CLIENT component querying with the anon
-- key, and it is the query that has to stop showing people who have not paid.
-- Without this grant the filter silently returns nothing and the whole
-- directory empties — which is the loud version of the failure, at least.
--
-- It leaks nothing: it says whether a business is currently listed, which is
-- already visible by the business either appearing or not.
grant select ("subscription_status")
    on table "public"."service_providers" to "anon", "authenticated";

-- Deliberately NOT granted for update to anyone but the service role. A
-- provider who could write their own subscription_status could un-hide
-- themselves; one who could write stripe_subscription_id could point their row
-- at somebody else's subscription and be carried by it.

-- Read back:
--   select business_name, plan, status, subscription_status,
--          stripe_subscription_id is not null as has_card,
--          trial_ends_at, reminders_sent
--     from public.service_providers order by trade;
--
-- Expected afterwards: every row reads 'none', nobody has a card, and
-- reminders_sent is empty. Nothing bills anybody until somebody presses the
-- button on the card page.
