# The Stripe webhook: shown failing, then shown fixed

29 August 2026. Branch `fix/webhook-reporting`. Nothing merged, nothing
deployed, production untouched. Every run below is Stripe **test mode** against
the **test** Supabase project, checked by `scripts/target.cjs` before a single
request was made.

**Read this first: I did not do one of the things you asked for.** You asked to
see Stripe seeing a failure. It still sees a 200. I tried the retry and it does
not work, and if it were made to work it would be dangerous. The evidence is in
section 2, and you told me to say so and propose something else rather than
ship a retry loop over a partial write. That is what section 3 is.

---

## How to run it yourself

```bash
npm run dev
```

```bash
node scripts/webhook-fault.mjs --host http://localhost:3000
```

It creates a real test-mode PaymentIntent with a test card, so Stripe has
genuinely taken the money before the webhook is called. Then it sends an event
the handler cannot parse, and prints what happened to the booking, the payments
ledger, `/admin/errors` and Stripe. It puts the booking back afterwards, so it
can be run as often as you like.

There is no test-only code in the route to make this work — see section 6.

---

# 1. The failure, before any change

Two throws, at two different moments, on a booking a guest has genuinely paid
£300 for.

## 1a. It throws before anything is written

```
booking ba7241fe-8a42-4a7b-97af-9f3fb380968a
  before:  status=pending_payment  payment_status=unpaid  amount_paid=£0.00

  STRIPE: payment intent pi_3U9Zj2PTBrEa7mS71qvFLWlQ → succeeded  £300.00

  WHAT STRIPE SEES:  HTTP 200  {"ok":true}
    → Stripe marks this event DELIVERED and will not retry it.

  BOOKING AFTER:
    status=pending_payment  (was pending_payment)
    payment_status=unpaid  (was unpaid)
    amount_paid=£0.00  (was £0.00)
    → the guest has paid £300.00 and their booking is STILL PENDING_PAYMENT

  PAYMENTS LEDGER: 0 rows before, 0 after
    → nothing was written. The money is at Stripe and not in the ledger.

  /admin/errors — error_log rows written during this run: 0
    → NOTHING. Nobody is told. This is the whole point.
```

**Stripe has £300 of a guest's money. The booking says unpaid. The ledger is
empty. Stripe has been told everything is fine and will never send the event
again. Nothing anywhere alerts anybody.**

The guest is looking at a confirmation page that says "just confirming your
payment". It will say that for ever. You find out when they email you.

## 1b. It throws after the booking is confirmed, before the ledger row

The more insidious one, because it looks fine.

*(Recorded when this branch still had a fault-injection hook, which has since
been removed — see section 6. The script no longer reproduces this one. The
same half-done state is reached a different way in `MONEY-IDEMPOTENCY.md`.)*

```
  BOOKING AFTER:
    status=confirmed  (was pending_payment)
    payment_status=paid  (was unpaid)
    amount_paid=£300.00  (was £0.00)
    → the guest has paid £300.00 and their booking is CONFIRMED

  PAYMENTS LEDGER: 0 rows before, 0 after
    → nothing was written. The money is at Stripe and not in the ledger.

  /admin/errors — error_log rows written during this run: 0
    → NOTHING. Nobody is told.
```

The guest is happy. You are happy. The booking is confirmed and paid. But the
`payments` table — the ledger everything else counts from — has no row for that
£300. Nothing visible ever breaks. You find this at the year end, in the
accounts, when the money at Stripe does not match the money in the database,
and by then nobody can say which booking or which week.

---

# 2. The retry, before changing the return code

You asked me to think about this before touching it. The answer is that a retry
is wrong twice over, for two independent reasons.

## 2a. A 500 would not work at all

Look at the order of the route. The `stripe_events` row is inserted **before**
the `try` block that wraps every handler:

