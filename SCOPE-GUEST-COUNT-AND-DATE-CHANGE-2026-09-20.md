# Scope: experience guest-count change & date/time change

**Date:** 2026-09-20
**Status:** scope only — nothing in here is built. Written to survive the
session it was scoped in.

Both are amendments to an existing experience/service booking (`service_order`).
Both are money paths, not page work: a guest-count change can take another
payment, and a date change releases one slot and claims another. Everything
that touches a total goes through `lib/pricing.ts`; any actual charge is against
the **provider**, who is the merchant of record for experiences.

---

## 1. What Airbnb does (walked live, 2026-09-20)

Walked on a real confirmed experience reservation (per-person yoga class,
Chiang Mai, £6.75, code `TAMDAXKX`) in Chrome, stopping before paying or moving
anything.

### Add guests (their paid flow, control labelled "Change guest count")

1. **"Add guests" dialog:**
   - Live capacity line: *"Your host [operator] has 9 spots left."* — the name
     shown is the operator who holds the seats, not the listing's front host.
   - An **Adults / Age 13+** stepper (– / +). Stepping 1 → 2 dropped the
     spots-left line **9 → 8 live**.
   - A **"Legal guardian confirmation"** checkbox (for minor tiers).
   - **"Continue to payment"**.
2. **"Confirm and pay":**
   - Free-cancellation line (*full refund if cancelled before the window*).
   - A **"Guest change"** diff: **2 adults ← 1 adult**.
   - **Price details: Price adjustment £6.75 · Taxes £0.00 · Total £6.75** —
     only the *delta* for the added place, on the same reservation, reusing the
     card on file. No re-entry of card details.

### Change date or time

1. **"Select a new date or time"** calendar. Caption: *"Your price may vary
   depending on the date you select."* Only bookable dates are selectable.
2. Pick a date → **available time slots** for that date appear → select one.
3. **Confirm step, titled "Refund details":**
   - *"We'll send the refund to your original payment method."*
   - **Payment method: Mastercard ••••3174.**
   - **Price details: Price adjustment £0.00 · Total £0.00** (£0 for a
     same-price date; a dearer date charges the difference, a cheaper one
     refunds it — the heading flips to a refund).
   - **"Change reservation"** commit button + an "Updated reservation" summary.

**What they leave out:** the date change is framed to the guest purely as a
*price adjustment*. The guest never sees the old slot being released, and the
cancellation-policy dependency is implicit, not spelled out on screen.

---

## 2. Guest-count change

### It forks on the item's pricing unit

- **Per-person items — this is the only place "add guests" exists.** Each guest
  is a separately paid seat. Adding one is a **delta charge**:
  `price(newCount) − price(oldCount)` computed **only in `lib/pricing.ts`**
  (never `unit × added` — that misses per-guest tiers and fees). It consumes a
  seat against the session's capacity. This mirrors Airbnb's
  "Add guests → Price adjustment" checkout.

- **Private hire (flat) and comes-to-you — no guest-count feature at all.**
  The whole session / the provider's visit is bought outright. There is **no
  stepper, no free "4 → 5", no notification path**. If the party grows, the
  **guest and provider settle it between themselves over message**, off-platform.
  Nothing is scoped here; a free headcount update was considered and dropped.

### Delta-charge flow mechanics (per-person only)

- **Same order, new charge.** Record the top-up as a **new line / amendment
  against the same `service_order`** with its own charge — do not mutate the
  original row's total. This keeps payout and any later refund per-charge and
  auditable.
- **Seat hold at checkout.** The dialog's "spots left" is decoration. Take a
  **short-lived seat hold** at "continue to payment" (a hold row with an
  expiry), re-verify remaining capacity **inside the transaction that records
  the charge**, confirm the seat on the Stripe webhook, release on
  timeout/abandon. This is what survives the "slot gone by the time they pay"
  race — two guests adding at once can't both take the last seat.
- **Order of operations.** Move the money before flipping any booking state
  (house rule). Provider is merchant of record; commission is netted and
  payout/clawback treat the top-up as part of the same order.

---

## 3. Date/time change

- **One flow, price-adjustment framed** (as Airbnb): charge if dearer, refund
  if cheaper, £0 if the same. The guest never sees the old slot released.
- **Atomic slot swap.** Underneath, release-of-old-seat and claim-of-new-seat
  happen in **one transaction**, not two visible steps and not two DB steps. If
  the new claim fails, nothing releases and the guest stays on the original
  slot.
- **Same race guard as add-guests.** Hold the new seat at the confirm step and
  re-verify the new session's capacity inside the commit transaction; on
  failure, keep the guest where they are with a clean "that time just went"
  message.

### Refund position depends on the provider's cancellation window

- **Inside the free-cancel window:** a pure price delta (charge or refund),
  like Airbnb's £0/refund screen.
- **Outside the window:** a date move is economically a **cancel + rebook**, so
  the existing **tiered-refund logic must be reused** for whatever isn't carried
  across to the new slot — do not invent a second refund path. If a payout for
  the old slot is imminent or already sent, the move must reschedule or **claw
  back** through the existing payout engine.
- Co-travellers ride along to the new slot (they're on the order, not the slot),
  but **block the move if the new slot's capacity is smaller than the current
  headcount**. The seat release/claim must propagate through the two-way iCal
  sync so the provider's external calendars update both slots.

---

## 4. Invite list (unchanged)

- **Private hire:** the list runs **to capacity**, no money involved.
- **Per-person:** the list is **locked to seats paid for** — adding someone
  beyond that count routes through the paid delta path, it is not a free invite.

---

## 5. Accepted v1 consequence: stale attendee count

Because private-hire / comes-to-you party growth happens over message, the
order's **stored `attendees` stays at the number originally booked** and won't
reflect a grown party. **Accepted for v1.** The booked number surfaces at four
render sites (all `service_order`; the cottage-stay party count is a separate
`booking` record and is not affected):

**Guest-facing**
- `app/experiences/order/[orderId]/page.tsx:232` — "Party" row:
  *"{order.attendees} people — the whole session is yours."* (private slot, >1).

**Provider dashboard**
- `components/services/ProviderExperienceDashboard.tsx:183` and `:238` —
  booking rows append *"· N guests"*.
- `components/services/ProviderSlotDashboard.tsx:242` — slot rows render
  *"· party of {attendees}"* when attendees > 1.

Gate to know: `components/marketplace/present.ts:143` — `partyMatters(shape)`
decides whether the headcount shows at all. Where it excludes comes-to-you, the
staleness is invisible (nothing rendered); the visible-and-stale case is chiefly
the private-hire guest line and the private-hire provider rows.

---

## 6. Explicitly NOT being built

- No guest-count change for private hire or comes-to-you (party growth is
  off-platform message).
- No syncing of the stored attendee count to a party that grew over message —
  the stale count is accepted for v1.
- No second/rebuilt refund path for date changes — reuse the tiered-refund and
  payout/clawback engines.
- No pricing outside `lib/pricing.ts`.
- Nothing in this document is implemented; this is scope only.
