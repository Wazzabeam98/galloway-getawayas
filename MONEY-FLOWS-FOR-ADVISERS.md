# How money moves through Galloway Getaways — established from the code

Prepared for the solicitor and accountant. This describes what the code
actually does as of the `fix/money-check-clamp-and-lockdown` branch, 7 Sep 2026.
Every claim is tied to a file and line so it can be checked. It states what is
there; it does not offer a view on the tax treatment.

Galloway Getaways Ltd, company number SC899385.

All charges are in GBP. Stripe is still in **sandbox / test mode** — live mode
has not been switched on, and per the project notes no flow has yet run with
real money. The *structure* below is what the code builds; the caveat is only
that it has not yet been exercised live.

There is a single Stripe **platform** account. Hosts and guest-experience
providers each get their own Stripe **Express connected account**
(`type: 'express'`, `business_type: 'individual'`), created by the platform:
- host account: [app/api/stripe/connect/route.ts:57](app/api/stripe/connect/route.ts) — MCC `7011` (lodging), line 68
- provider account: [app/api/services/connect/route.ts:100](app/api/services/connect/route.ts) — MCC taken from the code the owner assigns at review, lines 100–131

---

## The one correction to flag up front

Your working description of **guest experiences** was "everything lands with us
and 90% goes out." **The code does the opposite.** A guest experience is a
charge **`on_behalf_of` the provider's connected account**, with settlement to
the provider (`transfer_data.destination`) and our 10% taken as an
**`application_fee_amount`**. The provider is the merchant of record; the money
never lands in our balance as gross — only our fee reaches us. Quoted in full
in flow 2 below.

The **cottage booking** flow is the one that matches "everything lands with us
and the share goes out": there we hold the full amount and pay the host by a
**separate transfer**.

So the two flows sit on opposite sides of the merchant-of-record line, and it
is entirely determined by four Stripe fields being present or absent.

---

## Flow 1 — Cottage bookings

**What happens:** Guest pays the platform. The platform holds the whole amount,
then pays the host a **separate transfer** the day after check-in, with our 10%
netted off. This is "separate charges and transfers" — **not** `on_behalf_of`,
**no** `transfer_data`, **no** `application_fee`.

**Who the guest pays / merchant of record:** The **platform**. The Checkout
Session is a plain platform charge — [app/api/stripe/checkout/route.ts:263](app/api/stripe/checkout/route.ts):

```ts
const checkout = await stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    customer_email: user.email,
    client_reference_id: booking.id,
    payment_method_types: methods,
    ...
    adaptive_pricing: { enabled: false },
    ...
    line_items: [ { quantity: 1, price_data: { currency: 'gbp',
        unit_amount: pence(dueNow),
        product_data: { name: (listing && listing.title) || 'Your stay', ... } } } ],
    payment_intent_data: {
        setup_future_usage: keepCard ? 'off_session' : undefined,
        description: 'Galloway Getaways booking ' + booking.id,
        metadata: { booking_id: booking.id, kind: useDeposit ? 'deposit' : 'full' },
    },
    ...
});
```

There is no `on_behalf_of`, no `transfer_data`, no `application_fee_amount`, and
no `Stripe-Account` header anywhere in this call. It is a straight charge to the
platform account. The comprehensive sweep of the codebase confirms cottage
bookings never use any of those fields (see "Sweep" at the end).

**Whose name is on the receipt / card statement:** The platform's. Because this
is an ordinary platform charge with no connected account and no
`statement_descriptor` set anywhere in the code, the cardholder sees the
platform's Stripe account name (Galloway Getaways). The line-item name the guest
sees is the **listing title** ("Your stay"), and the payment description is
`"Galloway Getaways booking <id>"` (line 313).

**How our cut is taken:** As a **deduction on a separate transfer out**, not an
application fee. The payout cron computes the host's share and transfers it,
keeping the commission by simply not transferring it —
[app/api/cron/host-payouts/route.ts:259](app/api/cron/host-payouts/route.ts):