```js
const { error: eventInsertError } = await admin
    .from('stripe_events')
    .insert({ event_id: event.id, event_type: event.type, payload: event });

if (eventInsertError && eventInsertError.code === '23505') {
    return NextResponse.json({ ok: true, duplicate: true });
}

try {
    // ... every handler ...
```

So by the time a handler throws, the event is already recorded as seen. Stripe's
retry carries the **same event id**, hits that duplicate check, and is answered
`200 {"duplicate": true}` without the handler running at all.

Measured, in the same run:

```
  stripe_events row for evt_fault_beforewrite_…: PRESENT

  RETRY OF THE SAME EVENT: HTTP 200  {"ok":true,"duplicate":true}
    booking status after retry: pending_payment
    → refused as a duplicate. The handler did not run.
```

**Returning 500 would have made Stripe retry, and every retry would have been
thrown away by our own duplicate check.** The booking stays broken and you now
also have a red webhook in the Stripe dashboard telling you something is being
retried when nothing is.

Worth knowing separately: this also means **you cannot replay the event by hand
from the Stripe dashboard after fixing a bug.** "Resend" carries the same event
id and is refused the same way. To replay one you have to delete its
`stripe_events` row first. That is now written down, and the report tells you
the event id you would need.

## 2b. If that were fixed, the retry would not be safe

Suppose you deleted the `stripe_events` row on failure so a retry genuinely
re-ran the handler. Then the retry runs over whatever the first attempt already
did. Handler by handler:

| Handler | Safe to run twice? |
|---|---|
| `account.updated` | **Yes.** Absolute values written to `profiles`. Same input, same result. |
| `charge.dispute.*` (all four) | **Yes** for the record — it is an `upsert` on `stripe_dispute_id`. **But** the director alert email is sent again on every retry. |
| `payment_intent.payment_failed` | **Yes.** It checks for an existing failed row first. |
| `checkout.session.completed`, full/deposit | **No.** The booking update is idempotent, but the `payments` insert is not. |
| `checkout.session.completed`, **balance** | **No, and this is the bad one.** |

The balance branch:

```js
amount_paid: Math.round((Number((booking && booking.amount_paid) || 0) + amount) * 100) / 100,
```

It **adds** to `amount_paid` rather than setting it. Run it twice and a guest
who paid £150 is recorded as having paid £300. That flows into the payout to
the host and into what a refund would return.

And the ledger has nothing stopping duplicates. I checked rather than assumed —
inserted the same `payments` row twice with the service role:

```
first insert: OK
SECOND IDENTICAL INSERT: ACCEPTED -> payments has NO unique key on stripe_payment_intent_id
rows now: 2
```

So on the paths that matter, a retry over a partial write **double-counts
money**. That is worse than the failure it is trying to repair.

## 2c. So the fix is not a retry

The handler is right to return 200. What it was wrong about was the word
"logged" in its own comment: it wrote to `console.error`, which on Vercel is a
log line nobody reads. It never reached `/admin/errors` and never reached the
8am digest.

**A failure that cannot be retried is exactly the kind that most needs a human
told about it within minutes.**

---

# 3. The fix, and the same demonstration again

The top-level catch still returns 200. It now reports, with the booking id and
the Stripe event id in the detail — the booking id because that is the thing
that is now wrong, the event id because it is what you need to find the event in
Stripe and to clear the `stripe_events` row if you decide to replay it.

Same run, same forced throw, after the change:

```
  WHAT STRIPE SEES:  HTTP 200  {"ok":true}

  BOOKING AFTER:
    status=pending_payment
    → the guest has paid £300.00 and their booking is STILL PENDING_PAYMENT

  /admin/errors — error_log rows written during this run: 1
    2026-08-29T00:05:40  stripe/webhook  [webhook] handler threw on
    checkout.session.completed — the event is recorded as delivered and
    nothing was retried
```

The stored detail:

