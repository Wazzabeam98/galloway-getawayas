# One payment, counted once

29 August 2026. Branch `fix/payment-idempotency`, which sits on top of
`fix/webhook-reporting` — merge that one first. Nothing merged, nothing
deployed, production untouched.

Two bugs, both live, both ways the books go wrong. Proved first, then fixed,
then proved again, against real Stripe test-mode payments.

**One thing you asked for that I did differently, and I want you to check I am
right.** You said `amount_paid` should set, not add. Setting it to the payment
amount would be wrong — it would forget the deposit and record a £300 stay as
£150 paid. That is the same bug pointing the other way, and it is the direction
that shortchanges a guest on a refund. Section 3 explains what I did instead.

---

## How to run it yourself

```bash
npm run dev
```

```bash
node scripts/money-idempotency.mjs
```

A guest pays a £150 deposit and a £150 balance on a £300 stay. The balance is a
real test-mode PaymentIntent. The script then arranges for the same event to be
handled twice and prints what the booking and the ledger say. It puts everything
back afterwards.

---

# 1. Bug one: a balance payment counted twice

`app/api/stripe/webhook/route.ts`, the balance branch:

```js
amount_paid: Math.round((Number((booking && booking.amount_paid) || 0) + amount) * 100) / 100,
```

Adding is the **right sum**. The deposit is already in that column and the
balance goes on top of it. It is right exactly once, and nothing made it once.

# 2. Bug two: the ledger accepts the same payment twice

`payments` had no unique key on the payment intent. Checked directly rather
than assumed — the same row inserted twice with the service role:

```
first insert: OK
SECOND IDENTICAL INSERT: ACCEPTED -> payments has NO unique key on stripe_payment_intent_id
rows now: 2
```

## Both of them, on a real booking

The run, before any change:

```
SETUP — a booking with the deposit already paid
  stay total £300.00 — deposit £150.00 paid, £150.00 still to come

THE GUEST PAYS THE BALANCE — for real, at Stripe
  pi_3U9h4UPTBrEa7mS706W8c1Ce → succeeded  £150.00

FIRST DELIVERY — correct
  booking says the guest has paid: £300.00   (right answer: £300.00)
  PAYMENTS LEDGER after one delivery: 2 row(s)
    deposit succeeded  £150.00  pi_demo_deposit_…
    balance succeeded  £150.00  pi_3U9h4UPTBrEa7mS706W8c1Ce
    money in, per the ledger: £300.00

SECOND DELIVERY — the same event, the same payment
  PAYMENTS LEDGER after two deliveries: 3 row(s)
    deposit succeeded  £150.00  pi_demo_deposit_…
    balance succeeded  £150.00  pi_3U9h4UPTBrEa7mS706W8c1Ce
    balance succeeded  £150.00  pi_3U9h4UPTBrEa7mS706W8c1Ce
    money in, per the ledger: £450.00

WHAT IS NOW WRONG
  BUG 1 — one payment counted twice on the booking
    the guest really paid           £300.00
    the booking says they paid      £450.00
    → OVERSTATED BY £150.00

  BUG 2 — one payment counted twice in the ledger
    Stripe took                     £150.00 on pi_3U9h4UPTBrEa7mS706W8c1Ce
    the ledger counts               £450.00
    rows for that one payment intent: 2
    → DUPLICATED. There is no unique key stopping it.
```

**A £300 stay recorded as £450 paid.** Refunds are worked out from what was
paid, so an over-recorded booking refunds more than the guest ever gave you.
The host payout is netted off the same figure. Nothing looks broken — the
guest is happy and the stay is confirmed.

### How the second delivery was arranged, and why it is fair

The webhook records every event id in `stripe_events` before running the
handler and refuses a repeat, so normally a redelivery cannot reach the handler
at all. But **that insert can fail**, and when it does the code carries on and
handles the event anyway — which is the right call, and is now reported. From
that moment the dedupe is off for that event, and Stripe's own retry runs the
handler a second time.

The script reproduces exactly that: deliver, delete the `stripe_events` row —
which is the state you are in if the insert never wrote — then deliver the same
event again. Same event id, same payment, no invented scenario.

