# Per-item location for slot experiences — scope

Scoping doc (GitHub issues are disabled on this repo). A single provider can
genuinely work in two places: a yoga teacher with a **studio** where guests come
to shared classes, who **also travels** to cottages for private 1:1s. Today that
cannot be expressed. `fulfilment` is one value on the provider row — come-to-me
**or** travel, never both against different offerings — so the teacher has to
pick one and drop half their business, or list twice.

**Status: scoped, NOT started.** No code. This records what moving location from
the **provider** onto the **item** touches, and the decisions it needs first.

## The short version

Location is currently a single axis on the provider
(`service_providers.fulfilment`, `'delivery' | 'collection' | 'both'` —
`supabase/migrations/20260910093000_provider_fulfilment_and_collection_address.sql:12`).
Every downstream rule reads that one value: the wizard branches on it, the
"travelling is always private" rule derives from it
(`lib/joinSteps.ts:199-201`), and the order page decides "comes to your cottage"
vs "go to the studio" straight off `prov.fulfilment`
(`app/experiences/order/[orderId]/page.tsx:124,131`).

Moving location onto the item is **not** the same kind of change as per-treatment
duration was. Duration broke a **safety** invariant (the non-overlapping grid —
see `GUEST-EXPERIENCES-MASSAGE-DURATION-SCOPE.md`). Per-item location breaks a
**derivation** invariant: a pile of rules that each assume one location per
provider now have to key off *the booked item* instead. The booking-collision
core is mostly untouched — **except** for one new physical fact the grid has
never had to model: a provider who moves between a studio and a cottage **cannot
be in both at once, and needs time to travel between them.** That is the one part
of this that reaches the money-correctness layer, and it rides on the interval
overlap model the massage scope already defines.

