# The tradesman subscription — what exists, and what the lifecycle should be

Scope only. Nothing here is built. Written 31 August 2026, second pass.

£20 a month, no VAT, after ninety free days — and the ninety days start when
the **first enquiry reaches him**, not when he is approved. A tradesman
approved in September who hears nothing until January should not burn his free
period waiting for the site to find him work. Accept or decline both start it;
the value being sold is the lead arriving, not whether he takes the job.

He still gives no card until the free period is nearly up, so for the whole of
those ninety days there is nothing on file to charge. The reminders are not a
courtesy, they are the mechanism.

## What changed in this pass

1. **No VAT.** Nowhere near the threshold, so £20 is £20. The Stripe price is
   unblocked — see below for the one thing to write down about it.
2. **The clock starts at first enquiry, not at approval.** This is the larger
   change: it moves the stamp out of the admin approve route, invalidates the
   dates already stamped on live rows, and removes the fixed deadline this
   document previously had.

## What is already built

The record-keeping half is done and tested. The billing half is not started.
Note that the first change below is now a change to something that works.

**The plan is decided.** `lib/serviceProviders.ts` holds `TRADE_PLANS`, the
explicit map of which trade pays what, with `TRIAL_DAYS = 90` and
`SUBSCRIPTION_MONTHLY = 20` beside it. Eight host trades are on the
subscription — the six maintenance trades plus gardening (`trees`) and window
cleaning (`droplet`). Cleaning (`sponge`) and waste (`bin`) stay on 10% a job,
as do the four guest trades. `planForTrade()` falls back to commission for an
unplaced trade, which is the safe direction: commission bills nothing until
there is a job, where the reverse would start a clock on somebody who never
agreed to one.

**The clock is stamped at approval — and this is what has to move.**
`app/api/admin/providers/route.ts` around line 299, on `approve`: it re-derives
the plan from the trade rather than trusting the row, forces
`commission_rate = 0`, and stamps `trial_ends_at` — but only
`if (!provider.trial_ends_at)`, so re-approving after an edit does not hand out
another ninety days. That guard is the useful part and it survives the move
unchanged; only the place it runs changes.

**The database will not let plan and date disagree.** Migration
`20260827135718_provider_trial_and_plan.sql` adds `trial_ends_at` with a check
constraint — `trial_ends_at is null or plan = 'subscription'` — and a partial
index on rows with a clock running. Both still hold after this change. In fact
the constraint gets more useful: a null now means "approved, waiting for his
first lead", which is a state that did not previously exist.

**The enquiry machinery this now hangs off.** `lib/serviceEnquiries.ts` and
`lib/serviceEnquirySweep.ts` are mature. Statuses are `sent`, `viewed`,
`accepted`, `declined`, `expired`, `withdrawn`. Expiry windows are 20 minutes
for an emergency, 48 hours for `soon`, 120 hours for `planned`. Responses come
through `app/api/services/enquiries/respond/route.ts` on a hashed token,
without signing in. The sweep in `settleDue()` expires rows and is guarded on
the status it read, so a tradesman accepting in the same second as the sweep
wins.

**The approval email.** Quotes the trial date, read back off the patch so the
words and the column cannot disagree, and promises "We will write to you before
anything is due, and there is nothing to set up today." Both halves of that
sentence still have to be true afterwards — see the wording note below.

### What does not exist

- No Stripe subscription, customer, or price. No `stripe_customer_id`,
  `stripe_subscription_id` or subscription status on `service_providers`. The
  only `stripe_customer_id` in the codebase belongs to bookings.
- No cron for any of this. `vercel.json` has nine, none about providers.
- No reminder emails at all.
- No card capture, and nowhere to put one. A provider has an account
  (`owner_id`, and the Connect route verifies with `getUser()`), but there is
  no provider dashboard. `/services/join` is the sign-up and edit form.
- Nothing anywhere reads `trialActive`, so a provider cannot see their own
  trial date on any page.

### One thing to fix regardless

`MAINTENANCE.md` around line 778 still says in bold **"There is no free
trial"**, and that `TRIAL_DAYS`, `trialEndsAt()` and `trial_ends_at` "are all
gone rather than left dormant". That was reversed on 27 August. It is the more
dangerous half of exactly the failure it warns about, and it will tell the next
person to delete the machinery this depends on.

## The two things to settle

### 1. An enquiry that expires unanswered

**Your lean is right, and it makes the rule simpler than the one you described
rather than more complicated.**

The reason to count expiry is the one you gave: if silence stops the clock,
ignoring enquiries buys a free listing forever, and the person gaming it is
indistinguishable from the person the free period is meant to help. That is a
bad incentive to leave lying about, however unlikely it is with ten providers
who all know you.

