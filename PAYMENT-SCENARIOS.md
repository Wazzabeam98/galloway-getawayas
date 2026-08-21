# Payment scenarios to test

Every one of these also needs a final check that the database agrees with
Stripe afterwards. That is where nearly every real bug in this project has
been — not in the payment succeeding, but in the record of it afterwards.

Roughly eight of these have been tested by hand. The rest never have.

## Money in

1. Guest pays the 25% deposit at booking. Booking moves from
   `pending_payment` to `confirmed` when the webhook lands. `amount_paid` and
   `balance_amount` are both correct.
2. Guest pays in full at booking. `balance_amount` ends at zero, not null.
3. Balance charged automatically 30 days before check-in, off-session,
   against the saved card.
4. Guest pays the balance manually from the link in the reminder email.
5. Card declined at checkout. No booking is left stranded at
   `pending_payment` with the dates blocked.
6. Card requiring 3D Secure at checkout. Guest completes the challenge and
   the booking confirms.

## Balance charge failures

7. First attempt fails. Guest emailed, 72 hours given, booking untouched.
8. Second attempt fails. 48 hours.
9. Third attempt fails. 24 hours.
10. Fourth run cancels the booking and refunds whatever was paid, per the
    cancellation tier in force.
11. **Card requires authentication when charged off-session.** Untested, and
    in the UK this is probably commoner than an outright decline. The guest
    is not present, so the charge cannot complete without them — check what
    the code does with that, because it is not the same as a decline.

## Money out

12. Host declines a pending request. Guest refunded in full.
13. Host cancels a confirmed booking. Guest refunded in full, 5% fee
    recorded against the host, dates released.
14. Host issues a partial goodwill refund without cancelling. Booking stays
    confirmed, `payment_status` becomes `partially_refunded`, and the host
    still gets paid the remainder.
15. Guest cancels inside the free window. Full refund.
16. Guest cancels in the partial window. 50%.
17. Guest cancels in the non-refundable window. Nothing.
18. Guest cancels a booking where only the deposit has been paid. They get
    back what they actually paid, not the full price.
19. A refund is issued after the host has already been paid out. Clawback.

## Payouts

20. Transfer runs the day after check-in. Commission netted off at the rate
    stamped on the booking, not the listing's current rate.
21. Host has not finished Stripe onboarding. Skipped, not failed, and picked
    up on a later run.
22. Clawback succeeds from the host's Stripe balance.
23. **Clawback fails** because their balance is empty. The shortfall is
    recorded on `payout_balance_owed` and carried to the next payout.
24. The next payout is smaller than the debt. Withheld entirely, remaining
    balance carried forward again.

## Cross-cutting

25. Price changes between the guest loading the page and pressing pay. The
    booking is refused rather than charged at either figure.
26. Dates get taken on Airbnb while the guest is deciding. Refused at
    checkout from the cached iCal events.
27. Two guests book the same dates at the same moment.
28. The webhook arrives after the guest has already reached the confirmation
    page. The page must not show a booking as unconfirmed when the money has
    landed.
29. A webhook is delivered twice, or a scheduled job runs twice. Nothing is
    charged, refunded or paid out twice.

## Progress

Scenarios 19-24, the payouts, are scripted and passing against the test
project and Stripe test mode:

```
node scripts/seed-payments.mjs && node scripts/payout-scenarios.mjs
```

See `scripts/README.md`. Scenario 23 needed a fix before it could pass at all —
Stripe does not refuse a reversal the host cannot fund, it takes their account
negative and absorbs the difference out of the next transfer, so the money was
being recovered twice. The clawback now reverses only what the host is actually
holding and carries the rest on `payout_balance_owed`.

## Fixed

- ~~`host-payouts/route.ts` rounds `hostShare` and `commission` independently.~~
  `feeAmount` now derives from `netOfFee` by subtraction, so the two always sum
  to what was collected. Covered by `tests/money.test.ts`.
- ~~`host-payouts/route.ts` imports `logError` but never calls it, and discards
  the error from its first query.~~ A failed read now returns 500 and reaches
  /admin/errors. Covered by `tests/host-payouts.test.ts`.
- ~~`pricing.ts` tests `if (overrides[key])`, so a £0 override is ignored.~~
  Fixed; a zero override is honoured.
- The clawback keyed its idempotency on the booking id alone, so a second
  refund on one booking either replayed the first reversal or was rejected and
  billed to the host as a debt. It now carries the Stripe refund id.
- The clawback treated every Stripe error as a shortfall, turning a bad
  transfer id or an outage into money deducted from the host's next payout.
  Only `balance_insufficient` does that now.

## Still open

- `/api/stripe/refund` ignores the amount it is given and recalculates from the
  booking and the cancellation policy, so scenario 14 — a partial goodwill
  refund — is not possible through it.
