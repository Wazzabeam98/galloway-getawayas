# Payment test scripts

Two scripts, both pointed at the **test** Supabase project and Stripe **test**
mode by `.env.local`. Both refuse to run if the Stripe key is not `sk_test_` or
the Supabase URL is not the test project, so neither can reach production.

```
node scripts/seed-payments.mjs           # reset, then seed
node scripts/seed-payments.mjs --reset   # tear down only
node scripts/payout-scenarios.mjs        # scenarios 19-24, needs `npm run dev`
node scripts/refund-scenarios.mjs        # scenarios 12-18, needs `npm run dev`
node scripts/balance-scenarios.mjs       # scenarios 3 and 7-11, needs `npm run dev`
node scripts/crosscutting-scenarios.mjs  # scenarios 25-29, needs `npm run dev`
node scripts/seed-my-passport.mjs        # a finished stay on your own account
node scripts/inbox-scenarios.mjs         # mark unread / star / archive, needs `npm run dev`
```

The cross-cutting runner replays a real webhook, so it needs `stripe listen`
running and the `whsec_` it prints written into `.env.local` — see the note in
`CLAUDE.md`.

`inbox-scenarios.mjs` is not part of the payment set either. It covers the
per-conversation actions in the inbox — mark as unread, star, archive — and it
makes its own host and guest on `@gallowayinbox.test`, deliberately *not* the
payment seeder's domain, so the reset below never touches them and the two
never disturb each other. It cleans up after itself; `--reset` on its own
clears anything an interrupted run left behind.

It writes `conversation_prefs` as the signed-in user with their own access
token, the way the browser does, so row-level security is part of what is being
tested rather than something bypassed.

`seed-my-passport.mjs` is the odd one out and is not part of the payment set.
It puts a couple of finished stays on a real address you sign in with, so the
passport has stamps in it. It stays off the `@gallowayseed.test` domain on
purpose, so the reset below never touches it — clean it up with its own
`--reset`.

**Reseed between runners.** They all use the same hosts, and each leaves
bookings paid out, cancelled or in debt behind it. Running one straight after
the other without a reseed makes the second one fail on state the first left.

Anything that runs `npm run build` overwrites `.next` underneath a running
`next dev`, which then serves 500s until it is restarted. Build or dev, not
both.

## What the seeder makes

- four auth users — a guest and three hosts — all on `@gallowayseed.test`,
  which is how a reset finds them again. Nothing without that domain is touched
- profiles, listings and bookings for each payout scenario
- a real test-mode PaymentIntent behind every booking, so refunds are real
- Stripe Connect accounts: two fully onboarded, one deliberately half-finished
  for scenario 21, and a spare
- enough platform *available* balance to actually transfer from

Two things are slower or fiddlier than they look:

- a new Connect account sits in `pending_verification` for up to a couple of
  minutes before `payouts_enabled` turns true, so the seeder polls. Created
  accounts are cached in `.seed-manifest.json` and reused
- transfers come out of the platform's **available** balance, and ordinary test
  charges sit in *pending* for a week. The seeder tops available up with
  `tok_bypassPending`
- connected balances are normalised to zero at the start of every run,
  including negative ones left behind by a clawback

## What the runners cover

Scenarios 12-24 from `PAYMENT-SCENARIOS.md`, driven through the real routes over
HTTP with real test-mode Stripe behind them. Every scenario finishes by checking
the database and Stripe agree on what moved.

Two things worth knowing if a scenario starts failing oddly:

- **The platform's available balance runs down.** Each full pass sends a few
  thousand pounds out to hosts before any of it is reversed back. The seeder
  tops available up to £6000; a run that fails with *insufficient available
  funds* has outrun it.
- **Scenario 14 clears the host's `payout_balance_owed` before its payout run.**
  Scenario 13 leaves a 5% fee against the same host, and the payout run takes it
  off whichever due booking it reaches first — not necessarily scenario 14's. The
  debt-comes-off-the-next-payout behaviour is scenario 24's job.

## Running the browser suite

```
npm run e2e:sync    # bring the preview up to master and wait for the build
npm run test:e2e    # drive the sign-up in a real browser
```

The suite signs people up — it creates auth accounts and lodges applications —
so where it points is a safety question, not a convenience.

**It does not point at master, because master has no preview.** Vercel lists
`galloway-getawayas-git-master-…` among the *production* aliases, so master's
branch URL and the live site are the same deployment. There is no preview of
master to use. Instead there is a long-lived branch, `e2e-preview`, that exists
only to be deployed as a preview. `npm run e2e:sync` moves it to master's tree
and waits for the build.