But look at what counting it actually does. An enquiry has three endings —
accepted, declined, expired — and if all three start the clock, then *every*
enquiry starts the clock. The only thing left in question is the date: the day
it was sent, or the day it resolved. And the gap between those is bounded by
the expiry windows already in the code: **at most five days**, and twenty
minutes for an emergency.

So the honest form of the rule is:

> The clock starts when the first enquiry is **sent** to him.

Five days of drift against ninety is noise, and this version is materially
better in three ways. It is one write in one place — `announceEnquiry`, where
the email goes out — instead of three code paths that must agree. It cannot be
gamed at all, not even by five days. And it is the rule you actually described:
the value is the lead arriving, and the lead arrives when it is sent.

**One condition on it.** It starts only if the notification actually went.
`sendEmail` returns `false` rather than throwing — no API key, a refusal from
Resend, a dead network — and a lead he never received is not a lead. If the
send fails, no clock, and the failure goes to `/admin/errors`.

**The thing you are giving up, said plainly.** There is an argument already
written into `lib/serviceEnquiries.ts`, from the decision not to release a
tradesman's number on an unanswered emergency:

> "The whole argument at day ninety is 'you got five jobs out of us', and the
> accept is the only event that evidences one."

By that standard, leads are a weaker sell than accepts — "you got five
enquiries, you answered none" is a harder conversation than "you got five
jobs". You are choosing a rule that is fair and ungameable over one that is
easiest to justify at the point of billing. I think that is the right way
round, because the alternative is unbillable, but it is worth knowing you have
moved off the position that file argues for, so the next person to read it
does not think one of you was confused.

**What this does to the model overall, which is worth noticing.** Nobody can
be billed until the site has delivered them a lead. The subscription revenue is
now gated entirely on your own traffic. That is a real constraint and also the
best sentence in the sales pitch.

### 2. Everyone already approved has a date stamped from approval

They need clearing, and the migration should recompute rather than blank.

The blunt version — `set trial_ends_at = null where plan = 'subscription'` — is
right today, because as far as this codebase is concerned no provider has yet
responded to a real enquiry. But "as far as this codebase is concerned" is
doing a lot of work in that sentence, and a migration that is only correct
because a table happens to be empty is one that goes wrong the moment it is run
somewhere the table is not.

The self-correcting form, which is also safe on an empty table:

- For each subscription provider, find their earliest enquiry that was sent to
  them successfully.
- If there is one, `trial_ends_at` is that date plus ninety days.
- If there is not, `trial_ends_at` is null.

That is the new rule applied to history, it gives the same answer as blanking
when there is no history, and it does not need anyone to have verified that the
table is empty first. Pre-flight and read-back queries in the same style as the
two existing migrations.

**Anyone approved before this lands was told a date in their approval email.**
It is a date that is about to stop being true, and it can only move in their
favour — they get more free time, not less. Given the numbers involved, that is
a short personal note rather than a system email. Worth deciding rather than
letting them notice.

## Where the clock now starts, in code

Four changes, none of them large:

1. **The approve route stops stamping `trial_ends_at`.** It keeps setting
   `plan` and `commission_rate = 0`. The `if (!provider.trial_ends_at)` guard
   moves with the stamp rather than being deleted.
2. **`announceEnquiry` stamps it**, on a successful send, guarded the same way
   — only if it is currently null, so the second enquiry does not restart
   anything, and a provider already paying is untouched.
3. **The approval email loses the date**, because at approval there is no
   longer one. It should say the free period starts when his first enquiry
   arrives. `planTerms()` in `lib/serviceProviders.ts` already speaks in the
   present tense without a date and needs only its ninety-days clause reworded.
4. **A new email when the clock starts**, sent alongside the first enquiry or
   just behind it: your free period has started, it ends on this date. Without
   it, the first he hears of a bill is the day-60 note, months after approval,
   about a clock he never saw start.

**A trap in the existing helper.** `trialActive()` returns `false` both for a
trial that has ended and for one that has not started, and those now need
different words on a page — "your free period has ended" shown to a man who has
never had an enquiry is a bad bug and an easy one. It wants replacing with
something that returns three states: not started, running, ended.

## The deadline this removes, and the one it replaces it with

The previous pass noted that the migrations stamped `now() + 90 days` on 27–28
August, so the first cohort's free period ended around 25 November 2026, and
reminders had to exist by late October. **That deadline is gone.** Once the
dates are cleared, no clock is running anywhere and nobody is due to be billed
on any date at all.