The good news: the schema already separates location from `shape` as its own
axis, on purpose — the fulfilment migration says so in as many words ("adds that
direction as its OWN axis … without touching `shape`"). This change moves that
axis down one level, from the provider to the item. Everything below is what
"down one level" costs.

---

## 1. Where location lives today, and why the provider level can't hold "both"

### The one value everything reads

| Thing | Column / rule | Reference |
|-------|---------------|-----------|
| Direction | `service_providers.fulfilment` (`delivery`/`collection`/`both`) | `…20260910093000…:12,50-58` |
| The studio address | `collection_street` / `collection_town` / `collection_postcode`, **private**; public town is `based_line` | same migration, `:13-18` |
| Which categories even ask | `SLOT_WHERE_FORK_CATEGORIES = ['yoga','massage','painting']` | `lib/serviceProviders.ts:178` |
| "A traveller is always private" | `travellingMixedSlot = slot ∧ mixed ∧ fulfilment==='delivery'` → drops length, capacity, the shared basis | `lib/joinSteps.ts:199-201`, `stepApplies` `:272-283` |
| The order's "Where" | `slotTravels = isSlot ∧ prov.fulfilment==='delivery'`; `collects = fulfilment ∈ {collection,both}` | `app/experiences/order/[orderId]/page.tsx:124,131` |

Note the categories don't line up cleanly, which is the whole reason this is
fiddly:

- **Where-fork** (asks studio-vs-travel): `yoga, massage, painting`.
- **Mixed** (shared-class *and* private per item): `yoga, pottery, painting`.
- **Per-item duration** (massage): `massage`.

So the "does both" provider this doc exists for is precisely the **∩ of
where-fork and mixed** — `yoga` and `painting` — where the shared/private choice
already lives per item but the location choice does not.

### Why `fulfilment='both'` doesn't already solve it

The column *has* a `'both'` value — but for a slot it is unused, and it would not
help if it were. `'both'` on a made-to-order baker means "collect **or** I
deliver, guest's choice, same cake." For our yoga teacher the two locations are
**not interchangeable for one offering**: the Tuesday studio class is *only* at
the studio; the cottage 1:1 is *only* at the cottage. The guest does not choose
the location — the **offering** fixes it. That is a per-item fact, and a single
provider-level enum (even a three-valued one, even with one address) cannot carry
"this thing here, that thing there."

### What moves

1. **A per-item location.** The item already carries its own unit, price and
   (for massage) duration on `service_provider_items`
   (`…20260913210406…:50`). Location joins them — the smallest version is a
   direction per item (studio vs travel), reusing the same vocabulary as
   `fulfilment` so the derivations can be lifted rather than rewritten.
2. **The studio address stays provider-level.** One teacher, one studio — the
   `collection_*` fields do not multiply. Only the *direction* moves to the item;
   the address it points at is still the provider's one studio. (A provider with
   two studios is out of scope — flag if it's real.)
3. **`fulfilment` becomes a rollup, not the source of truth.** The provider-level
   value is still useful as a *summary* ("this provider travels, comes-to-me, or
   both") for the directory and coverage filter, but it stops being what any
   booking or order reads. It is derived from the items, not the other way round.

---

## 2. What the guest sees

Today the listing has one location stance, shown once. With location per item the
guest is looking at a menu where **different rows happen in different places**,
and the page has to make that legible without turning into a spreadsheet.

- **On the listing / booking panel.** Each bookable option needs its own "where"
  — a studio class reads "at &lt;studio town&gt;", a travelling 1:1 reads "comes
  to your cottage". The panel already renders a per-option list with per-option
  availability and unavailability reasons (`components/marketplace/BookingPanel.tsx`),
  so this is a new per-row line, not a new screen — but the single provider-level
  "based in / travels to" header stops being the whole truth and needs to sit
  alongside per-row locations.
- **The address-reveal rule differs per row.** A studio address is the come-to-me
  rule: town public, exact address released only on a confirmed (paid) order
  (order page `:242-244`). A travelling row has no address to reveal — the
  destination *is* the guest's cottage, already known from the booking
  (`booking_id` / `listing_id` on the order, `…20260829030000…:80-81`). So one
  menu now mixes "address revealed on payment" rows with "we come to you" rows.
- **Coverage still gates travel, not the studio.** For a travelling row the
  existing coverage regions decide whether this guest's cottage is reachable; a
  studio row is reachable by anyone who'll travel to it. If one provider offers
  both, discovery has to treat the provider as in-area when **either** an item's
  studio is listable **or** the cottage falls in coverage — a per-item test, not
  the provider-level one.

**My read:** the guest-facing change is presentation, not a new flow — a
per-option location line and a per-option reveal rule, both of which the panel is
already shaped to carry. The risk is legibility (a six-row menu where three rows
are "here" and three are "to you"), not mechanism.

---

## 3. What the booking and confirmation carry

This is where the derivation invariant actually bites.

### Today the order does not store location — it re-derives it

The order page loads the **provider's current** `fulfilment` and `collection_*`
and computes "Where" live (`app/experiences/order/[orderId]/page.tsx:88,124-135`).
Nothing about the location is frozen onto the order the way `item_name`,
`item_unit`, `unit_price`, `price` and now `duration_minutes` are
(`…20260913210406…:78`). That is already slightly wrong today — if a provider
flipped `fulfilment` after a booking, a past order's "Where" would rewrite itself
— but with one location per provider it has never mattered in practice.

With location per item it matters immediately: two live orders for the **same
provider** now legitimately have **different** locations, and "read the provider's
current stance" can no longer produce either. So:

1. **Freeze location on the order.** Add the booked direction (and, for a studio
   booking, enough to name the address) to `service_orders`, written at claim time
   alongside the frozen duration. `service_orders` is revoked from
   anon/authenticated and read via the service role
   (`…20260913210406…:75`), so a location column needs no new grant — same as
   duration.
2. **The order page reads the frozen value, not `prov.fulfilment`.** The
   `slotTravels` / `collects` derivation (`page.tsx:124,131`) moves from the
   provider row to the order row. "Comes to your cottage" vs "Go to &lt;studio&gt;"
   becomes a property of *what was booked*, not of the provider as they stand now.
3. **`slot_sessions` may need the direction too.** The live session is the
   contention row (`…20260902200413…:69-82`); it already carries `private` and
   will carry `duration_minutes`. Whether it also needs the location depends on
   §5 — if travel time enters the overlap guard, the guard must know each live
   session's place, so the direction (and for travel, the cottage it's at) has to
   be on the session, not only the order. **This is the join between this doc and
   the collision core** and wants a decision, not an assumption.

---

## 4. How "travelling is always private" re-derives

The rule is sound and must survive: **nobody joins a class held in someone
else's cottage**, so a travelling session is exclusive by definition. Today it is
enforced by provider-level gating — `travellingMixedSlot` drops the shared basis,
capacity and provider length when `fulfilment==='delivery'`
(`lib/joinSteps.ts:199-201`), and the per-item shared/private question
(`menuBooked*`, `lib/strings.ts:227-241`) is only asked come-to-me.

Once location is per item, the rule re-derives **per item** instead of per
provider:

- **An item that travels is private, full stop** — the shared/private question is
  not asked for it; it is fixed private the way a traveller's whole listing is
  fixed today.
- **An item at the studio may be shared or private** — the existing per-item
  `menuBooked` question applies to exactly these rows.
- So `travellingMixedSlot` (a provider predicate) is replaced by an **item
  predicate**: `itemTravels(item) ⇒ private`. The wizard asks location first for
  the item, then only asks shared-vs-private for the studio ones. The mixed
  wizard already asks one question per item in a sub-flow, so this is one more
  step-kind in the same machinery, gated on the item's location — not a new
  branch of the flow.

**My read:** the rule gets *simpler*, not harder — it stops being a special
provider-shape (`travellingMixedSlot`, with its length/capacity drops) and
becomes a local implication on one item. The provider-level drops (no provider
length, no provider capacity for a pure traveller) turn into per-item facts that
fall out naturally: a travelling item has its own length and its head-count cap
(the cottage), a studio class uses the provider's shared-class length and studio
capacity.

---

## 5. Travel time between a studio session and a cottage session

**This is the one genuinely new physical constraint, and the one open risk.**

Turnaround already exists — `slot_turnaround_minutes`, a provider-level reset gap
folded into the blocking interval so the claim reserves
`[start, start + duration + turnaround)` (`…20260913210406…:88-102`). It is
deliberately **one number, the same after any treatment**, because a masseuse's
reset is a property of the person and room, not of where they are.

Travel between a studio and a cottage is **not** that number:

- It depends on the **pair of locations** — 10 minutes to a cottage in town, 50
  to one up a glen — so it cannot be a single provider constant the way
  turnaround is.
- It is **asymmetric and order-dependent**: studio→cottage→studio costs travel
  twice; two studio classes back-to-back cost none.
- It only exists **between sessions in different places**. Two studio sessions
  need only turnaround; a studio session followed by a cottage session needs
  turnaround **plus** the studio→cottage drive.

So the overlap guard the massage scope defines — "refuse a booking whose interval
overlaps an existing one for this provider" — has to widen for a mixed-location
provider: the blocking interval of a session is `[start, start + duration +
turnaround + travel_to_next_location)`, and `travel_to_next_location` is zero when
the neighbouring session is in the same place and non-zero when it isn't. That is
a real model, and it needs a source for the drive time.

**Options, cheapest first (a decision, not a recommendation to build):**

1. **Ignore it (v1).** Treat travel as zero; rely on the provider spacing their
   own studio and travel hours (see §6) so the two never abut. Simplest, and
   defensible if studio and travel days don't overlap — but a silent
   double-commit the moment they do, which is exactly the failure class this
   codebase avoids.
2. **A flat travel buffer.** One extra provider number, "minutes I need to get
   between the studio and a cottage", added to the interval whenever consecutive
   sessions change location. Cheap, honest-ish, wrong at the tails.
3. **Distance-derived buffer.** Compute drive time from the studio to the
   cottage (the cottage location is known from the booking). Correct, but pulls a
   distance/drive-time source into the claim path — heavier, and a new dependency
   on the money-correctness path.

**My read:** option 1 is only safe if §6 forces studio and travel into disjoint
hours; otherwise the honest floor is option 2, and option 3 is a later
refinement. **This is the piece to decide before building**, because it sets
whether `slot_sessions` needs to carry location (§3.3) and whether hours can be
shared (§6).

---

## 6. Can the weekly hours still be shared?

`slot_availability` is one set of weekly open/close rows per provider
(`…20260902200413…:43-51`) — `day_of_week`, `open_time`, `close_time`, no
location. The generator lays every bookable start on that one weekly frame.

Whether it can stay shared depends entirely on §5:

- **If travel time is modelled (option 2/3),** hours can stay shared. One weekly
  frame, both kinds of session generated onto it, and the interval guard (now
  travel-aware) refuses any studio/cottage pair too close together. This is the
  clean answer and keeps the schema untouched.
- **If travel time is ignored (option 1),** hours **cannot** safely stay a single
  shared frame — the provider would have to keep studio and travel apart by hand,
  and one overlap is a double-booking. That pushes toward **hours per location**
  (a `location`/direction on `slot_availability`, e.g. studio Mon–Wed, travel
  Thu–Fri), which keeps the two apart structurally without a travel model.

So the two open decisions are coupled: **model travel and keep hours shared, or
skip travel and split hours by location.** Sharing hours *and* ignoring travel is
the one combination that is quietly unsafe.

**My read:** prefer shared hours + a travel buffer (§5 option 2) over split
hours. Splitting hours by location is more schema and a worse provider experience
("why do I set my week twice?"), and it still can't stop a provider from putting a
cottage booking 10 minutes after a studio class within the travel window. Model
the gap once and let the guard hold the line — the same shape as turnaround.

---

## Decisions this needs before anyone builds

1. **Where the per-item location lives** — a direction on `service_provider_items`
   reusing the `fulfilment` vocabulary, and confirmation that the studio address
   stays a single provider-level record (§1).
2. **Freeze location on the order** and move the order page's `slotTravels` /
   `collects` derivation off `prov.fulfilment` onto the frozen value (§3). This is
   worth doing for correctness *even before* per-item location ships.
3. **The travel-time model** (§5) — ignore / flat buffer / distance-derived. This
   is the money-correctness decision and it gates §6. Wants a human before it
   merges, like the massage overlap guard.
4. **Hours shared vs per-location** (§6) — falls out of (3); don't decide it
   independently.
5. **Does `slot_sessions` carry location** (§3.3) — yes if travel enters the
   guard, no if not; a consequence of (3).

## Not in this doc

- The interval overlap guard itself — its shape is the massage scope's §1, and
  this doc only *widens the interval* for travel; it does not re-open how the
  guard is built.
- A provider with **more than one studio** (multiple come-to-me addresses). Not
  raised; the whole doc assumes one studio address and a travel direction. Flag if
  a real provider has two premises.
- Distance / drive-time sourcing (a maps provider, a lookup table). Named as §5
  option 3 but deliberately not chosen or specified here.
- Any category outside the where-fork ∩ mixed set (`yoga`, `painting`).
  `pottery` is mixed but come-to-me only; `massage` is where-fork but
  one-at-a-time — both can adopt per-item location later by the same mechanism,
  but neither is the case this doc is written for.
