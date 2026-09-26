# Follow-up: make the host-payout double-pay guard authoritative against Stripe

Tracked item (GitHub issues are disabled). **Not built** — this records the one
gap the #139 fix deliberately did not close.

## Why this exists
`#139` stopped `app/api/cron/host-payouts/route.ts` from swallowing the two
writes that record a payout (the `payouts` ledger row and the booking's
`paid_out_at`). It made a **single**-write failure safe and a **both**-write
failure loud. It did not — and from the database alone cannot — make it
*impossible* for the next run to pay a stay twice.

The reason is structural: the money moves **at Stripe** before any row is
written, and the Stripe transfer + the two DB writes cannot be one atomic unit.
If both DB writes fail (e.g. the write path is down for that iteration), no local
record exists, so the next run re-selects the stay and re-enters the payout path.
Today the only thing between that and a genuine duplicate transfer is Stripe's
**24-hour idempotency key** (`payout-<bookingId>`) — and this cron runs daily, so
the key has expired by the next run.

Proven on TEST (see #139): with both records forced absent, the next run
re-attempts the transfer every time; within 24h Stripe replayed the original, so
no new money moved — but past 24h it would.

## What to build
Before sending a transfer for a booking, ask **Stripe** whether one already
exists for it, rather than trusting only the local ledger:

- Look up existing transfers by the booking (e.g. `transfer_group`
  `booking_<id>` / the `metadata.booking_id` already set on the transfer, or a
  durable check keyed on `payout-<bookingId>`), and if one is found, reconcile
  from it (write/repair the local records) instead of sending again.
- This makes the guard authoritative against the system that actually moved the
  money, closing the both-DB-writes-failed window that the local records can't.

## Care points
- Keep it cheap: one lookup per due booking, and only where it matters (a
  booking with no local `succeeded` payout row) — don't add a Stripe round trip
  to the common already-recorded path.
- The lookup itself can fail; fail **closed** (skip + log, don't send) rather than
  sending unguarded.
- Preserve the existing ordering and the top-of-loop reconcile guard; this
  augments it, not replaces it.

Related: the Group A sweep doc (`AUDIT-SWALLOWED-WRITE-ERRORS-GROUP-A.md`),
item #1.
