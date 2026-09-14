# Massage with per-treatment durations — scope

Scoping doc (GitHub issues are disabled on this repo). Massage is the first
guest-experience category where session length belongs to the **item**, not the
**provider**: one masseuse offers 30, 45, 60 and 90-minute treatments at
different prices. Today session length is a single number on the provider row
and the bookable times are generated from it, so the change reaches further than
the sign-up wizard.

**Status: BUILT & shipped to production 14 Sep 2026 via PR #144.** Both
migrations are applied and recorded on production and test — B's duration columns
(`20260913210406`) first, then the exclusion constraint (`20260914120000`). The
shape is live but DORMANT behind `GUEST_EXPERIENCES_OPEN` and
`BUSINESS_SIGNUPS_OPEN` (both unset on production). The decisions at the foot of
this doc were resolved; it is kept as the design rationale, not a to-do.

**What shipped differently from this doc's recommendations — kept here so the doc
says what is true, not what was planned:**

- **Turnaround exists, but has no provider-facing screen yet.** The "Not in this
  doc" buffer/turnaround was decided YES: a per-provider `slot_turnaround_minutes`
  (default 0) folds into the BLOCKING interval `[start, start + duration +
  turnaround)`, frozen onto the session at claim, never into the shown duration.
  But the sign-up wizard does NOT ask for it — its item sub-flow is name →
  duration → price → description → photo — so it stays 0 until a provider-edit
  screen is added.
- **Per-item durations are massage-only, via a category opt-in — not purely
  structural.** The BOOKING code IS structural: it keys off whether an item
  carries `duration_minutes`, never off the category. But the WIZARD opts
  categories in by a list (`SLOT_PER_ITEM_DURATION_CATEGORIES = ['massage']`), so
  today only massage uses the shape; barbers, physios, groomers and the rest join
  by being added to that list, with no booking-code change.
- **The overlap guard (Decision 3) is DB-authoritative.** It shipped as a partial
  GiST exclusion constraint (`slot_sessions_no_overlap`, `WHERE seats_taken > 0`)
  as the authority, with an in-claim interval check only for the guest message and
  the greying — "both", with the database as the source of truth.
- **Decisions 1, 2 and 4 shipped as recommended:** `slot_length_minutes` coexists
  (the item overrides it when set); the length lives on `slot_sessions` AND
  `service_orders`, frozen at booking; capacity is fixed at 1 / private for the
  shape, derived and not asked.

## The short version

It is **not** a wizard change. Moving duration onto the item breaks the one
assumption the whole slot-booking system rests on — that every session for a
provider is the same length, so back-to-back sessions tile the day and never
overlap. Once treatments have their own lengths, two bookings can occupy the
same masseuse at the same time and the code cannot see it. That is a
double-booking of one person, silently, with money taken — the exact class of
failure this codebase exists to avoid. Fixing it is a schema + booking-model
change; the wizard is the last and smallest part.

---

## 1. The overlap model — why this is the real work

### How a session is booked today

A bookable session is identified by exactly three things: **provider, date,
start-time**. That trio is a unique key on `slot_sessions`
(`supabase/migrations/20260902200413_slot_shape.sql:69-79`), and a booking is an
atomic compare-and-swap on how many seats *that one start-time* holds
(`app/api/services/slots/book/route.ts:171-243`).

**Nothing anywhere records when a session ends.** There is no end-time and no
duration on the session row or the order. The claim protects against two people
grabbing the *same start-time*, and nothing else.

That is safe today only because every session for a provider is the same length
(`slot_length_minutes`, one number on the provider). Start times step from
opening by exactly that length until closing
(`lib/serviceSlots.ts:85-112`), so a provider's day is a clean, non-overlapping
grid — 10:00, 11:00, 12:00 for 60-minute sessions. Two sessions can never cover
the same minute, so a start-time is a safe stand-in for "this provider is busy".

### What breaks the moment duration moves onto the item

Different treatments generate different grids. A masseuse offering both a
90-minute and a 30-minute treatment:

- Guest A books **90 min at 10:00** → masseuse busy **10:00–11:30**.
- Guest B books **30 min at 11:00** → masseuse busy **11:00–11:30**.

Two different start-times → two different `slot_sessions` rows → the unique key
does not collide, the seat guard treats each as its own slot, and **both
bookings succeed.** One masseuse, two guests, overlapping — and everything
returns `ok: true`. There is no error to notice.

