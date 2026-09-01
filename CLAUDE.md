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

He works two ways, and both are current.

On the MacBook, with Claude Code, working locally. **Run the build before
showing him anything** — most of the failure modes this project has had are
ones a local build catches in seconds: a duplicate variable, imports dropped
into the middle of a multi-line import block, Tailwind classes in a folder
Tailwind does not scan.

The rest of the time, from a locked-down work laptop, by writing in a chat
window and pasting whole files into GitHub's web editor. This is a normal way
for the repo to change, not a legacy habit, and it has two consequences worth
knowing:

- `origin` can gain commits partway through a session while the local tree
  stays clean. A rejected push is him, not a collaborator. Fetch, read what
  landed, and re-apply on top rather than forcing.
- Those commits replace whole files rather than patching them, so a fix made
  earlier can quietly reappear undone. That is the paste carrying it along,
  not a decision — say so rather than treating it as intentional.

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

## Running it locally

Three things bite every single session on the MacBook:

- **Colima has to be started after a reboot.** Supabase's local tooling talks
  to Docker, and Docker here is Colima, which does not come back on its own:

  ```
  colima start
  ```

  If Docker commands report no such host, this is why. `colima status` says
  whether it is up. Note that `colima`, `docker` and `stripe` live in
  `~/homebrew/bin`, which is not on the default PATH.

- **`node`, `npm` and `npx` are not on the PATH a tool session starts with.**
  A login shell picks them up from `.zprofile`, but Claude Code's shell does
  not, and `npm run build` fails with `command not found` before it has done
  anything. Put them on the path first:

  ```
  export PATH="$HOME/.local/node/bin:$PATH"
  ```

  There are already two Node installs — `~/.local/node` and
  `~/.local/opt/node`, the first winning in a login shell. **Do not add a
  third.** A missing `node` here is a PATH problem, never a missing install.

- **The Stripe webhook signing secret changes every time `stripe listen`
  starts**, and it has to be written back into `.env.local` by hand. Start the
  listener, take the `whsec_…` it prints, and replace `STRIPE_WEBHOOK_SECRET`
  with it:

  ```
  stripe listen --forward-to localhost:3000/api/stripe/webhook
  ```

  Forgetting this is the classic one — every webhook fails its signature check,
  so payments succeed at Stripe while the site still shows the booking as
  unconfirmed. It looks like a bug in the webhook and is not.

## House rules for this codebase

- **every change goes to master through a pull request.**

  **What the rules actually are:**
  [Settings → Branches](https://github.com/Wazzabeam98/galloway-getawayas/settings/branches).
  Read the page rather than a paragraph here — the last version of this
  paragraph described protection that did not exist, and was believed for four
  days. A link that goes out of date still sends you somewhere true.

  What does not change, and is why the rules are set the way they are:

  - **A green `test-and-build` is required, and branches must be up to date
    before merging.** That second one exists because of a specific failure:
    three times in two days, two sessions each merged a PR whose check had
    passed against an older master, and master went red on a combination
    neither branch had ever run — once for 82 minutes. Enable auto-merge and
    GitHub does the rebasing, so the requirement costs nothing.
  - **Admins are deliberately NOT included in the rules.** You can merge past a
    red check. That is a decision, not an oversight: being able to ship at 11pm
    when you have to is worth more than a gate you would route around anyway,
    and a rule people route around teaches them the rules are optional.
  - **GitHub does not require anyone to read a diff.** Money-touching code —
    payments, payouts, refunds — still wants a human on it before the merge,
    and that is a habit rather than a gate. Saying otherwise is how the old
    paragraph went wrong.

  The rule replaced "push straight to master for anything that isn't payments"
  on 28 August 2026: Vercel already refused to promote a build that would not
  compile, but nothing stopped a green build with failing *tests* reaching
  visitors, because Vercel never runs `npm test`.
- from the work laptop, at the Commit changes dialog, choose **"Create a new
  branch for this commit and start a pull request"** rather than committing
  to master. Then press *Enable auto-merge* and it lands by itself once the
  check passes — and does the rebasing that up-to-date branches would otherwise
  cost you on every PR
- locally, `git config core.hooksPath scripts/hooks` installs a pre-push hook
  that runs the tests and the build before anything leaves the machine. It
  refuses the push and names the file and line. `git push --no-verify` skips
  it for one push, which is for a work-in-progress branch and never for master
- move money before changing a booking's status, never the other way round
- never put anything resettable in a Stripe idempotency key
- `lib/pricing.ts` is the only place a total is calculated
- widen a check constraint before adding a new status value
- money columns are revoked from `authenticated`; keep it that way
- a co-host is not the `host_id` on a booking, so their queries need the
  service key or row-level security silently returns nothing