That hole is the one already written up in `WEBHOOK-FAILURE.md` section 4. It
is now reported when it happens. This job is about making it harmless when it
does.

---

# 3. The fix, and why it is not "set instead of add"

**Setting `amount_paid = amount` would be wrong.** On the booking above it
would record £150 for a stay the guest has paid £300 for. Refunds are
calculated from what was paid, so that version shortchanges the guest —
the same bug, pointing the other way, and the worse direction to be wrong in.

The question is not which arithmetic to use. It is **whether this payment has
already been counted**, and the only thing that can answer that for certain is
the database.

So: **write the ledger row first, and let the unique index answer.**

```js
const { error: balanceLedgerError } = await admin.from('payments').insert({ … });

// 23505 is not a failure here. It is the answer "this payment intent is
// already in the ledger".
const alreadyCounted = !!balanceLedgerError && balanceLedgerError.code === '23505';

const balancePatch = { payment_status: 'paid', balance_amount: 0, … };
if (!alreadyCounted) {
    balancePatch.amount_paid = round2(booking.amount_paid + amount);
}
```

Three things worth noticing:

- **The arithmetic is unchanged.** Adding is still right, and a deposit is
  still remembered. What changed is that it now happens once.
- **Everything safe to write again still is.** `payment_status` is `paid` and
  the outstanding balance is zero however many times the event arrives. Only
  the money is held back.
- **The index is the mechanism, not a safety net.** Which is why this needs
  the migration applied *before* the code ships. Without the index nothing ever
  conflicts, `alreadyCounted` is never true, and this quietly goes back to
  double-counting. There is a test that reads the migration file for exactly
  that reason.

## The migration

`supabase/migrations/20260829090000_payments_one_row_per_intent.sql`

```sql
create unique index if not exists payments_one_row_per_intent
    on public.payments (stripe_payment_intent_id, kind, status)
    where stripe_payment_intent_id is not null
      and kind <> 'refund';
```

**Refunds are deliberately excluded, and that is not a gap.** A booking can
genuinely be refunded more than once against one payment intent — a partial
refund on cancellation and another later, which
`app/api/bookings/cancel/route.ts` already handles by adding to
`alreadyRefunded`. A key covering refunds would refuse the second one and turn
a bookkeeping fix into a refund that does not happen. Money going out is left
alone. There is a test asserting the index still says `kind <> 'refund'`.

**NULLs are excluded** because the balance job claims an `attempting` row
before it has a payment intent to put on it.

**`status` is in the key** because a payment intent can legitimately appear as
`failed` and later as `succeeded`. What must never happen twice is the same
intent, same kind, same outcome.

### Before you run it on production

The pre-flight is in the file. It must return no rows:

```sql
select stripe_payment_intent_id, kind, status, count(*), sum(amount)
  from public.payments
 where stripe_payment_intent_id is not null
   and kind <> 'refund'
 group by 1, 2, 3
having count(*) > 1;
```

Anything it returns is a payment already double-counted in your live books.
**Do not delete rows to make the index build** — work out which booking is
wrong first. On the test project it returned nothing and the index built
cleanly.

**Order of operations:** migration first, then deploy. Same shape as the house
rule about widening a check constraint before adding a status value.

---

# 4. The fix, proved the same way

Same script, same real payment, after the change:

```
FIRST DELIVERY — correct
  booking says the guest has paid: £300.00   (right answer: £300.00)
  PAYMENTS LEDGER after one delivery: 2 row(s)
    deposit succeeded  £150.00
    balance succeeded  £150.00  pi_3U9h8MPTBrEa7mS71zuJGfZj

SECOND DELIVERY — the same event, the same payment
  webhook → HTTP 200 {"ok":true,"counted":false}
  PAYMENTS LEDGER after two deliveries: 2 row(s)
    deposit succeeded  £150.00
    balance succeeded  £150.00  pi_3U9h8MPTBrEa7mS71zuJGfZj
    money in, per the ledger: £300.00

BOTH BUGS ARE GONE
  BUG 1 — one payment counted twice on the booking
    the guest really paid           £300.00
    the booking says they paid      £300.00
    → CORRECT, after two deliveries of the same event

  BUG 2 — one payment counted twice in the ledger
    rows for that one payment intent: 1
    → ONE ROW. The unique index refused the second.
```