What replaces it is not a date but an event: **the machinery has to exist
before the first real enquiry is sent in production.** That could be launch
day. It is a softer deadline in that it can be missed by a few days without
anybody being wrongly billed — a clock that starts late merely gives somebody
extra free time. But it is a harder one in that you cannot see it coming on a
calendar, and the failure is silent: enquiries flow, no clocks start, and the
subscription quietly does not exist.

The cheap insurance is to land the stamp first, on its own, before any of the
billing. It is a few lines, it is harmless while nothing bills, and it means
the dates are accruing correctly from the first real lead whenever the rest
gets finished.

## What I would send, and when

Six emails. Days are counted from `trial_ends_at` backwards, never recounted
from the enquiry or from `approved_at`, so a row whose date came from the
backfill is reminded on the same rule as everybody else.

| When | Email | Ask |
| --- | --- | --- |
| Approval | Exists today, needs rewording | None. Says the free period starts at his first enquiry. |
| Clock starts | New | None. Your free period has started, it ends on this date. |
| 30 days left | "A month left of your free listing" | None. What happens and when. |
| 14 days left | "Time to add a card" | The card link. The real ask. |
| 7 days left | Only if no card | The card link, shorter. |
| 1 day left | Only if no card | Last call, says plainly what happens tomorrow. |
| 3 days after | Only if no card | Grace period, with the date it ends. |

One email that asks for nothing before any that asks for something. A tradesman
who has had ninety free days and then gets a bill out of nowhere is a tradesman
who leaves; the 30-day note costs nothing and makes the 14-day ask expected.

Everything from "7 days left" down is conditional on there being no card on
file. Once he has paid they stop — chasing somebody who has already done the
thing is the most common way a ladder like this annoys people.

Suppression, and the one alert this needs:

- Every send recorded on the row (a `subscription_reminders_sent` array, or a
  small table) and read before sending. A cron rerun or a redeploy must not
  send the same chase twice.
- Never to a `commission` provider. Keying the query on
  `trial_ends_at is not null` gets this right by construction, because the
  check constraint makes that state impossible for them.
- Never to a provider whose `status` is not `approved`.
- **A failed "time to add a card" send has to raise**, not pass silently. It is
  the one email the whole model rests on, and `sendEmail` returns `false`
  instead of throwing. It belongs in `/admin/errors`.

A daily cron is enough — the enquiry sweep runs every five minutes because an
emergency expires in twenty, and nothing here is remotely that sharp.

## Card capture

**Use Stripe Billing. Do not build a monthly charging loop.**

The instinct is a cron that charges a saved card, mirroring `balance-charges`.
Resist it. That route exists because a booking balance is a one-off amount on a
date Stripe knows nothing about. £20 a month is precisely what Stripe Billing
does, and it brings retries, dunning, card-expiry updates and proration with
it — every one of which is otherwise something you write, test and get wrong at
somebody else's expense.

The flow:

1. The reminder links to a page, on a hashed token in the same pattern as
   `lib/enquiryToken.ts`, because tradesmen do not sign in — the enquiry flow
   already learnt this. Opening the link is a GET and creates nothing, for the
   same reason the enquiry link does not accept: scanners and link previewers
   fetch every URL in an email before a person reads a word of it.
2. Pressing the button creates a **Stripe Checkout session in `subscription`
   mode**, with `trial_end` set from `trial_ends_at` on the row. Stripe then
   bills for the first time on the day we promised, rather than thirty days
   after he happened to enter a card. Somebody who pays with three weeks to run
   keeps those three weeks — which is what the email said, and what he will
   check.
3. Card details are entered on Stripe's page. Nothing card-shaped reaches our
   forms or our database.
4. `checkout.session.completed` writes `stripe_customer_id` and
   `stripe_subscription_id` back onto the provider row, and that write is what
   "has a card" means everywhere else.

Two house rules apply directly. **Nothing resettable in the idempotency key** —
`provider.id` and a fixed suffix, never `trial_ends_at`, which now moves under
more circumstances than it used to. And **move the money before changing the
status**: the subscription going active is what makes them paid; our column
follows the webhook, not the other way round.

The webhook needs three events beyond the booking ones it handles today:
`customer.subscription.updated`, `invoice.payment_failed`, and
`customer.subscription.deleted`.

**The one thing to write down about the price.** £20, GBP, monthly, no tax
behaviour, because there is no VAT to charge. Record the decision and the date
next to the price ID, because if the company ever crosses the threshold,
changing an existing Stripe price means migrating live subscriptions rather
than editing a number — and the person doing that migration will want to know
this was a considered "no", not an oversight.

## If they don't pay: none of pause, hide, or stay live

The three options as posed answer different questions with one switch. What is
wanted is a short grace period, then hiding, always reversible.

