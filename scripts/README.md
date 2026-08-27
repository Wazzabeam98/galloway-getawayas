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

App mail (bookings, payment reminders, payout breakdowns) goes through Resend,
which does keep a log, so `last_event` shows delivery and bounces. That half is
skipped unless `RESEND_API_KEY` is in `.env.local` — it is set in Vercel but
not locally, and sensitive Vercel values cannot be read back out, so it has to
be pasted in by hand to enable it.

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
- **The RLS probe is expected to FAIL** until item 8 is closed. It writes as
  the user, with their own access token, so the policy is genuinely in the
  path — the service role would bypass it and prove nothing. It confirms that
  an owner can set their own `status` to `approved`.