It never touches your working tree or your current branch: the commit is built
with `git commit-tree` and pushed straight at the remote branch. It carries
master's tree with its own commit id, because **Vercel will not build a SHA it
has already deployed** — the branch was first created at master's own commit and
Vercel built nothing at all.

### The suite refuses to run against the wrong thing

A URL in a config file is a poor guard, and it failed silently once already: it
named a feature branch, the branch merged, and the alias went on serving that
branch's last build. The suite was green for days against code eight commits
behind master. **A test that passes against the wrong build is worse than one
that fails**, because it is evidence of something nobody checked.

So `e2e/global-setup.ts` asks the deployment what it is, via `/api/health`,
before the browser opens. Three refusals, each stopping the whole run:

| | |
|---|---|
| **production** | invented tradesmen in the real queue. No override, ever. |
| **wrong database** | a preview whose environment points at the production Supabase project. |
| **stale** | the deployed tree is behind `origin/master`. |

The database check is the one a URL could never make. A preview is only safe
because its *environment* points somewhere safe, and this project has already
shipped an env var scoped to Production but not Preview — so "it is a preview"
and "it writes somewhere safe" are separate questions, and only the running
process can answer the second.

Staleness is compared by **tree**, not commit id, since the preview deliberately
carries a different commit. It can be overridden for one run:

```
PLAYWRIGHT_ALLOW_STALE=1 npm run test:e2e
```

which says loudly that a pass is evidence about that build and not about master.
There is no equivalent for the first two.

### Automated runs do not send alerts

An application from a reserved test domain (`.test`, `.invalid`, `.example`,
`.localhost`) writes its row exactly as a real one does but sends no "New
business waiting" email. The suites use `@gallowayauto.test`, and every run used
to ring the real bell — an alert that mostly fires for nobody is an alert that
stops being read. The decision is on the address rather than an environment
variable so it cannot be misconfigured per deployment and cannot swallow a real
application: those TLDs are reserved and can never be a real domain. See
`lib/testAddresses.ts`.

## Checking what is actually live

```
node scripts/check-deploy.mjs                  # production vs your working copy
node scripts/check-deploy.mjs --url <host>     # what is THAT tab serving
node scripts/check-deploy.mjs --branch <name>  # latest build of a branch
node scripts/check-deploy.mjs --list           # recent deployments
node scripts/check-deploy.mjs --watch          # re-check every 10s
```

Read-only: **this script** issues GETs and nothing else, so it cannot deploy,
promote, roll back or delete. Safe to run mid-deploy.

The restraint is in the script, not in the credential. `VERCEL_TOKEN` itself is
a full-access project token — it created production environment variables and
triggered a production deployment on 28 August 2026 — so anything else written
against it can reach the live site. `.vercel/project.json` supplies the project
and team.

"Am I looking at the newest build?" is three questions that get run together,
and the guessing comes from answering one and assuming the others:

- **What is live** — which commit the production alias is serving right now.
- **What is built** — whether the commit you pushed finished, failed, or is
  still going. A green dashboard answers this one and is routinely mistaken for
  the first, because promotion is a separate step from building.
- **What you are seeing** — the tab that is open may be a preview, a branch
  alias, or a build that has since been superseded.

The default run answers the first and compares it to your checkout, which is the
part Vercel cannot tell you:

```
=== LIVE ON PRODUCTION ===
  READY — this is what visitors get
      30ae1d2 master  "Press the button, in a real browser, at last"

=== YOUR WORKING COPY ===
  master @ 30ae1d2
  MATCHES what is live — the code visitors get is your commit
  1 uncommitted file(s) — on no server anywhere, deployed or not
```

"Live" here means *what the domain resolves to*, which is not the same as the
newest build and is the distinction the whole script turns on. Vercel's own
`targets.production` is the LATEST production deployment — during a build that
is the one still building, so reading the live commit off it reports a push as
live minutes before it is. This asks the domain instead. When a newer build
exists but has not replaced the live one, it gets its own section, and a push of
your own that has built but is not yet serving is called out as exactly that:

```
your commit is BUILT but NOT YET LIVE — see the newer build above
```

`--url` is for the third question, and it is the one worth reaching for when a
page looks wrong. **A branch alias keeps serving the last build of that branch
forever, including after the branch is merged and deleted** — so it stays green,
stays correct for what it is, and drifts further behind master every day:

```
STALE: 8 commit(s) behind master. What you are looking at is not the newest code.
```