```ts
const hostShare = netOfFee(collected, rate);
const commission = feeAmount(collected, rate);
...
const toSendPence = Math.round(toSend * 100);
const source = await sourceChargeFor(booking, toSendPence);
const transfer = await stripeRequest('POST', '/transfers', {
    amount: toSendPence,
    currency: 'gbp',
    destination: host.stripe_account_id,
    transfer_group: 'booking_' + booking.id,
    source_transaction: source || undefined,
    ...
});
```

The commission rate is 10% by default ([lib/fees.ts:8](lib/fees.ts),
`DEFAULT_COMMISSION_PERCENT = 10`), stamped onto the booking at checkout so a
later listing change doesn't rewrite history
([app/api/stripe/checkout/route.ts:344](app/api/stripe/checkout/route.ts),
`commission_rate: rateFor(listing)`). "Only what was actually collected and kept
is shared out, never the headline price" (host-payouts line 249).

**When the money hits our balance / when it leaves:**
- Hits the platform balance when the guest pays (deposit or full at booking;
  balance charged automatically 30 days before check-in off-session —
  [app/api/cron/balance-charges/route.ts:337](app/api/cron/balance-charges/route.ts),
  also a platform charge with no `on_behalf_of`).
- Leaves the platform balance the **day after check-in** via the transfer above
  (`cutoffDate = shiftDayKey(londonDayKey(), -1)`, host-payouts line 74). The
  transfer names the original charge as `source_transaction` so it can draw on
  card money that has not yet settled (lines 268–289).

**Do we ever hold the full amount?** **Yes.** Between the guest paying and the
day-after-check-in payout, the platform holds the entire booking value in its
own balance. Refunds and cancellations are issued from the platform balance
too, and a refund that lands after a payout is clawed back from the host (the
`payout_balance_owed` deduction logic, host-payouts lines 263–265, 362 onward).

> Note: the host's Express account is created with `card_payments` requested
> ([app/api/stripe/connect/route.ts:63](app/api/stripe/connect/route.ts)), but
> the cottage flow never charges on the host's account — it only transfers to
> it. That capability is unused by the built cottage flow.

---

## Flow 2 — Guest experiences (chefs, saunas, cakes, etc.)

**What happens:** Guest pays **the provider**, through us, as a charge
`on_behalf_of` the provider's connected account. We take **10% as an application
fee**. We never hold the gross — settlement goes to the provider and only our
fee reaches our balance. There are two sub-shapes (request-to-confirm, and
instant "slot"), identical on the merchant-of-record question.

**Who the guest pays / merchant of record:** The **provider**. This is stated in
the route's own header comment and then in the four Stripe fields —
[app/api/services/order/route.ts:24](app/api/services/order/route.ts):

```ts
// THE PROVIDER IS THE MERCHANT OF RECORD. The charge is on_behalf_of the
// provider's own connected account, settled to it (transfer_data.destination),
// and our 10% is an application fee — not a markup. The guest is paying the
// provider; we are the platform taking payment for them.
```

The call itself, [app/api/services/order/route.ts:202](app/api/services/order/route.ts):

```ts
payment_intent_data: {
    capture_method: 'manual',
    on_behalf_of: provider.stripe_account_id,
    application_fee_amount: pricing.applicationFeePence,
    transfer_data: { destination: provider.stripe_account_id },
    description: 'Galloway experience — ' + business + ' · ' + itemName,
    metadata: { kind: 'service_order', provider_id: provider.id, booking_id: booking.id },
},
```

The instant "slot" shape is the same on money —
[app/api/services/slots/book/route.ts:233](app/api/services/slots/book/route.ts):

```ts
payment_intent_data: {
    on_behalf_of: provider.stripe_account_id,
    application_fee_amount: pricing.applicationFeePence,
    transfer_data: { destination: provider.stripe_account_id },
    ...
},
```

**Whose name is on the receipt / card statement:** The **provider's**. With
`on_behalf_of` set, Stripe treats the connected account as the settlement
merchant, so the statement descriptor the cardholder sees is the provider's, not
ours. The code also tells the guest this explicitly on the Checkout line-item
description — [app/api/services/order/route.ts:196](app/api/services/order/route.ts)
and [slots/book/route.ts:227](app/api/services/slots/book/route.ts):

