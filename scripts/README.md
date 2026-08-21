# Payment test scripts

Two scripts, both pointed at the **test** Supabase project and Stripe **test**
mode by `.env.local`. Both refuse to run if the Stripe key is not `sk_test_` or
the Supabase URL is not the test project, so neither can reach production.

```
node scripts/seed-payments.mjs           # reset, then seed
node scripts/seed-payments.mjs --reset   # tear down only
node scripts/payout-scenarios.mjs        # scenarios 19-24, needs `npm run dev`
```

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

## What the runner covers

Scenarios 19-24 from `PAYMENT-SCENARIOS.md`, driven through the real routes over
HTTP with real test-mode Stripe behind them, checking the database and Stripe
agree afterwards.

Scenario 23 is **not reproducible against Stripe** — see the note it prints. Its
fallback branch is covered by `tests/clawback.test.ts` instead.