`BUILDING` and `QUEUED` are called out rather than left as jargon, because they
are the states where the alias is still serving the *previous* build — much the
commonest reason a change "did not go out" when in fact it had not gone out yet.

## Checking what happened to an email

```
node scripts/check-email.mjs                    # last 10 accounts
node scripts/check-email.mjs --email you@x.com  # just that one
node scripts/check-email.mjs --watch            # re-check every 5s
```

Read-only: it creates nothing and sends nothing, so it is safe to run in the
middle of a test.

Auth mail (sign-up confirmation, password reset) is sent by Supabase over its
own SMTP and has no send log. What it does have is two timestamps on the user
row, and between them they answer the question:

- `confirmation_sent_at` — Supabase accepted the request and sent a link.
- `email_confirmed_at` — somebody opened that link and it was redeemed.

**Sent but never confirmed is what a broken link looks like from this side.**
That is the signal to watch when testing a confirmation link on a second
device: the row appears on sign-up, and the second timestamp lands the moment
the link is opened, wherever it is opened.

App mail (bookings, payment reminders, payout breakdowns, provider decisions)
goes through Resend, which keeps a log. `RESEND_API_KEY` is in `.env.local`, so
this half answers the question people actually ask — did it arrive:

```
DELIVERED — it arrived
    to guest@example.com  |  "Payment received"  |  9d ago
BOUNCED — it did not arrive
    to typo@exmaple.com   |  "Approved"          |  2h ago
```

`delivered` is the only status that means it arrived. `sent` means Resend
accepted it and the receiving server has not answered yet, which is not the
same thing and is not rounded up to it. Anything that did not arrive is listed
again at the end, because a bounce eight rows up is a bounce nobody sees.

`--email` filters both halves, so one address can be followed across auth mail
and app mail at once.

## Does the database refuse what the browser must not do?

```
node scripts/enquiry-rls.mjs          run the checks
node scripts/enquiry-rls.mjs --reset  clear an interrupted run
```

Eighteen checks, each written as "this must be REFUSED", run with a real
signed-in access token against PostgREST — the same way the browser talks to
the database, with row-level security and the column grants in force.

**Why a script and not a test.** Every rule it checks lives in Postgres. The
unit suite has no database and no session, so it can assert that
`contactReleased` returns true for one status but not that a host editing the
request in devtools is refused. Only a real token can, which is why
`inbox-scenarios.mjs` works the same way.

What it pins: a host cannot set `status`, `expires_at`, `reply_token_hash`,
`reference`, `responded_at` or `host_phone`; **the accept cannot be forged**;
one host cannot read another's enquiry; the tradesman it was sent to can read
it but cannot rewrite the job description; nobody signed out can read anything;
and `service_wanted` accepts a write from anyone while being readable by
nobody.

It also pins something stronger than the design assumed: **a host cannot lodge
an enquiry from the browser at all.** `reference` is NOT NULL and is not
granted to `authenticated`, so an insert fails on the constraint before any
policy is consulted. The route, under the service role, is the only writer.

Makes its own accounts on `@gallowayrls.test` and cleans up after itself.

## Checking what happened to a text

```
node scripts/check-sms.mjs                   last 20 messages
node scripts/check-sms.mjs --to 07700900123  just that number
node scripts/check-sms.mjs --sid SMxxxx      one message
node scripts/check-sms.mjs --watch           re-check every 5s
```

Read-only, like `check-email.mjs`, and it matters more than that one does. An
emergency enquiry has **no fallback**: nothing is released and nothing is
escalated, so if the tradesman does not see the text and does not open the
email, the enquiry expires and the owner is told to ring somebody else. "Did
he see it" is the product.

`delivered` is the only status that means it reached a handset. **`sent` does
not** — it means Twilio handed the message to the carrier and nothing more,
exactly like Resend's `sent`, and rounding it up to success is how an unseen
emergency looks fine in a report. Anything not delivered is listed again at
the end.

It also flags a message that split into two segments. The text is built to fit
in one — see `emergencySms` in `lib/sms.ts` — so a split is a design fault
rather than a billing surprise, and usually means a character outside GSM-7
crept into the wording.

## Signed-in journey checks

```
node scripts/journeys.mjs                      # against the preview
node scripts/journeys.mjs --host http://localhost:3000
node scripts/journeys.mjs --reset              # remove the accounts and stop
```