```ts
description: 'Booked with ' + business
    + '. Galloway Getaways takes the payment on their behalf and is not the provider.',
```

So the guest is told **before paying** who they are buying from.

**How our cut is taken:** As an **`application_fee_amount`** on the provider's
charge — 10% by default. [lib/serviceOrders.ts:208](lib/serviceOrders.ts):

```ts
const price = serviceCeiling(ceilingInput, catalogue);
const commissionRate = commissionRateFor(provider);
const commission = serviceCommission(price, commissionRate);
const net = Math.round((price - commission) * 100) / 100;
return { price, commissionRate, commission, net,
    amountPence: pence(price),
    applicationFeePence: pence(price) - pence(net) };
```

Default rate is 10% (`0.10`), and a guest trade is always commission, never
subscription — [lib/serviceProviders.ts:316](lib/serviceProviders.ts):

```ts
// The one guest trade — always commission (10% on the sale), never a
// subscription. A guest experience bills nothing until a guest buys.
guest: 'commission',
```

**When the money hits our balance / when it leaves:** Our **fee** lands in the
platform balance when the charge is **captured**; the rest never sits with us —
it settles to the provider. Timing of capture differs by shape:
- **Request shape:** card is **held, not charged** at request
  (`capture_method: 'manual'`), and captured only when the provider confirms —
  [app/api/services/orders/respond/route.ts:183](app/api/services/orders/respond/route.ts)
  (`/payment_intents/<id>/capture`). Decline or no answer → the hold is
  cancelled and nothing moves (respond line 205).
- **Slot shape:** captured automatically on payment (instant); the seat is the
  confirmation ([slots/book/route.ts:232](app/api/services/slots/book/route.ts)).

Refunds reverse both the transfer and our fee —
[app/api/services/orders/respond/route.ts:139](app/api/services/orders/respond/route.ts)
and [orders/cancel/route.ts:107](app/api/services/orders/cancel/route.ts):

```ts
{ payment_intent: order.stripe_payment_intent_id,
  refund_application_fee: 'true', reverse_transfer: 'true' }
```

**Do we ever hold the full amount?** **No.** Under `on_behalf_of` +
`transfer_data.destination`, the gross settles to the provider and only the
application fee is ours. We never hold the provider's 90%.

---

## Flow 3 — Tradesman jobs (plumber, electrician, cleaner, etc.)

**What happens:** **No money moves through the platform at all.** This is a
lead-introduction flow. The guest/host and the tradesman are connected; the job
is quoted and paid **off-platform, directly between them**. We are not in the
payment.

This is stated as the defining property of the flow —
[lib/serviceEnquiries.ts:8](lib/serviceEnquiries.ts):

```ts
// THERE IS NO MONEY IN HERE, AND THAT IS THE POINT
//
// Every trade that reaches this flow is on the subscription. The platform
// takes nothing per job, the work is paid off-platform, and so there is no
// total, no commission, no charge at acceptance and no refund. What the
// platform sells is the introduction.
```

The enquiry carries a **price snapshot** — the tradesman's own quoted band
price, shown to the host up front — but it is only a number on the record;
nothing charges it ([app/api/services/enquiries/route.ts:235](app/api/services/enquiries/route.ts),
`price_snapshot: ...`). On acceptance, contact details are exchanged and that is
the whole transaction on our side
([app/api/services/enquiries/respond/route.ts:119](app/api/services/enquiries/respond/route.ts)).

The Connect route confirms the intent: "a subscription trade never receives
money through us" — [app/api/services/connect/route.ts:11](app/api/services/connect/route.ts).

**Merchant of record / receipt / statement:** Not applicable to the platform —
we are not the merchant on the job. The tradesman invoices and is paid directly.

**Our revenue from this flow:** the £20/month subscription (flow 4), not a
per-job cut.

**Do we ever hold the amount?** **No — we never touch it.**

