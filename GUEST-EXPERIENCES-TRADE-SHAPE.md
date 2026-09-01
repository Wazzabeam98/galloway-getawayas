# Guest experiences: one shape, or several?

A design note, not a decision. The money spine that all guest trades share is
right and should stay shared. The *order* — its fields, its language, its
rules — was built for a chef and fits the rest awkwardly. This maps where the
two diverge and how far you might split them, so you can decide with the whole
picture rather than a message.

Prompted by seeding a baker and looking at it as a real person: it's the same
screen as a chef with one word swapped, and in one place (now fixed) that was
an actual bug.

---

## What's shared — and should stay shared

The money spine: **request → hold → confirm → capture → 10% fee → refund /
expiry**. A cake, a hamper and a chef's dinner all move money the same way — the
guest's card is held, captured only when the provider confirms, our cut is a fee
not a markup, and a cancellation refunds under the same rule. This is
trade-agnostic and proven end to end. **Don't split it.** Whatever else changes,
one payment flow serves every guest trade.

## What's chef-shaped

The order model. `ProviderExperienceDashboard` never branches on trade, and the
order carries a chef's assumptions:

| Dimension | Chef | Baker (cake) | Hamper (basket) |
|---|---|---|---|
| What the date means | an **evening they attend** | a **deadline** to have it ready | a **delivery date**, often before arrival |
| `guests` | cook for how many — **needed** | irrelevant (a cake has a *size*, not a headcount) | maybe (a hamper for a party of six) |
| One per date | one evening — **exclusive** | many cakes for one Saturday | many hampers for one day |
| Fulfilment | comes **into the cottage** | **delivered or collected** | **delivered** |
| What the order needs to capture | party size, dietary, the evening | item, size, message, collect-or-deliver, by when | contents, delivery slot |
| What the profile leans on | **the person** (who's coming into my home) | **the work** (the cake) | **the goods** |

The dashboard word ("Cakes & baking" vs "Private chef") is the *only* per-trade
difference in the whole flow today. Everything else — "£45 · 2 guests · 21 Sep",
"Coming up", one-per-date — reads as a chef's evening applied to a cake.

### The one already fixed

**Exclusivity is now a chef rule.** The one-live-order-per-provider-per-date
guard used to apply to every trade; for a baker it rejected her second order for
a taken date and quietly lost it. It's now scoped to `trade = 'chef'`
(`exclusivePerDate()` in `lib/serviceOrders.ts`, migration
`20260901160000`, applied to test and production). A chef stays exclusive per
evening; a baker takes as many as she can bake.

## The one that's missing entirely: talking to each other

**An order has no message thread at all** — I only noticed by asking to see one.
The `messages` table carries a `booking_id` *or* an `enquiry_id` and **no
`order_id`** (a hard constraint). So a plumber's accepted *enquiry* has a thread
(`/messages/enquiry/[id]`); a chef's or baker's confirmed *order* has the Call /
Email buttons added recently and nothing else.

A chef coming into a cottage and a guest with a nut allergy have things to say —
*"can you do gluten-free?"*, *"the kitchen has no oven"*, *"leave the cake with
the neighbour, we're out till six"*. Right now that's a phone call or nothing,
and nothing is recorded. This is **not** a chef-vs-baker split — it's a hole in
the order model for every guest trade, and the one most likely to be felt on the
very first real booking.

Where a thread would live, roughly:

- **Add `order_id` as a third target** on `messages` (the `booking_id` XOR
  `enquiry_id` constraint becomes a three-way "exactly one of"). Cleanest home;
  a schema change and a thread UI reused from the enquiry side.
- **Reuse the guest's booking thread** — no: that thread is guest↔host, and the
  provider is neither the guest nor the host.

Probably a new order thread. It's independent of how far you split the trades —
worth doing regardless.

## How far to split — a spectrum

**Option A — words only (cheapest).** Keep one model, make the language
trade-aware: drop "guests" for non-chef trades, say "deadline" not "evening" and
"have it ready" not "coming up" where the provider doesn't attend. Fixes how it
*reads*, not what it *is*. A day's work; buys legibility, not capability.

**Option B — a per-trade order spec (the real value).** Give each trade the
fields it actually needs, as a small structured thing instead of the free-text
`note`: chef = party size + dietary; baker = item + size + message +
collect-or-deliver; hamper = contents + delivery slot. The provider gets an
order they can act on rather than a sentence to interpret. More work; this is
where a baker stops feeling like a chef with the wrong words.

**Option C — two flows (most).** Separate "book a person for a slot" (chef) from
"order a thing for a date" (baker/hamper) — different guest-facing card,
different dashboard framing. Most faithful to how different they are; most work;
and a real risk of fragmenting a small, unproven feature before demand tells you
it's worth it.

## Decided vs open

- **Decided / done:** exclusivity is chef-only (live).
- **Open, your call:**
  1. The **order message thread** — I'd do this regardless of A/B/C; it bites first.
  2. **How far down A → B → C.** My read: A is a cheap, honest next step; B is
     where the value is once you have a baker or two to learn from; C is
     premature until demand proves the two are worth building twice. But that's
     a judgement about your roadmap, not the code — which is why this is a note
     and not a pull request.