```json
{
  "event_id": "evt_fault_afterbookingupdate_1787961942772",
  "event_type": "checkout.session.completed",
  "message": "injected fault at after-booking-update (metadata.fault_stage)",
  "stack": "Error: injected fault at after-booking-update …",
  "booking_id": "ba7241fe-8a42-4a7b-97af-9f3fb380968a"
}
```

And it renders on the page. `/admin/errors`, fetched as an admin:

```
Errors — Anything that failed, whether or not the person it happened to told us.
Outstanding 54   In the last 24 hours 15

[webhook] handler threw on checkout.session.completed — the event is recorded
as delivered and nothing was retried    Server   stripe/webhook   29/08/2026, 01:07:40
```

The booking is still broken — nothing can un-break it automatically, and that
is the honest outcome. The difference is that you now know, in minutes, which
booking and which event.

Those rows are still in the test project's error log, deliberately, so you can
go and look at them. Clear them by pressing Resolve, or:

```bash
node -e "import('./scripts/seed-lib.mjs').then(async m=>{const e=m.loadEnv();const d=m.supabaseClient(e);await d.update('error_log','?path=eq.stripe%2Fwebhook&message=like.*handler%20threw*',{resolved:true});console.log('cleared')})"
```

---

# 4. The other handlers — you were right to ask

The top-level catch was not the only swallow, and the others are worse in one
specific way: **they never reached the catch at all.**

`supabase-js` does not throw when a write fails. It hands the error back in the
result object. So `await admin.from('x').update({...})` with the result thrown
away is a failure that touches nothing — not the catch, not the console, not
`/admin/errors`. Five of these, now all reported:

**`account.updated`** — the `profiles` update discarded its error entirely.
This row is how the site knows a host can be paid. If it fails, the host
finishes Stripe onboarding, Stripe is satisfied, and the payout job goes on
skipping them because our copy still says they are not set up. They chase you
about a payout that was never attempted.

**`checkout.session.completed`, the balance branch** — both the booking update
and the ledger insert discarded their errors. A guest pays their balance and
nothing records it.

**`checkout.session.completed`, the main ledger insert** — this is failure 1b
above. Booking confirmed, ledger empty, nothing visible wrong.

**`checkout.session.completed`, the oversold refund ledger insert** — the refund
goes back at Stripe and the `payments` row recording it may not be written.

**`payment_intent.payment_failed`** — the failed-payment row. The balance job
reads the most recent failed row back to decide how long a guest gets before the
booking is called off, so a failure here does not stop the ladder, it makes it
count from the wrong point.

**`stripe_events` itself** — any error other than a duplicate was discarded.
Carrying on is the right call, but with no row written the duplicate check
cannot fire, so a Stripe retry **will** run the handler a second time — and per
section 2b, the balance branch is not safe to run twice. That one now reports
loudly.

Two that were already right, and stay: the `charge.dispute.*` upsert checks its
error, and `alertDirectors` reports per address so one director getting the
email cannot make a bounce to the other look fine. Whoever wrote those had this
exact failure mode in mind.

**Not changed:** the inner catch around reading the PaymentIntent still swallows
the failure and carries on, because the comment is right — the guest has paid
and only the balance charge needs the card. But it now reports, because "not
fatal" is doing a lot of work in that sentence: without a saved card the whole
72/48/24 failure ladder is off for that booking, and the first anyone would know
is a guest who never paid. Now you can go and fix the card on file while there
is still a month to do it in.

---

# 5. What I'd do next, which is your call not mine

Two changes would make a retry genuinely safe, and together they would let you
replay a failed event instead of repairing it by hand. Both touch money and
both need a migration, so I have not done either.

**1. Make the payments ledger refuse duplicates.** A unique index on
`(stripe_payment_intent_id, kind, status)`. Then a second insert of the same
payment is a harmless conflict rather than a double count.

**2. Make the balance branch set rather than add.** Derive `amount_paid` by
summing the succeeded rows in the ledger for that booking, instead of adding to
whatever the column currently says. Same answer on the first delivery, and the
right answer on the second.