> **⚠ Flag for the accountant — a design-vs-built inconsistency.**
> Two host trades are classed as **`commission`** rather than subscription —
> `sponge` (cleaning) and `bin` (waste) —
> [lib/serviceProviders.ts:313](lib/serviceProviders.ts). The provider-facing
> terms text for a commission trade says: *"We take 10% of a job when you accept
> one through the site"* —
> [lib/serviceProviders.ts:411](lib/serviceProviders.ts) (`planTerms`).
> **But there is no built route that charges that 10%.** The only enquiry flow
> (`service_enquiries`) explicitly takes no money (quoted above), and the only
> per-job charging that exists is the guest-experience "booking" shape (flow 2),
> which is for the `guest` trade. So for cleaning and waste, the platform
> **promises a 10% commission it has no mechanism to collect**. The enquiry
> library's own comment anticipates this: *"If a trade that pays commission is
> ever pointed at this file … it means that trade wants a booking instead"*
> ([lib/serviceEnquiries.ts:13](lib/serviceEnquiries.ts)) — i.e. the commission
> collection for those trades was designed to be a booking-shaped charge that
> has not been built. Worth confirming whether cleaning/waste are in scope for
> the soft launch; if they are, the money side of them does not exist yet.

---

## Flow 4 — The £20/month tradesman subscription

**What happens:** The tradesman pays **the platform** £20/month via **Stripe
Billing** (a subscription on the platform account). This is a straight platform
charge — **no** `on_behalf_of`, **no** connected account. We keep the whole £20.

**Who the tradesman pays / merchant of record:** The **platform**. A
`mode: 'subscription'` Checkout with the price on the platform account —
[app/api/services/billing/route.ts:118](app/api/services/billing/route.ts):

```ts
const session = await stripeRequest('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: provider.stripe_customer_id || undefined,
    customer_email: provider.stripe_customer_id ? undefined : (provider.contact_email || undefined),
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
        trial_end: trialEnd,
        metadata: { kind: 'provider_subscription', provider_id: provider.id },
    },
    metadata: { kind: 'provider_subscription', provider_id: provider.id },
    ...
});
```

`priceId` is `process.env.STRIPE_SUBSCRIPTION_PRICE_ID` (billing line 51; env key
present in [.env.example:71](.env.example)). There is no connected account on
this call, so the merchant of record is the platform.

**Whose name is on the receipt / card statement:** The platform's (ordinary
platform subscription charge; no `statement_descriptor` set in code).

**How our cut is taken:** There is no "cut" — the whole £20 is our revenue. The
amount is `SUBSCRIPTION_MONTHLY = 20`, stated once —
[lib/serviceProviders.ts:338](lib/serviceProviders.ts). Billing, retries,
dunning and card-expiry are handled by Stripe Billing (billing route comment,
lines 27–33). The trial is honoured from the tradesman's existing
`trial_ends_at`, not restarted (lines 100–116).

**When the money hits our balance / when it leaves:** Hits the platform balance
each month when Stripe Billing charges the subscription (first charge at
`trial_end`). It does not leave — it is ours.

**Do we ever hold the full amount?** It **is** the full amount and it is ours;
there is nobody to pass it on to.

---

## Agent vs principal — on the face of the code

Read strictly from what the code does (this is a factual summary for the
adviser, not a legal conclusion):

