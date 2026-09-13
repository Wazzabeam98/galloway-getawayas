# Swallowed DB-write errors — Group A (money / booking / status paths)

Tracking doc (GitHub issues are disabled on this repo). From a sweep of the
write paths for the pattern `/finish` had: a Supabase `.insert/.update/.upsert`
whose returned `{ error }` is discarded, so a failed write vanishes silently.

Excluded from the sweep: `/api/services/finish` (fixed in #137) and
`/api/stripe/webhook` (the clean reference — every ledger insert and status
update there checks `error`).

**Status: recorded, NOT fixed** — except #1, taken on its own branch/PR.

## The common trap
Several of these sit inside a `try/catch`, but a Supabase query builder resolves
with `{ error }` rather than throwing, so the `catch` never covers a failed
write. That is why they read as handled at a glance and are not.

## Ranked by what a silent failure costs
| # | Site | Swallowed write | Cost of a silent failure |
|---|------|-----------------|--------------------------|
| 1 | `app/api/cron/host-payouts/route.ts:324` (+`:334`) | `payouts.insert(succeeded)` + booking `paid_out_at` | The ledger row + `paid_out_at` are the double-pay guard; if both fail, the next run past Stripe's 24h key re-sends → **host paid twice.** *(fixed separately)* |
| 2 | `app/api/cron/balance-charges/route.ts:393` (+`:156/:409/:476`) | `bookings.update(payment_status:'paid', balance_amount:0)` | Guest charged, booking still shows balance owed → **charged again next run.** |
| 3 | `app/api/services/orders/respond/route.ts:190` (+`:212/:142`) | `service_orders.update('confirmed')` after PI capture | Card charged, order never confirmed → provider never sees the booking. |
| 4 | `app/api/bookings/cancel/route.ts:167` (+`:155`) | `bookings.update(cancelled, amount_refunded…)` after refund | Guest refunded, booking still reads confirmed/paid, dates stay blocked. Correct guarded pattern already at `stripe/refund/route.ts:250`. |
| 5 | `app/api/bookings/host-refund/route.ts:155` (+`:142`) | `bookings.update(amount_refunded…)` after refund | Money moves, record may not. |
| 6 | `lib/experienceCancel.ts:100` (+`:94`) | `service_orders.update('refunded')` in stay-cancel cascade | Guest refunded, order stays confirmed, **seat not released.** |
| 7 | `app/api/stripe/connect/route.ts:97` & `app/api/services/connect/route.ts:135` | `.update(stripe_account_id)` | Fresh connected account orphaned, id lost → can't be paid, dup account on retry. |
| 8 | `app/api/cron/host-payouts/route.ts:444` | `payouts.update(settled)` | Recovered debt not marked settled → host re-charged next run. |
| 9 | `app/api/stripe/refund/route.ts:211` (+`:289`) | `payouts.insert(penalty 'owed')` + refund ledger | Penalty/refund ledger rows lost. |
| 10 | `lib/clawback.ts:146/227/260` | `payouts.insert` reversal audit | Reversal audit rows lost. |

Borderline (A/B): `app/api/stripe/checkout/route.ts:325` — `bookings.update(payment_plan, deposit, commission_rate)` before the guest pays; if it fails the guest still pays but the terms are unstamped → wrong later balance charge / payout commission.

## Not in this doc
- **Group B** (content/access, the `/finish` class): `services/skills:132/135`, `admin/skills:137/143/166`, `listing-access:202/169/224`, `booking-guests/accept:116`, `services/enquiries/respond*`.
- **Group C** (low-stakes / self-healing): read receipts, ical status stamps, notify-dedup, re-derivable Stripe status refreshes.
- Genuinely-fine logging writes (`error_log`, `rate_limit_hits`, `admin_actions`) are not bugs.
