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
```

The cross-cutting runner replays a real webhook, so it needs `stripe listen`
running and the `whsec_` it prints written into `.env.local` — see the note in
`CLAUDE.md`.

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
