# Failure-path audit — money, concurrency, leaks (2026-09-14)

Tracking doc (GitHub issues are disabled on this repo). A read-only audit of the
failure paths: what happens when a write fails, when Stripe returns something
unexpected, when a webhook arrives twice or out of order, when a cron overlaps
another, and when two people act on one booking at once. Money first, because the
cottage path takes real payments.

**Status: recorded, NOT fixed — except the grants leak (F-LEAK), fixed by
migration `20260914091719` (applied to test + production, read back).** This doc
also carries the **corrections to `AUDIT-SWALLOWED-WRITE-ERRORS-GROUP-A.md`** —
each of its ten sites re-verified against the current code rather than trusted.

## The context that frames everything (proven from production)
Production is near-empty: 5 bookings (all cancelled/unpaid), 4 payments, **0
payouts, 0 service_orders, 0 slot_sessions**. The payout engine has never run in
production; the experiences path has taken nothing; Stripe live mode is off. So
every money-path defect below is **latent** — the code is provably wrong, but
there is no production throughput to have fired it, and the test database was
off-limits (another session mid-build), so none could be forced dynamically.
"Proven" below = read from production or from the code's own logic; "reasoned" =
could not be observed.

## Group A re-verified — what the swallowed-write doc got right and wrong
| # | Site (current) | Verdict | Note |
|---|---|---|---|
| 1 | host-payouts `:341-390` | **FIXED** ✓ | Both `ledgerError`/`stampError` captured; counts as failed, logs loud, skips the "paid" email. Confirmed. |
| 2 | balance-charges success `:393`/`:409` | **Worse than claimed** | On success the `payments` row is settled to `succeeded` (`:409`) even if `bookings→paid` (`:393`) fails, destroying the dangling-row guard → **genuine second charge next run**. No webhook backstop (`payment_intent.succeeded` is unhandled — F7). Auto-cancel sub-branch refunds (`:146`) with **no idempotency key** → double-refund. |
| 3 | orders/respond confirm `:190` | As claimed | Card captured, `service_orders→confirmed` swallowed → guest charged + emailed, provider never sees it. Re-capture key-protected (no double charge). Latent (0 orders). |
| 4 | bookings/cancel `:167` | As claimed | Guest told success while booking stays confirmed and **dates stay blocked**. Double-refund *prevented* by the `guest-cancel-<id>` key. The guarded twin is `stripe/refund:257`. |
| 5 | bookings/host-refund `:155` | As claimed + | Same unguarded update; and the stale `amount_refunded` feeds the `amount > refundable` guard, so a **later host refund can exceed what's left**. |
| 6 | experienceCancel `:100` | As claimed | Refund key-protected; swallowed CAS update leaves the seat un-released → **undersell**. Latent (0 sessions). |
| 7 | connect routes `:97` / `:135` | As claimed | Orphaned Stripe connected account + duplicate on retry. Moot until live mode. |
| 8 | host-payouts settle-rows `:493` | **Overstated** | Swallowed, but the deduction is driven by the RPC-maintained **total** (which *is* checked), so the cost is bookkeeping drift, **not** the re-charge the doc claims. |
| 9 | stripe/refund `:211`/`:288` | As claimed (audit-level) | `amount_refunded` is guarded (`:257`); only the penalty row + refund ledger rows swallow → **audit loss**, not money movement. |
| 10 | clawback `:146/227/260` | As claimed (audit-level) | Money paths guarded (RPC checked, reversal keyed); three **audit rows** swallow. |
| — | host-payouts `toSend<=0` branch `:393-408` | **Uncatalogued** | Both writes swallowed on the whole-payout-to-debt path → can double-decrement what a host owes. Not in the Group A doc. |

