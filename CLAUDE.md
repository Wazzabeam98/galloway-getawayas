# Galloway Getaways — where the project is

Read this first, then `MAINTENANCE.md` for the technical traps.

## What it is

A direct booking site for self-catering holiday properties in Dumfries &
Galloway, Scotland. Guests book and pay through the site; Galloway Getaways
takes a commission and passes the rest to the property owner. Most properties
belong to other people.

Galloway Getaways Ltd, company number SC899385. Two directors, Liam and Jamie.

The point of it is that hosts keep more than Airbnb or Booking.com leave them,
and guests pay no platform fee. It only works if the money is right every
single time, so correctness beats cleverness everywhere in this codebase.

## Where it has got to

About 80% ready for a soft launch of roughly ten properties — three belonging
to Liam, one to a friend, three to a land-owner he advertises with, and a few
more. Everyone involved knows each other personally.

Built and working in Stripe sandbox:

- deposits and pay-in-full at booking, balance charged automatically 30 days
  before check-in with a 72/48/24-hour failure ladder
- guest and host cancellations with tiered refunds
- host payouts the day after check-in, commission netted off, with clawback
  when a refund lands after a payout
- co-hosts with per-listing permissions
- two-way iCal sync with Airbnb, Booking.com and anything else
- messages, reviews, damage deposits declared but collected by the host
- error monitoring at /admin/errors with an export endpoint

## What is NOT done, in the order it matters

1. **Nothing has been tested end to end with real money.** Stripe is still in
   sandbox. Live mode has not been switched on.
2. **The payout engine has never been run.** It is the largest untested thing
   in the project and it sends money to other people. Test it first.
3. There is a list of about 29 payment scenarios in the owner's notes that
   need scripting — money in, balance failures, refunds, payouts, and the
   cross-cutting cases like a price changing mid-booking. Roughly eight have
   been tested by hand.
4. Host terms are drafted but not reviewed by a solicitor. The open question
   is whether the platform acts as agent or principal, which affects
   liability and the VAT threshold.
5. Guest-facing terms still contain an incorrect line about a 10% fee being
   deducted from refunds.

## How the owner works

Everything until now has been written in a chat window and pasted into
GitHub's web editor, because his work laptop is locked down. That is why
several bugs reached production that a local build would have caught in
seconds — a duplicate variable, imports dropped into the middle of a
multi-line import block, Tailwind classes in a folder Tailwind does not scan.

He has just moved to a MacBook. **Run the build before showing him anything.**
That single change removes most of the failure modes this project has had.

He is not a developer. Explain in plain English, say what you are about to do
before doing it, and do not assume he will spot a mistake in code he cannot
read. He is, however, a good tester and has caught several real bugs — take
his observations seriously even when they sound vague.

## Where it is going

- experiences and add-ons: fishing trips, chefs, photographers, cakes, fresh
  fish delivered — all one system, a bookable extra attached to a stay, sold
  by a third party, with money split. Not started, needs scoping
- a host noticeboard for announcements, first post being a launch party
- a host-facing app, most likely a PWA first for push notifications
- partnerships with local businesses

## House rules for this codebase

- move money before changing a booking's status, never the other way round
- never put anything resettable in a Stripe idempotency key
- `lib/pricing.ts` is the only place a total is calculated
- widen a check constraint before adding a new status value
- money columns are revoked from `authenticated`; keep it that way
- a co-host is not the `host_id` on a booking, so their queries need the
  service key or row-level security silently returns nothing
