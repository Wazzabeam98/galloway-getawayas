# What the payout run does with `payout_balance_owed`

31 August 2026. Traced because it is the last unknown standing between here
and paying a real host, and because the payout engine is still the largest
untested thing in the project.

**The question was: does the payout run treat `profiles.payout_balance_owed`
as an instruction, or does it recompute the debt from the itemised rows?**

## The answer

**It obeys it.** The number on the host's profile is the instruction, and the
money follows it. Nothing recomputes or cross-checks it before the transfer
goes out.

Proven on the test project rather than read off the code. A host was given a
running total that deliberately disagreed with their itemised debts — the
total said £100 owed, the individual rows justified only £30 — and a real
£400 stay was put through the payout run with real test-mode Stripe behind it:

```
profiles.payout_balance_owed   £100.00
itemised rows marked owed       £30.00
host share before any debt     £340.00

if it obeys the total       → deduct £100, send £240
if it recomputes from rows  → deduct  £30, send £310

payout run → 200 {"ok":true,"sent":1,"skipped":3,"failed":0}
sent to the host               £240.00
```

£240. It obeyed the total. The host was £70 short, and the run was cheerful
about it.

## The part that is worse than the answer

After deducting £100 justified by £30 of debts, the run went on to mark the
£30 row **fully settled** and set the running total to **£0.00**.

So the books afterwards read: total owed £0, itemised outstanding £0. **They
agree perfectly.** The £70 discrepancy did not just get taken from the host —
it got tidied away, and the admin panel's own drift warning would never fire
again on that host.

The only surviving trace is the note on the payout row, which says "After
£100.00 owed was deducted". That is real evidence and it is worth having, but
it is a line a person has to go and read, on a booking nobody has a reason to
open, about a host who has not complained yet.

## So the safety of the whole payout run rests on that one number being right

Which raises the second question, and it is the one that matters more: **can
that number be wrong?**

Three places write it, and all three do the same unsafe thing — read the
total into JavaScript, add or subtract, write the result back:

| Where | What it does |
|---|---|
| `lib/clawback.ts` → `carryForward()` | reads, adds the shortfall, writes back |
| `app/api/stripe/refund/route.ts` | reads, adds the 5% host-cancellation penalty, writes back |
| `app/api/cron/host-payouts/route.ts` | reads, subtracts what it recovered, writes back |

None of them is atomic. Two of them running at once means one silently
overwrites the other. Demonstrated on the test project, through the exact
shape `carryForward()` uses:

```
starting balance owed: £0.00
two clawbacks arrive together: £40.00 and £25.00
correct answer: £65.00

balance owed afterwards: £40.00
LOST £25.00 — one write overwrote the other
```

### How likely is that, honestly

At ten properties, two clawbacks landing in the same instant is unlikely.

But the payout run has the widest window in the system, and it is not a
matter of instants. It reads `payout_balance_owed` **before** it calls Stripe
to make the transfer, and writes the new total **after** that call comes back.
A network round trip to Stripe sits between the read and the write. Any debt
that lands in that window — a dispute webhook, a host cancelling, an admin
issuing a refund — is read by nobody and overwritten by the payout run's
stale figure.

That is not a race you need volume to hit. You need one refund at eleven in
the morning.

The direction of the error is not reassuring either. A lost clawback means the
debt disappears and the host keeps money they owed. A lost payout decrement
means the debt stays and the host is charged for it twice.

## The drift warning does not cover this

`/admin/payouts` already compares the itemised rows against the running
totals and shows a red warning when they disagree. That is good, and it is
the reason this was traceable at all.

Two limits on it, both worth knowing before relying on it:

1. **It compares site-wide sums, not per host.** `itemised` totals every
   unsettled debt row on the site; `totals` sums `payout_balance_owed` across
   every host. One host £70 light and another £70 heavy cancel exactly, and
   the warning stays silent while both are wrong.
2. **It only sees drift that still exists.** As the run above showed, the
   payout run resolves the disagreement by consuming it. Once the run has
   been through, the two counts agree and the warning has nothing to find.

## What I would change, in order

None of this is done — it is money-path, and you read money diffs before they
merge.

1. **Make the three writes atomic.** A `SECURITY DEFINER` function doing
   `update profiles set payout_balance_owed = payout_balance_owed + $1`
   inside the database, called by all three sites, removes the lost update
   entirely. The arithmetic happens where the row is locked instead of in
   JavaScript that read the value a second ago. This is the important one and
   it is small.
2. **Make the payout run check before it deducts.** It has both numbers
   available — the running total and the rows behind it. If they disagree,
   the safe move is to pay the host their full share and raise it, rather than
   deduct a figure nothing justifies. A host paid too much is a conversation;
   a host quietly underpaid is what loses you a host.
3. **Make the drift warning per host**, so equal-and-opposite errors cannot
   hide, and have it look at settled rows too rather than only outstanding
   ones.

## What this does not say

The payout run was not otherwise found to be wrong. Commission, the
day-after-check-in timing, the idempotency key built from the booking id, the
withheld-in-full path and the failure path all behaved correctly in this
trace. The transfer used `payout-<booking id>` as its idempotency key, so the
same stay cannot pay out twice however the data is later edited.

This is one specific thing: the number it deducts is taken on trust, and
nothing in the system guarantees that number is right.
