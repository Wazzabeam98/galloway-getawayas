# Looking after Galloway Getaways

Notes for whoever is doing the maintenance — including Claude Code.

## What this is

A booking site for self-catering properties in Dumfries and Galloway. Guests
book and pay through the site; the platform takes a commission and passes the
rest to the property owner. Real money moves through it, so mistakes here cost
somebody something.

## Checking what's broken

Errors are recorded in the `error_log` table and shown at `/admin/errors`.

For a machine-readable summary, grouped so one fault reads as one issue:

```
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://gallowaygetaways.co.uk/api/errors/export?hours=24"
```

Optional: `hours` up to 720, and `resolved=true` to include ones already ticked
off.

Each issue comes with how many times it happened, which pages, how many people
it affected, and a sample stack.

## What to do with them

Worth acting on:

- anything with `"source": "server"` — a route or a scheduled job failed
- anything affecting several people
- anything touching payments, payouts, refunds or bookings

Usually not worth chasing:

- one-off browser errors from a single person, often an extension or a flaky
  connection
- anything from a bot or a crawler

## How to work on this

Please:

- **branch for money-touching code — payments, payouts, refunds — and let a
  human merge it.** Several bugs here have had non-obvious causes where the
  first plausible fix was wrong. Everything else goes straight to master while
  the site is private and pre-launch. See the house rules in `CLAUDE.md`.
- **read the surrounding code before changing it.** Naming collides in places —
  the Stripe webhook has a local variable called `logError`, unrelated to
  `lib/logError.ts`.
- **run the build before proposing anything.** TypeScript has caught real bugs
  here, not just style issues.
- **say when you are unsure.** A flagged uncertainty is far cheaper than a
  confident wrong fix to a payment route.

## Things that bite

- **This targets es5.** Some modern syntax fails the build — spreading a `Set`,
  for example.
- **Adding an import**: insert it before the first import, not after the last
  one. Several files use multi-line `import { ... }` blocks and an import
  dropped into the middle of one is a syntax error. This has happened three
  times.
- **New status values need the check constraint widening first.** Adding
  `'hidden'` to listings, or `'pending_payment'` to bookings, fails silently at
  the database until the constraint allows it.
- **The Supabase CLI is linked to the production project, not the test one.**
  `supabase/.temp/project-ref` says `hviwjxigqivjfhmhpjiy`, which is
  production, while `.env.local` points the app at the test project
  `yefoqcabuijcowoqewtc`. So the app and the CLI are aimed at different
  databases, and `supabase db push`, `db reset` or a migration run from this
  checkout hits **live data** even though everything else in the session is on
  test. Check with `cat supabase/.temp/project-ref` before running any CLI
  command that writes, and re-link with `supabase link --project-ref
  yefoqcabuijcowoqewtc` if you mean the test project.

- **A co-host is not the `host_id` on a booking.** Any query on their behalf
  needs the service key, or row-level security returns nothing and the page
  looks empty rather than broken.
- **Money columns are revoked from `authenticated`.** `commission_rate`,
  `payout_*`, `is_admin`, `payout_balance_owed`. Anything writing to those goes
  through a server route.
- **Refund or transfer money before changing a booking's status**, and don't
  notify anyone until it has succeeded. Doing it the other way round is how a
  guest gets told their booking is cancelled while their money is still here.
- **Idempotency keys must not include anything resettable.** One included an
  attempt counter, a test reset it, and Stripe took a second payment.

## Scheduled jobs

All at `/api/cron/*`, all behind `CRON_SECRET`, all listed in `vercel.json`:

| Job | When | Does |
|---|---|---|
| `balance-charges` | 9am | Takes the balance 30 days before check-in, then the 72-hour failure ladder |
| `host-payouts` | 11am | Pays hosts the day after their guest checks in |
| `ical-sync` | every 3 hours | Refreshes imported calendars |
| `review-reminders` | 10am | Nudges guests and hosts to review |
| `error-digest` | 8am | Emails the owners, only when something has broken |

They can be triggered by hand from Vercel → Cron Jobs → Run.

## Where things live

- `lib/pricing.ts` — the only place a booking total is worked out. The widget
  and the server both use it, so they can't disagree.
- `lib/cancellation.ts` — cancellation tiers and refund fractions.
- `lib/access.ts` — who may do what to which listing.
- `lib/fees.ts` — commission.
- `lib/clawback.ts` — recovering a payout after a refund.
- `lib/logError.ts` — recording a server-side failure. Never throws.