| | Cottage bookings | Guest experiences | Tradesman jobs | Subscription |
|---|---|---|---|---|
| Who sets the price | The **host** sets the listing price; platform computes the total in `lib/pricing.ts` and takes 10% | The **provider** sets the item price; platform takes 10% | The **tradesman** quotes | Platform (£20) |
| Commission or markup | **Commission** (10% netted off a separate transfer) | **Commission** (10% application fee; guest pays exactly the provider's price) | None per job | N/A — it's our own fee |
| Merchant of record (Stripe) | **Platform** | **Provider** (`on_behalf_of`) | Neither (off-platform) | **Platform** |
| Does the customer know who they're buying from before paying? | Sees the **listing/host's property**; charge is by the platform | **Yes — explicitly told** "Booked with \<provider\>… Galloway Getaways… is not the provider" | Yes — it's a named tradesman | Yes — it's us |
| Whose name on receipt/statement | **Platform** | **Provider** | N/A | **Platform** |
| Do we hold the gross? | **Yes**, until day-after-checkin payout | **No** — only our fee | **No** — never touch it | It's ours |

**Where the structure points the "wrong way" for a commission-only VAT
position** (flagged, not concluded):

1. **Cottage bookings are the one place we take the full gross into our own
   balance and act as the Stripe merchant of record.** The guest is charged by
   the platform, the platform holds 100% of the booking value, and the host is
   paid by a discretionary-looking separate transfer with our commission removed.
   On the face of the money movement this is the flow that most looks like the
   platform transacting for the whole value rather than only its 10%. Guest
   experiences, by contrast, are already structured as agent-style (provider is
   merchant of record, we only ever receive our fee). If the aim is to be seen
   as agent on the commission across the board, cottage bookings are the flow
   whose current build cuts against that and guest experiences are the flow that
   supports it.

2. **No customer-facing "agent" statement on cottage bookings.** Guest
   experiences carry an explicit on-screen line that Galloway "takes the payment
   on their behalf and is not the provider"
   ([services/order/route.ts:196](app/api/services/order/route.ts)). Cottage
   checkout has no equivalent line — the guest simply pays "Your stay" to the
   platform.

3. **The cleaning/waste commission is promised but not built** (flag in flow 3)
   — a 10%-per-job commission with no collection mechanism.

---

## VAT registration status

- **No VAT registration number is stored anywhere in the repository or in the
  Stripe configuration that is visible from the code.** A search for a UK VAT
  number pattern (`GB` + 9 digits), "VAT no/number/registered for VAT", and tax
  identifiers returns nothing in code, config, `.env.example`, SQL, or the
  customer-facing pages. The only company identifier present is the company
  number **SC899385** (e.g. [lib/email.ts:160](lib/email.ts),
  [app/terms/page.tsx:20](app/terms/page.tsx)).
- **No VAT is charged or calculated in any flow.** No `automatic_tax`,
  `tax_behavior`, `tax_rates`, or `tax_id` field appears in any Stripe call.
  Prices are treated as final GBP amounts throughout.
- The only written statement about VAT is in a **scope/planning document, not
  code**: `SUBSCRIPTION-SCOPE.md` says *"No VAT. Nowhere near the threshold, so
  £20 is £20"* ([SUBSCRIPTION-SCOPE.md:17](SUBSCRIPTION-SCOPE.md)) — this is an
  assertion about the subscription only, and it is a note about intent, not a
  registration record. `CLAUDE.md:48` records the VAT threshold and
  agent/principal question as an open item for the solicitor.

So: **as far as the code and repo config show, the company is not VAT-registered
and nothing in the platform accounts for VAT.** If a registration exists, it
lives only inside the Stripe Dashboard / company records, which are not in this
repository and I cannot see them from here.

---

## Sweep — every money-movement construct in the code

To make sure nothing is missed, here is the full census of the Stripe fields
that determine merchant-of-record and money movement:

- **`on_behalf_of`** — only in guest experiences:
  [services/order/route.ts:206](app/api/services/order/route.ts),
  [slots/book/route.ts:234](app/api/services/slots/book/route.ts).
- **`transfer_data`** — only in guest experiences (same two files).
- **`application_fee_amount`** — only in guest experiences (same two files);
  `refund_application_fee`/`reverse_transfer` only in their refund paths.
- **Separate `/transfers`** — only cottage host payouts:
  [cron/host-payouts/route.ts:293](app/api/cron/host-payouts/route.ts).
- **`mode: 'payment'`** (platform charges) — cottage checkout, cottage balance
  checkout, and the two guest-experience checkouts.
- **`mode: 'subscription'`** — only the tradesman subscription:
  [services/billing/route.ts:119](app/api/services/billing/route.ts).
- **Off-session platform charge** (cottage balance) —
  [cron/balance-charges/route.ts:337](app/api/cron/balance-charges/route.ts),
  no `on_behalf_of`/`transfer_data`/`application_fee`.
- **No `statement_descriptor`** is set anywhere in the code, in any flow.

This is the complete set; there is no fifth money path hidden elsewhere.
