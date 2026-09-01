# Guest experiences: the marketplace, and a third booking shape

Design note. Nothing here is built. It answers: is the three-shape split right,
what a provider fills in for each, whether slots are instant, what happens when
two guests want the same slot, the guest journey per shape, how the cancellation
tiers fit each shape, and what the marketplace surface becomes. Written 2 Sep
2026, after the per-item photos/units work merged (#83, #86).

---

## 1. The split — yes, with one sharpening

Three shapes is right. They feel different to a guest and to a provider, and the
difference is real, not cosmetic:

| Shape | Example | Booking unit | Who moves | One-per-date? | Approved? |
|---|---|---|---|---|---|
| **Made for a date** | a cake, a hamper | a date (+ lead time) | provider makes & drops it | no — many a day | provider confirms |
| **Comes to you** | a chef, a masseur | a date | provider travels to the cottage | yes — can't be two places | provider confirms |
| **A slot** | a sauna, a walk, a tasting | a date **and a time**, with capacity | guest goes to it | capacity, not one | **instant** |

The sharpening: **the first two are the engine you already have.** "Made for a
date" and "comes to you" are both *request → provider confirms → capture*, and
they differ by exactly one thing we already model — `exclusive_per_date` (a chef
holds the date; a baker doesn't). The per-item menu, units, and the
request/hold/confirm money flow already serve both. So this is not three new
things. It is:

- **one existing engine** (request→confirm) serving made-for-a-date and
  comes-to-you, and
- **one genuinely new engine** (instant slots with capacity), which does not fit
  request→confirm at all.

That matters for the build: most of the work is the slot engine and the
marketplace wrapper, not re-doing what exists.

Where shape lives: **per provider, assigned by you at review**, the same place
the category, MCC and exclusivity already get set. A business is a sauna or a
baker; it does not switch row by row. The one mixed case — a chef who also runs a
cookery class (a slot) — is served by the rule you already set: one business per
account, so two identities is two accounts. That decision is what lets shape be a
clean per-provider attribute instead of a per-item tangle. `exclusive_per_date`
then folds into shape (comes-to-you ⇒ exclusive; made-for-a-date ⇒ not; slot ⇒
capacity governs it), so the boolean is retired in favour of the shape.

---

## 2. What a provider fills in, per shape

**Shared by all three:** business name, who they are (name, line, headshot),
description, service area, a cancellation policy (see §6), and a menu of items —
each with a photo, a name, a description, a price and a unit. That much is built.

**Made for a date** adds:
- **Lead time** — "how much notice do you need?" (e.g. 2 days). Gates which dates
  a guest can pick: no cake for tomorrow if she needs three days. This is the
  input that makes the *Made-to-order* cancellation tier honest — the cutoff and
  the lead time are the same fact.
- *(Optional, later)* a daily cap — "I can make up to 5 a day." Not v1; flagged.

**Comes to you** adds:
- Nothing structural beyond the shared set — it is the exclusive variant. Price
  is often per person. Time of day is arranged with the guest after confirming
  (the contact is released on confirm already), so the booking unit stays the
  date.

**A slot** adds the real new input — a **schedule**:
- Recurring weekly availability: which days, which times, how long each runs.
- **Capacity per session**, and its kind:
  - *per person* — a walk holds 8 people; a party of 3 takes 3 places; price is
    per person. Full when the people booked reach 8.
  - *whole slot (private)* — a private sauna hour is one booking whatever the
    party; price is for the slot. Full at one booking.
  (This is the unit model again: per-person vs flat, plus a capacity number.)
- Price and duration per session.
- *(Later)* block specific dates (holidays), and one-off dated sessions. v1 is
  the weekly template + block-a-date; that is enough for a sauna or a weekly
  tasting and keeps setup light.

Concrete sessions are generated from the template within a guest's stay window
for display; a real slot row is created the moment the first booking claims a
seat, so capacity has something to decrement (see §4).

---

## 3. Slots: instant, not confirmed

**Instant.** That is the whole point of the shape — a sauna owner publishes
availability and does not hand-approve the 2pm. The provider sets the schedule
once; guests self-serve into open sessions; **payment is taken immediately** on
booking (capture on book, not authorise-then-capture). The provider keeps the
power to cancel a booking or block a session, but there is no per-booking approve
step.

This splits the money flow by shape, cleanly:
- **Request shapes** (cake, chef): authorise on request (card held, manual
  capture), capture on confirm, release on decline/expiry. *Existing.*
- **Slot**: capture on book. Same destination charge, same `on_behalf_of`, same
  10% fee — just immediate, because the slot *is* the confirmation.

The guest-facing verb differs and should: **"Send request"** (held, awaits a yes)
for the request shapes — the wording just shipped in #86 — versus **"Book ·
£X"** (paid now, confirmed instantly) for a slot.

---

## 4. Two guests want the same slot

The crux of the shape, and it has to be race-safe, not hopeful.

**Capacity is an atomic counter, not a check-then-write.** A slot row carries
`capacity` and `seats_taken`, with a constraint `seats_taken <= capacity`. A
booking claims seats with a single conditional update:

```
update slot_sessions
   set seats_taken = seats_taken + :qty
 where id = :id and seats_taken + :qty <= capacity
```

Nought rows updated ⇒ the slot is full ⇒ refuse. Two simultaneous claims can
never oversell, because the update is atomic — the same principle as the chef
double-booking guard, generalised from "one" to "N". A whole-slot/private session
is just `capacity = 1`.

**Holding a seat across Stripe Checkout.** The guest leaves for Stripe to pay, and
the seat must not be sellable twice while they are there. Recommended:

1. On **Book**, claim the seat atomically (as above) into a short-lived
   **hold** (TTL ~15 min), before redirecting to Checkout.
2. If the claim fails, don't start Checkout — "that time just filled, pick
   another." No card touched.
3. The **webhook** on payment success turns the hold into a confirmed booking.
4. An **expiry sweep** (the mechanism the confirm-window already uses) releases
   abandoned holds — `seats_taken` comes back down, the seat reopens.

This never charges a guest for a seat they can't have. The simpler alternative —
let everyone check out, and refund the losers on the webhook (like the chef
race-loser release) — charges-then-refunds for a popular 2pm, which is a poor feel
and a refund fee you eat. **Decided: the hold, 15-minute TTL.** Charging someone
for a 2pm they can't have and refunding it is a bad first experience and costs
fees; the hold avoids both.

**Cancelling a slot booking releases the seat** — `seats_taken` decrements and the
time reopens for someone else. The made-for-a-date and comes-to-you shapes have no
seat to release; this is unique to slots and is why their cancellation reads
differently (§6).

---

## 5. The guest journey, and the marketplace

Today "Make more of your stay" is a section on the trips page. As the marketplace,
it becomes a browsable surface with room to breathe and a real listing page per
provider — photos, price, details — not an inline card doing everything.

**The surface:**
1. **Trip page → marketplace grid.** Providers near the cottage as cards: hero
   photo, name, category, a from-price, and a shape cue ("made to order" / "comes
   to you" / "book a time"). This is where the per-item photo finally earns its
   place — the card sells on the picture.
2. **Card → provider listing page.** A proper page: gallery, who they are, the
   full menu or the schedule, the cancellation policy in plain words *before* any
   commitment, and the booking action.
3. **Listing → booking → pay → back to the trip**, with the booking shown under
   "Your requests / Your bookings".

**The booking action, per shape:**
- **Made for a date:** pick item → quantity if per-unit → pick a date (≥ lead
  time, inside the stay) → **Send request** (held) → provider confirms → charged.
- **Comes to you:** pick item → party size if per-person → pick a date (inside the
  stay, not already taken) → **Send request** (held) → provider confirms →
  charged.
- **A slot:** see the sessions inside the stay (date · time · places left) → pick
  one → number of people if per-person (≤ places left) → **Book · £X** → pay now →
  confirmed instantly, seat reserved.

---

## 6. Cancellation tiers, per shape

The tiers proposed last time (Flexible / Standard / Made-to-order / Firm) hold —
but the **unit of the window** and what a cancellation *does* differ by shape, and
you're right that a no-show slot is not an uncollected cake.

**Made for a date** — window in **days before the date**. Free until N days
before (the *Made-to-order* tier's 3 days ≈ the baker's lead time); after that the
thing is being made, so it is the provider's discretion. A cake nobody collects
after it's baked: the provider keeps it, because they made it. The cutoff *is* the
lead time.

**Comes to you** — window in **days before the date**. Free until N before; after
that the chef has held the evening and turned away other work (the *Firm* / 7-day
tier exists for exactly this), so discretion. Same tiers as today.

**A slot** — window in **hours before the *time***, not days before a date, and
the seat is perishable. An early cancel is **free and reopens the seat** (it can
be resold — someone else takes the 2pm). A late cancel or a no-show means the seat
went empty and cannot be resold, so slots use **short** free windows — the
provider picks one of **24h / 12h / 4h** before — and a firmest that is still
**not** a wall: after the cutoff it is the provider's discretion with a path to
ask, not an automatic no-refund. That captured-with-no-path is the chargeback
source, and it is worse for a slot because the money is already taken (instant),
not merely held. A seat cancelled at 2 for a 3pm genuinely can't be resold — but
we still don't take money with no path. Policy shown at booking, window kept
short.

So: one policy model, two window units — **days-before-the-date** for the request
shapes, **hours-before-the-time** for slots — and only slots release capacity on
an early cancel. When I build cancellation, it should be built shape-aware from
the start rather than retrofitted, which is the reason it was worth holding.

---

## 7. What the slot provider sees — a diary, not an inbox

A sauna owner confirms nothing, so their dashboard is not the chef's "requests to
answer" inbox. There is nothing to approve; the booking already happened and the
money is already taken. What he needs is to know **who is coming and when**, at
the scale of fifteen a week rather than one cake — so his screen is a **diary**,
not a queue.

- **On each booking, an email** — "New booking: Sat 14 Sep, 2pm · 2 people · £40
  · [guest name]". That is what tells him someone's coming; he did not have to be
  watching a screen. Per-booking is right at this volume (each is a real
  customer, not noise); a daily-agenda digest is a later option if the volume
  climbs.
- **The dashboard is his week.** Upcoming sessions grouped by day — each row a
  time, the seats taken and left (`2pm · 4 of 6 · £40`), and the people booked
  into it with their contact. Today and this week first; past sessions collapse
  under an "earlier" fold. No accept/decline anywhere, because there is nothing to
  accept.
- **What he can do from it:** block a date or cancel a whole session (which
  refunds everyone booked and takes it off the grid), and cancel or refund a
  single booking. Those are the only actions — everything else already happened.
- **The payouts gate still stands** — he is not live to guests, and his sessions
  are not bookable, until payouts are set up, the same second gate the other
  shapes cross.

So there are two provider dashboards, by shape: the **inbox** (chef, baker —
requests to answer, then "coming up") that exists today, and the **diary** (slot —
a booked week to turn up to). The payouts gate, the property/contact release and
the earnings are shared; the middle is what differs.

## 8. What's new in the code (for when it's approved)

- **`shape` on the provider** (`made_to_order` | `comes_to_you` | `slot`),
  assigned at review beside category/MCC. `exclusive_per_date` folds into it.
- **`slot_sessions`** — provider, date, time, duration, capacity, capacity-kind
  (per-person / whole), price, `seats_taken`, with the `seats_taken <= capacity`
  constraint; plus a weekly **availability template** the sessions generate from,
  and a block-a-date list.
- **Slot holds + bookings** — a held claim across Checkout, converted on the
  webhook, released by the expiry sweep; capture-on-book rather than
  authorise-then-capture.
- **An instant-capture path** in the order route/webhook for slots, alongside the
  existing held-then-captured path for requests.
- **Marketplace surface** — a grid, and a provider **listing page** (new route),
  with the trips section linking into it rather than being it.
- **Cancellation** — a shape-aware window (days-before vs hours-before) and
  seat-release on slot cancels, snapshotted onto the booking like price already
  is.
- **Seed** — several fake businesses across all three shapes so the marketplace
  can be browsed and felt, which is the build you asked to end on.

## 9. Decided (2 Sep 2026)

1. **Slot contention:** the **seat-hold** across Checkout, 15-minute TTL — not
   charge-then-refund. Charging for a 2pm they can't have and refunding it is a
   bad first experience and costs fees.
2. **Slot schedule v1 stays small:** recurring **weekly opening hours**, a **slot
   length**, a **capacity**, and **block-a-date**. No per-date pricing, no
   seasonal variation, no exceptions beyond blocking a day. Complexity waits until
   someone asks.
3. **Slot cancel windows:** **24h / 12h / 4h** before the time, firmest is
   provider's discretion with a path — never a wall, even for a seat that can't be
   resold.
4. **Shape is per provider**, assigned at review beside category and MCC;
   `exclusive_per_date` folds into it. A provider mixing shapes uses two accounts.
5. **First cut is the whole thing** — grid, listing pages, photos, prices, all
   three booking flows, the slot diary dashboard, and fake businesses across all
   three shapes. Complete over partial: a marketplace can't be judged from a
   fragment.