| State | Directory | What they get |
| --- | --- | --- |
| Approved, no enquiries yet | Live | Nothing owed, no clock running. |
| Trial running | Live | Nothing owed. |
| Card on file, paying | Live | Normal. |
| Trial ended, no card | Live, for 7 more days | The 3-days-after chase. |
| Grace expired, or Stripe says unpaid | Hidden | An email saying so, and how to come back. |
| They pay | Live again, same write | Nothing lost, no second trial. |

Live during grace, because seven more days of a free listing costs
approximately nothing, and hiding a plumber who was up a roof for a fortnight
loses him permanently. You have ten providers, not ten thousand. Hidden at the
end, because a directory listing people who are not paying is one where the
model quietly stops being true and nothing breaks to tell you.

Three things this has to get right:

- **Do not overload the `status` column.** `hidden` already means "an admin
  took this down after a bad edit". Reusing it loses that distinction, and
  worse, it collides with the approve route's concurrency guard, which writes
  `.eq('status', expected)` — a row hidden by a billing cron would make the
  next admin decision silently fail. This wants its own column,
  `subscription_status`, mirroring Stripe's, with the directory reading
  `status = 'approved' and subscription_status is distinct from 'unpaid'`.
  Widen the check constraint before adding the value, per the house rules.
- **Hiding is not cancelling work in flight.** An accepted enquiry with a date
  on it is a promise between a host and a tradesman that we brokered. Going
  unpaid takes him out of the shop window; it must not withdraw him from a job
  somebody is expecting on Tuesday.
- **Coming back is one write.** No re-approval, no re-review, and no second
  ninety days — the guard that only stamps a null `trial_ends_at` is what
  makes that safe, wherever it ends up living.

## What has been built, 31 August 2026 — second pass

The reminder ladder, the card capture and the grace period. Built on top of the
stamp below. Still nothing that charges anybody without Stripe doing it.

- `20260831170000_provider_subscription_billing.sql` — `stripe_customer_id`,
  `stripe_subscription_id`, `subscription_status`, `reminders_sent`,
  `billing_token_hash`. **Run on test and production.**
- `lib/serviceSubscription.ts` — the ladder, the seven-day grace, and
  `visibleInDirectory`. Pure, so the cron, the webhook and the tests agree.
- `lib/serviceBillingToken.ts` — the card link, derived by HMAC rather than
  minted, so all four emails keep working.
- `lib/serviceSubscriptionAlert.ts` — the six emails.
- `app/api/cron/service-subscriptions/route.ts` — daily at 07:00. Sends what is
  due, catches up what was missed, and hides after grace.
- `app/api/services/billing/route.ts` + `app/services/billing/[token]/page.tsx`
  — Stripe Checkout in subscription mode with `trial_end` from `trial_ends_at`.
- Webhook: `checkout.session.completed` for `provider_subscription`,
  `customer.subscription.updated` / `.deleted`, `invoice.payment_failed`.
- The directory and the enquiry route both refuse an `unpaid` provider.

**Two environment variables are needed before any of it does anything:**
`STRIPE_SUBSCRIPTION_PRICE_ID` and `BILLING_TOKEN_SECRET`. See `.env.example`.

## What was built earlier the same day

The stamp, and nothing else. No billing, no reminders, no Stripe. The point of
landing it alone is that the deadline for this became invisible when it stopped
being a date — dates now accrue correctly from the first real lead, whenever
the rest gets finished.

- `20260831140000_trial_starts_at_first_enquiry.sql` recomputes every stamped
  date from the enquiry history. **Not yet run.** Test first, then production.
- The admin approve route no longer stamps `trial_ends_at`. It still fixes
  `plan` and `commission_rate`.
- `app/api/services/enquiries/route.ts` stamps it, on a successful send only,
  guarded with `is('trial_ends_at', null)` so two enquiries in one second
  cannot both write.
- The approval email no longer quotes a date and says the free period starts at
  the first enquiry. `planTerms()` says the same.
- `trialState()` replaces the two-state reading of `trialActive()`, so nothing
  can tell a provider his free period has ended when it has not started.
- `MAINTENANCE.md` corrected — it said there was no free trial.

981 tests pass and the build is clean. The email that tells him the clock has
started is **not** built and is the first thing the reminder work should add.

## Still open

1. ~~The grace period length.~~ **Seven days**, agreed 31 August 2026.
2. **Whether providers get a dashboard.** The token link works and matches how
   they already answer enquiries, but "what am I paying, and when" is a
   question they will ask and there is currently nowhere to answer it. This
   overlaps the provider dashboard mockup already queued.
3. ~~Whether to tell the already-approved providers.~~ Liam is writing to the
   three of them personally rather than sending a system email.
