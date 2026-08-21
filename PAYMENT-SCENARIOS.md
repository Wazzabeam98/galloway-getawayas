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

Scenarios 12-24 — the refunds and the payouts — are scripted and passing
against the test project and Stripe test mode. Reseed between the two:

```
node scripts/seed-payments.mjs && node scripts/payout-scenarios.mjs
node scripts/seed-payments.mjs && node scripts/refund-scenarios.mjs
```

Scenarios 3 and 7-11, the automatic balance charge and its failure ladder:

```
node scripts/seed-payments.mjs && node scripts/balance-scenarios.mjs
```

Scenarios 1, 2, 4 and 5 were done by hand through a real Stripe Checkout page
in a browser, with `stripe listen` forwarding the webhooks. A Checkout Session
cannot be completed over the API, so there is no script for them.

Still open: **scenario 6**, the 3D Secure challenge at checkout. The challenge
is a cross-origin iframe driven by `use_stripe_sdk`, so it takes no synthetic
clicks and there is no redirect URL to open directly — it needs a person. What
was confirmed is that while the challenge is outstanding the booking stays
`pending_payment` and unpaid and the dates are not blocked, and that the
webhook path it finishes through is the same one scenarios 1, 2 and 4 all
proved works.

Scenarios 25-29, the cross-cutting cases:

```
node scripts/seed-payments.mjs && node scripts/crosscutting-scenarios.mjs
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
- A balance charge refused because the guest's bank wanted them to authenticate
  it was recorded and emailed as a decline. Stripe's own message for it opens
  'Your card was declined', so the guest was sent to check a card that was
  perfectly fine. The two are now told apart. (Scenario 11.)
- A booking paid in full ended with `balance_amount` null rather than zero, in
  both the checkout route and the webhook. (Scenario 2.)
- Two guests could both reach the payment page for the same nights and both
  pay. A booking at `pending_payment` was not counted as taking the dates —
  correctly, so an abandoned attempt cannot block a calendar for ever — but it
  did not hold them even for a moment. It now holds for 30 minutes, and only
  an *earlier* attempt holds, so of two guests arriving together exactly one
  gets through rather than neither. (Scenario 27.)
- The balance job and the `payment_intent.payment_failed` webhook both recorded
  the same failed charge, in different words. (Found while doing scenario 11.)

## Worth knowing

- There are two refund routes and they are not interchangeable.
  `/api/bookings/host-refund` is the partial one and takes an amount.
  `/api/stripe/refund` is the decline/cancel one: it ignores any amount passed
  to it and works the figure out itself from what was paid and the
  cancellation policy. That is correct for what it does, but passing it an
  amount and expecting a partial refund will silently refund everything.
- **A guest can still pay for dates taken while they were on the Stripe page.**
  The 30-minute hold closes the common race, but nothing re-checks
  availability when the webhook lands, so a guest who sits on the payment page
  for longer can still pay for nights someone else has since taken. Fixing it
  properly means either refunding at the webhook or a database-level exclusion
  on overlapping dates — both are real decisions rather than tidying, so they
  are left for a human.
- On the pay-in-full path the webhook stores `stripe_payment_method_id` even
  though the card was deliberately not saved for future use — checkout only
  sets `setup_future_usage` on the deposit path. Nothing charges it, because
  the balance job needs `payment_status = 'deposit_paid'`, but the column
  implies a reusable card that is not there.
- A host declining or cancelling is now closed off by `/api/stripe/refund`
  itself, in the same place the money moves. It used to be left to the browser
  in `BookingActions.tsx`, so a tab closed at the wrong moment left the guest
  refunded with the booking still reading as confirmed and the dates blocked.
  Accepting a request is still set from the browser, because no money moves.