The start-time is no longer a safe stand-in for "busy", because a session now
covers a *range* of minutes that depends on the treatment. The booking unit has
to change from "a point on a fixed grid" to "an interval on this provider's
day", and the claim has to refuse a new booking whose interval **overlaps any
existing one for the same provider** — not just one that shares its start-time.

### What a correct model needs

| Layer | Today | With per-treatment duration |
|-------|-------|-----------------------------|
| Booking unit | Fixed grid cell, keyed on start-time | Time **interval** (start + length) on the provider's day |
| Generation | One grid per provider from `slot_length_minutes` (`lib/serviceSlots.ts:85`) | Grid depends on the **chosen treatment's** length; the times a guest sees change with the treatment picked |
| Collision guard | Unique key on `(provider, date, start-time)` + CAS on `seats_taken` | Refuse any booking whose interval overlaps an existing one for that provider (an exclusion check, not point-uniqueness) |
| Availability display | `optionAvailability` greys a single grid (`lib/serviceSlots.ts:236-266`) | Must grey every start that would overlap something already booked — shared by the guest panel and host diary, as now |

This is a different booking primitive. Point-uniqueness on a start-time cannot
express "busy from X to Y", so the fix cannot be bolted onto the existing claim
— the claim itself has to reason about intervals.

---

## 2. The schema shape

### Where duration lives today

`public.service_providers.slot_length_minutes` — a nullable integer, one per
provider (`supabase/migrations/20260902200413_slot_shape.sql:17-32`). No check
constraint on the column; bounds are clamped in the schedule route
(`Math.min(600, Math.max(15, …))`). Sessions materialise lazily on first
booking; the guest-facing times are generated on the fly, never stored ahead of
time.

### What changes

1. **A per-treatment duration.** Each treatment is a priced item, so its length
   belongs with it — a `duration_minutes` on whatever row represents an item
   (the menu items the wizard already saves), not on the provider. The
   provider-level `slot_length_minutes` stops being the source of truth for
   massage; it can stay for the single-offering categories (sauna, a fixed
   class) or be superseded — a decision to make, not assume.

2. **The session/order must carry its own length.** For the overlap check to
   work, a claimed session (or the order) has to know how long it runs, so the
   guard can compute its interval. That is a new column on `slot_sessions`
   and/or `service_orders` (which today carry `slot_session_id` and
   `service_time` — `…20260902200413…:90-93`).

3. **Migration, not a form tweak.** New columns, a backfill for existing rows,
   and the house rules apply: **widen a check constraint before adding a value**,
   and money columns stay revoked from `authenticated`. `slot_sessions` already
   has `check (seats_taken between 0 and capacity)` and
   `unique (provider_id, session_date, session_time)` — the unique constraint in
   particular is part of what needs rethinking, because two different-length
   sessions can legitimately share neither, yet still overlap.

### The invariant to keep

`lib/pricing.ts` stays the only place a total is calculated. Per-treatment price
is fine; the total for a booking still comes from there.

---

## 3. Massage: capacity, mode and wording

These are wrong for a treatment **today**, independent of duration — but they
belong in this scope because massage's whole setup flow is being reopened, and
fixing the words while the structure moves underneath would mean touching the
same screens twice (and risks a work-laptop paste quietly reverting the first
pass). One masseuse works on one person at a time: there is no group, no shared
table, no seats to sell.

| What the wizard does now | Right answer for massage |
|--------------------------|--------------------------|
| Asks capacity 1–60 (`g_capacity`, `components/services/ProviderSignUp.tsx:5259-5263`) | **Fixed at 1, not asked.** One masseuse, one person. |
| Asks pricing basis — one group / several join / both (`g_slot_basis`, `…:5245-5257`) | **Fixed to private/flat, not asked.** A treatment is always a whole-session price for one person; "several people join" cannot happen. |
| Per-person helper reads *"A price each — a shared table or class."* (`lib/strings.ts:226`) | **Removed for massage** — there is no per-person option to describe. |
| Minimum-group screen (`g_slot_min`, `…:5265-5274`) | Already shows only for shared offerings, so forcing massage to private makes it correctly disappear. Confirm, don't rely on it by accident. |
| Asks "How long is each session?" once (`g_slot_length`, `…:4997-5001`; `lib/strings.ts:346-349`) | **Removed from the provider level for massage** — duration is now asked per treatment (see §4). |

**My read: yes, fix capacity at 1 for massage and don't ask it, and fix the mode
to private/flat rather than asking the basis.** Both follow from "one person at a
time" and both remove a screen that has only one honest answer. Neither depends
on the duration work — but neither should ship on its own while §1–§2 are
pending, per the coupling above.