## Ranked findings (this audit)
| Rank | Finding | Cost | Proof |
|---|---|---|---|
| 1 | **F2/F1 concurrency:** no status CAS or atomic increment on booking write-backs. Guest cancel racing the balance cron charges a **cancelled** stay; two overlapping balance runs double-charge. | £ guest | reasoned |
| 2 | **Group A #2** (above) — double-charge + keyless double-refund, no webhook backstop. | £ guest/platform | reasoned |
| 3 | **F3 lost update:** concurrent host-refund + guest-cancel both read `amount_refunded=0`; both refunds hit Stripe, DB records one. Duplicate refund ledger rows. | £ mis-stated | reasoned |
| 4 | **Group A #4/#5** unguarded booking update after refund → blocked dates / over-refund on retry. | £ / blocked dates | reasoned |
| 5 | **F-LEAK (FIXED):** `service_providers.commission_rate` + `settlement` were `SELECT`-able by `anon`/`authenticated` — the platform's per-host cut, publicly queryable. Violated the house rule; inconsistent with `listings` (which never granted it). | leak | **proven in prod**; **fixed** `20260914091719` |
| 6 | **host-payouts residual** (#1 tail): both bookkeeping writes fail after a transfer → second real transfer >24h later. Code-documented, uncloseable from the DB. | £ host | code-acknowledged |
| 7 | **Group A #3** confirm-capture (above). | £ guest (service path) | reasoned; latent |
| 8 | **Profile-delete cascade:** `bookings → profiles` is `ON DELETE CASCADE` (host + guest); `payments`/`payouts` are `SET NULL`. Deleting a user deletes their bookings and **orphans the ledger**. Matters for the GDPR-erasure work. | data / audit | **proven** (prod FK rules) |
| 9 | **F5 webhook** returns 200 on a mid-handler throw → partial writes never retried; a non-duplicate `stripe_events` insert failure disables dedup; **F6** duplicate `service_order` on redelivery for a non-exclusive provider; **F8** oversold auto-refund update swallowed. | £ / data | agent-read, corroborated where testable |
| 10 | **#6 + non-atomic seat decrements** (orders/cancel, respond, cron/service-orders): read-then-write `seats_taken`, no CAS → undersell. | blocked seats | reasoned; latent |
| 11 | **Audit-row drift** (#8/#9/#10): swallowed ledger inserts. Live proof: one prod profile carries `payout_balance_owed = 0.05` with **no** backing rows (5p, likely test noise, but the exact class). | audit | **proven** (prod) |
| 12 | **`NaN` payout risk:** `admin/payouts` + `admin/earnings` inline the commission fallback instead of `rateFor()`; a non-numeric rate → `NaN` payout figure. | cosmetic/admin | reasoned |
| 13 | **Latent:** `grant all … to anon` on item/price/extras tables (RLS-only defence); BST day-slip on invite-expiry + UTC-as-London slot time compares; permissive defaults (`service_orders.status='authorised'`, slot `cancellation_window_hours=48`). | low | mixed |

## What could not be reached, and why
- **The test database** — another session was mid-build on it; untouched. So every "reasoned" item above could not be forced dynamically.
- **Stripe state** — sandbox, live mode off: orphaned accounts, transfer/reversal behaviour, and the payout ladder are unobservable.
- **Webhook internals (F5/F6/F8)** were read by a sub-agent, corroborated only where they touched something verified directly (F7 ↔ #2's missing backstop). Confirm before fixing.
- **Proven directly from production:** the near-empty state, the 5p ledger divergence, the FK cascade rules, and the `commission_rate`/`settlement` leak (before the fix) and its closure (after).

## The one thing fixed here
`F-LEAK` only. Migration `20260914091719` revokes `SELECT` on
`service_providers.commission_rate` and `.settlement` from `anon`/`authenticated`
(service_role retained; readers checked first — the two pricing routes read via
the service role, `settlement` has no reader, the wizard reads neither). Applied
to **test then production**, read back on both; the guard registry
(`tests/select-grant-decision-guard.test.ts`) moves both columns to REVOKED with
reasons. Everything else is recorded here, **not fixed** — the concurrency and
double-charge items (ranks 1–4) are the money-first work and want a human on them.

## The shared root cause of ranks 1–4
Idempotent at Stripe, lost-update in the DB: the money movement is
idempotency-keyed, but the booking write-back is a read-then-write with no status
compare-and-swap and no atomic increment on money columns. The repo already has
the tool for it — the `adjust_payout_balance` RPC — and it is not used on these
paths.