With those two, deleting the `stripe_events` row on failure and returning 500
would become a real option — and then Stripe's own retry schedule does the
repair for you. That is the version worth having. It is a bigger change than
tonight's, and it belongs with the payment scenarios in `PAYMENT-SCENARIOS.md`
being scripted, so you can prove it rather than believe it.

A third, smaller one: `stripe_events` has no column saying whether the handler
succeeded. Adding `handled_at` and `failed_at` would turn `/admin/errors` from
"you were told" into a queryable list of events that need replaying.

---

# 6. What this does to the tests

**Before:** 729 passing.
**After:** 739 passing, 0 failing. Ten added, **none changed, none removed.**

Nothing existing had to be edited, and that is worth saying plainly: no test
was asserting anything about what happens when the handler fails, because the
handler failing had no observable effect to assert on. That was the bug.

The new file is `tests/webhook-reporting.test.ts`. It forces a real throw by
stubbing the database, so it covers the same ground as the live demonstration
without needing the fault hook, a server or Stripe. What it pins:

- **A handler that throws while confirming a paid booking is reported** —
  exactly one report, not none and not a storm.
- **The report carries the booking id and the Stripe event id.** The booking
  because it is the thing now wrong; the event id because it is what you need
  to find it in Stripe and to clear the `stripe_events` row if you replay it.
- **Stripe is still answered 200.** This one exists so that changing it to a
  500 means arguing with a failing test rather than with a comment. The test's
  name says why: a retry cannot help and would not be safe.
- **A redelivery is refused before the handler runs.** The mechanism that makes
  a 500 pointless, pinned so it cannot be quietly removed and leave the comment
  above it lying.
- **Each of the quiet write failures** — the missing ledger row, the balance
  that could not be recorded, the host stuck as "cannot be paid", the event
  that could not be recorded.
- **A booking that confirms normally reports nothing at all.** A quiet success
  has to stay quiet, or the error page fills with noise and stops being read.

There was one existing test I broke and fixed properly rather than exempting:
`tests/runner-targets.test.ts` failed because `scripts/webhook-fault.mjs`
named a localhost URL of its own and did not import the target guard. That
guard exists because `journeys.mjs` once ran green for fifteen commits against
a merged branch, and my script writes rows *and* takes real payments, so it is
squarely the kind of runner it was written for. It now goes through
`resolveTarget()` like the others — which is why the run above prints
`checking what … actually is before writing to it` and refuses production, the
production database, and a stale build. The guard also scans comments, so the
usage example at the top of the file names `--host` rather than an address.
That is right: a stale URL in a comment is how the last one hid.

---

# 6. There is no test-only code in the route

An earlier version of this branch had an `injectedFault()` hook in
`app/api/stripe/webhook/route.ts` — inert unless the event carried a magic
field AND the Stripe key was `sk_test_`. It was well guarded. It is gone
anyway, at your call, and the reasoning is right: code sitting in the payment
path purely for testing is exactly what gets forgotten and then trusted.

`scripts/webhook-fault.mjs` now causes a **real** throw instead, the way real
ones are caused — an event whose shape the handler did not expect. `data` with
no `object` on it, so the handler reads `cs.metadata` off `undefined` and a
TypeError comes out of the same catch a dropped Supabase connection would.

One thing that costs, and it is worth knowing: a malformed event carries no
booking id, so its report says `booking_id: null`. A throw further in — the
ordinary case — names the booking. That is covered in
`tests/webhook-reporting.test.ts`, which stubs the database to throw on a
well-formed event and asserts the booking id is in the report.

The transcript in section 1b, where the booking is confirmed but the ledger
row is missing, was produced with the hook and is kept here as the record of
what was found. It cannot be reproduced by this script any more. The state it
shows — a handler that has done half its work — is the subject of the
follow-up job in `MONEY-IDEMPOTENCY.md`, which reproduces it a different way
and fixes the two bugs that make it dangerous.