---

## 4. The wizard side — staying in the same flow

The whole point is that massage's setup reads as the same Airbnb-shaped flow as
the rest of the guest sign-up: one question per screen, the same section rail,
the same steppers and card styles. Not a separate form bolted on.

### What the flow gives us already

The priced-items screen (`g_menu`,
`components/services/ProviderSignUp.tsx:4570+`) is already a **hub**: a list of
borderless rows (name + price + photo thumbnail), an add row at the bottom, and a
per-item sub-flow of one question a screen — **name → price+type → description →
photo** — steps addressed by kind, not index (`…:4663-4667`). This is the same
shape the expertise hub uses, and it borrows the same borderless fields
(`…:4669-4672`) and the live "You keep £X" payout card computed from the real
commission (`…:4674-4679`).

A treatment list — several named things, each with its own duration and price —
is exactly a repeating priced-item list. So the machinery to reuse is this menu
hub, its HubRow, its add row, and its one-question-a-screen item sub-flow.

### The catch: slots are currently single-offering

For a slot today, that same screen **deliberately suppresses the repeating
list**: "A slot is one session offering (a sauna owner sells 'the sauna', not a
list), so it shows a single row with no add and its price unit read off the
private/shared answer" (`…:4577-4580`). private/shared show one shape; only
"offer both" shows two named guidance rows and can add more.

Massage breaks that assumption — it *is* a list of offerings — so massage becomes
a **third slot presentation**: not single-offering (private/shared/both), but a
repeating treatment list. The right move is to **reuse the existing menu-hub
sub-flow, not build a new one**, and add **one new step-kind to the per-item
sub-flow: duration** (a `NumberStepper`, the same component `g_slot_length` uses
today at `…:4997-5001`, `step={15}`, matching the existing 15-minute clamp). So a
treatment's sub-flow becomes **name → duration → price → description → photo** —
one new screen, same craft, no per-person/unit step (massage is always flat).

### Consistency risks to watch

- **A screen disappearing from the rail.** `g_slot_length` and `g_slot_basis`
  drop out of the massage path (duration is per-item; mode is fixed). The flow
  already includes steps conditionally, so this is normal — but the section rail
  must still read as a coherent, complete set for massage, not a flow with
  visible gaps.
- **Don't fork the item sub-flow.** If massage gets its own parallel item
  editor, the two will drift and one will get the borderless-field or payout-card
  polish the other misses. The duration step must live inside the *existing*
  `stepKinds` machinery (`…:4663`), gated to massage, not a second sub-flow.
- **The save mapping is provider-shaped.** Today `slot_length_minutes` is written
  once (`…:2753-2763`). Per-treatment duration has to be written per item on save
  and read back per item on return (the load-back at `…:956-976`), alongside the
  existing per-item name/price/photo — so the round-trip stays lossless the way
  the menu already is.
- **The "single row, no add" branch is load-bearing.** Whatever tells the menu
  screen "this is massage, show the repeating list" must be explicit, so sauna
  and fixed-class slots keep their single-offering screen unchanged.

**Verdict: reuse the existing item sub-flow — do not build a new one.** Massage
needs (a) the menu hub's repeating-list behaviour that the slot path currently
disables, and (b) one added `duration` step in the per-item sub-flow. Everything
else — rail, steppers, cards, payout maths, photo-per-item — is already there and
should be used as-is.

---

## Decisions this needs before anyone builds

1. **Does `slot_length_minutes` survive** for single-offering categories (sauna,
   fixed class), or does per-item duration replace it everywhere?
2. **Where does the session's length live** for the overlap check —
   `slot_sessions`, `service_orders`, or both — and how are existing rows
   backfilled?
3. **The overlap guard's shape** — an exclusion constraint in the database, an
   interval check in the claim loop, or both. This is the money-correctness core
   and wants a human on it before it merges.
4. **Confirm capacity=1 / mode=private for massage** are fixed, not asked (my
   read: yes).

## Not in this doc
- The overlap guard's exact implementation (DB exclusion constraint vs. in-claim
  interval check) — a §1 decision, deliberately left open above.
- Buffer/turnaround time between treatments (a masseuse may need 10 minutes to
  reset). Not raised in the brief; flag if it matters, as it changes the interval
  maths.
- Any category other than massage. Yoga and painting share the where-fork
  (`lib/serviceProviders.ts:178`) but were not raised as needing per-item
  duration.