What made these manual was that every interesting page is behind a login, and
a login needed an inbox or a password. Neither is true. `generate_link` on the
admin API hands back a token hash **without sending an email**, `/verify` turns
it into a session, and auth-helpers stores a session as one cookie holding a
plain JSON array — so a session can be minted on demand and thrown away.

**No password is stored anywhere.** The two accounts are created with a random
one that is discarded and never used.

The accounts live on `@gallowayauto.test`, a domain nothing else uses, so the
payment seeder's reset and the inbox runner's reset can never touch them.

It covers: the signed-out bounce off `/dashboard`, that `/admin` leaks nothing
to a signed-out visitor or an ordinary guest **and that an admin does see it**
(without the positive half the other two would pass if `/admin` were simply
broken), the guest pages, the provider apply page, and that a cron route
refuses an unauthenticated call.

Two things worth knowing about the assertions:

- **`notFound()` answers HTTP 200**, not 404 — Next renders the not-found
  boundary with a 200. So the status code says nothing about whether a page was
  allowed, and these checks read the page content instead. An earlier version
  keyed on the status and reported a hole that was not there.
- **The RLS probe writes as the user**, with their own access token, so the
  policy and the column grants are both genuinely in the path — the service
  role would bypass them and prove nothing. It checks four things: that an
  owner cannot set their own `status` to `approved`, cannot write
  `approved_digest` or `commission_rate`, **can** still submit through
  `submit_service_provider`, and cannot submit somebody else's listing.

  Those four FAIL until `20260827185827_provider_status_grants.sql` has been run on
  the project being tested. A 404 from the function is treated as a failure
  rather than a refusal, so "not deployed" can never be mistaken for "locked".

## Running a migration on test

```
node scripts/migrate.mjs supabase/migrations/20260831093000_thing.sql            # dry run
node scripts/migrate.mjs supabase/migrations/20260831093000_thing.sql --apply    # run it
node scripts/migrate.mjs <file> --apply --read "select ..."                # run, then read back
node scripts/migrate.mjs --sql "select ..."                                # read-only query
```

Needs one line in `.env.local`, which is gitignored:

```
SUPABASE_TEST_DB_URL=postgresql://postgres.yefoqcabuijcowoqewtc:<password>@aws-0-eu-west-2.pooler.supabase.com:5432/postgres
```

The name says TEST deliberately. A production string in a slot called
`SUPABASE_TEST_DB_URL` is wrong on its face, and the guards refuse it anyway:
the URL must carry the test project ref, and is refused outright if it carries
the production ref or that project's name. Both halves are checked, so a string
passes only by being the test database. The URL is never printed — only a
redacted form, including in error messages.

Three things it will not do:

- **Run without being asked.** No `--apply` is a dry run: it prints the plan and
  stops.
- **Lose data quietly.** Statements that drop tables or columns, truncate, or
  delete without a `where` need `--destructive` *as well as* `--apply`.
  Structural changes that lose no data — dropping a policy, a constraint, an
  index, or revoking a grant — are named in the plan but need no extra flag,
  because most of `supabase/migrations` does them.
- **Reach production without being told to.** This used to say "Ever", and that
  stopped being true on 27 August 2026 when the refusal was lifted
  deliberately. Production is reachable, and only by naming it:

  ```
  node scripts/migrate.mjs <file> --target prod            # dry run
  node scripts/migrate.mjs <file> --target prod --apply    # run it
  ```

  It has its own variable, `SUPABASE_PROD_DB_URL`, so a production string never
  sits in a slot called TEST. Each target checks its URL really is the project
  it claims to be, both ways round, so the two cannot be crossed over.

  **This note was stale for a day and cost something.** On 28 August it was read
  as still true, so a migration that live code depended on was left as "a paste
  for later" — and `bookings.cleaning_fee` was missing from production while
  `/api/stripe/refund`, `/api/bookings/cancel` and the balance-charges cron were
  all selecting it. Check the script, not this file, if the two ever disagree.

### The CLI is no longer linked to production

`supabase/.temp/` used to hold `project-ref`, `linked-project.json` and
`pooler-url`, all pointing at `hviwjxigqivjfhmhpjiy` (`supabase-pink-elephant`)
— production. Every other tool in this repo is pinned to test, so the CLI was
the one thing that was not, and it was the one thing that runs DDL. A stray
`supabase db push` would have applied every pending migration to the live
database.

Those three files are removed. `supabase db push` now fails with
`Cannot find project ref` instead of reaching production. `scripts/migrate.mjs`
is unaffected: it passes `--db-url` and never uses the link.

To link again deliberately: `supabase link --project-ref <ref>`.