The response now carries `counted: false` on the repeat — the webhook saying
out loud that it recognised the payment and left the money alone.

---

# 5. One thing the unit tests missed

Worth writing down, because it is the argument for running these things against
a real server rather than trusting green tests.

With the tests passing, I delivered an ordinary **full** payment event twice
against the running site. The ledger correctly held one row — and
`/admin/errors` got an alarm saying *"a booking was confirmed but the payment is
missing from the payments ledger"*, about a payment that was right there.

Adding the index made a previously-impossible error code possible on every
insert path, and the reporting I added in the last job did not know that yet.
The tests were green because they only ever exercised a non-23505 failure.

Fixed, and there are now three tests on that path specifically. The end-to-end
check afterwards:

```
FULL-PAYMENT PATH, delivered twice:
  amount_paid: 300 (should be 300)
  ledger rows: 1
  new error_log rows: 0 (none — no false alarm)
```

A page of false alarms is a page nobody reads, which would have quietly undone
the whole point of the previous job.

---

# 6. What this does to the tests

**Before:** 739 passing (on `fix/webhook-reporting`).
**After:** 753 passing, 0 failing. Fourteen added, **none changed, none
removed.**

`tests/payment-idempotency.test.ts`:

- **Deposit plus balance comes to the whole stay** — the regression guard on
  "set instead of add". £150 + £150 must be £300, not £150.
- **The ledger row is written before the booking is updated**, and carries the
  payment intent id — without it the index cannot recognise a repeat.
- **A payment the ledger already holds does not move `amount_paid` again**, and
  `amount_paid` is not in the patch at all.
- **Everything safe to write again still is** — `payment_status` and
  `balance_amount` are still set on a repeat.
- **A duplicate is not reported as a failure**, on both the balance and the
  full-payment paths.
- **A ledger write that fails for any other reason is still reported**, and
  still records the money on the booking — the distinction between "already
  counted" and "genuinely failed" is the whole point of keying on 23505 rather
  than on "did the insert fail".
- **The response says whether the money was counted** (`counted: true` / `false`).
- **The migration exists**, and **still excludes refunds**. Both read the
  file. The first because the code is meaningless without the index; the second
  because tidying `kind <> 'refund'` out of it would break the second refund on
  a booking, which is the kind of change that looks like simplification.

---

# 7. What I have not done

**The other insert paths are untouched.** `bookings/cancel`, `bookings/host-refund`
and `stripe/refund` all write `kind: 'refund'`, which the index deliberately
does not cover, so nothing about refunds changes. `balance-charges` claims its
`attempting` row with a NULL payment intent and then updates it, so it is
outside the index too, and it already has its own idempotency through the
attempt row and a Stripe idempotency key.

**A redelivered full payment still refreshes `paid_at` and `confirmed_at`** to
the time of the redelivery. Harmless to the money and slightly untrue about the
clock. Not worth a money-path change on its own; worth knowing it is there.

**This does not make the handler safe to retry in general.** It makes the
balance path and the ledger safe. Whether to go further — delete the
`stripe_events` row on failure and let Stripe's own retry schedule do the
repair — is the bigger change described in `WEBHOOK-FAILURE.md` section 5, and
it should wait until the payment scenarios in `PAYMENT-SCENARIOS.md` are
scripted, so it can be proved rather than believed.

---

# 8. Files

| File | What |
|---|---|
| `supabase/migrations/20260829090000_payments_one_row_per_intent.sql` *(new)* | The unique index. Refunds and NULLs excluded, with the reasoning and a pre-flight. **Apply before deploying the code.** |
| `app/api/stripe/webhook/route.ts` | Balance branch: ledger row first, `23505` means already counted, money written once. Full-payment and failed-payment paths: `23505` no longer reported as a failure. |
| `scripts/money-idempotency.mjs` *(new)* | The demonstration. Goes through `scripts/target.cjs` like every other runner, so it cannot point at production. |
| `tests/payment-idempotency.test.ts` *(new)* | The fourteen tests above. |
