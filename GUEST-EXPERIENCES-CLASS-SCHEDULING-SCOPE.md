# Dated class scheduling — scope

Scoping doc (GitHub issues are disabled on this repo). A slot provider today has
one way to say when they work: a **weekly recurring template** — "every Thursday,
19:00–21:00, in 60-minute steps." That cannot express a class at **Thursday 7pm
one week and Tuesday 6pm the next**, nor a one-off, nor a term timetable. A host
who runs scheduled classes needs to create **dated classes individually** — a
date, a time, a duration, a capacity — while private sessions still book into open
hours. This scopes that.

**Status: scoped, NOT started.** No code. This records what "a dated class" is
against the machinery that already exists.

## The short version

The hard part is already built. The interval-overlap engine shipped (PR #144:
`20260913210406_…overlap_model.sql` + `20260914120000_slot_interval_overlap_exclusion.sql`),
and it is **dated-interval-native**: a booked session blocks
`[start, start+duration+turnaround)` on a specific `session_date`, enforced by a
GiST exclusion on `(provider_id, session_date, block_minutes)`
(`…20260914120000…:95-102`). A class on Thursday and one on Tuesday are just two
`slot_sessions` rows on different dates — the collision layer needs **nothing new**
to keep one provider from being in two places at once.

The gap is entirely **upstream of the collision layer**, in two places:

- **Declaration.** The only thing that can put a bookable time on a provider's
  calendar today is the weekly template (`slot_availability`, day-of-week +
  hours). `generateSessions()` derives every `{date, time}` from it
  (`lib/serviceSlots.ts:98-137`), and `slot_sessions` rows are **materialised
  lazily, only when someone books** (`app/api/services/slots/book/route.ts:246-259`).
  A dated class is the opposite: it must **exist before anyone books it** —
  announced, with a capacity, visible at zero seats.
- **Display.** The guest sees exactly one lane: a day-grouped grid of times from
  the weekly template (`lib/experiencesData.ts:243-255`, `BookingPanel.tsx`).
  There is no notion of a *class* with an identity, distinct from "pick any open
  hour."

So a dated class is a **new declaration primitive and a second display lane over
an unchanged collision core.** Everything below is about those two, and the one
place they touch the money-correctness layer: a declared-but-unbooked class has to
reserve its slice of the day so an open-hours booking can't land on top of it.

---

## 1. Is a dated class the same object as an open-hours session?

**At the collision layer: yes.** Both are (or become) a `slot_sessions` row with a
`block_minutes` interval on a date, and the same exclusion constraint and seat CAS
protect both. Nothing about the guard cares how the row was declared.

**At the lifecycle layer: no** — and this is the crux:

| | Open-hours session | Dated class |
|---|---|---|
| When the row exists | Materialised **on first booking** (`book/route.ts:246`) | Declared **up front** by the host, before any booking |
| Capacity/mode | Pinned by whoever books the empty session first (`serviceSlots.ts:159`, `slotClaimKind`) | Set by the host when they create the class |
| Identity | None — it's "the 7pm slot" | Has one — a named class, a fixed time, one shared group |
| Reserves the day when empty? | No — a 0-seat open hour is just… open | **Must**, even at 0 seats: an announced class holds that time |

That last row is the load-bearing one. The exclusion constraint fires only
`where (seats_taken > 0)` (`…20260914120000…:101`), and `generateSessions()` only
avoids **partial-block** rows fed in as `partialBlocks` (`serviceSlots.ts:128-131`).
An empty declared class is neither, so today it would be **invisible to the
open-hours grid** — a guest could book a private 7pm session straight over an
announced-but-unbooked 7pm class.

**My read:** a dated class is the **same object at the collision layer, a
different object at the declaration layer.** The cleanest realisation is a class
that is a **pre-created `slot_sessions` row** carrying its own identity, that
**reserves its interval whether or not it is booked** — reusing the mechanism
partial blocks already use (a `slot_sessions` row fed into `generateSessions` as a
blocking interval, `app/api/services/slots/blocks/route.ts:99-112`). The
alternative — a separate `slot_classes` table that materialises into
`slot_sessions` on booking — keeps class identity cleaner but creates **two
collision sources to keep consistent**, which is the thing the single
`slot_sessions` guard exists to avoid. Decision 1 below.

---

## 2. How they coexist in the diary and the overlap engine

- **In the overlap engine — for free, with one change.** Dated intervals are
  already the native currency. The only change is making a **declared, unbooked**
  class reserve its interval: either widen the exclusion's `where` to cover
  declared classes (not just `seats_taken > 0`), or feed declared classes into
  `generateSessions` as blocking intervals the way partial blocks are. Both keep
  the guard the single authority; neither touches the seat CAS.
- **In the host diary — a new editor beside the old one.** The schedule route
  today replaces the **whole weekly template** wholesale on save
  (`app/api/services/slots/schedule/route.ts:76-95`, delete-and-reinsert
  `slot_availability`), and the sessions route is a **read-only sales ledger** of
  already-booked times (`sessions/route.ts:92`, `seats_taken > 0`) — neither can
  create a dated row. A class scheduler is a **third surface**: create / edit /
  cancel individual dated classes, living alongside the weekly-hours editor, not
  replacing it. A provider who runs both keeps their open-hours template **and** a
  list of dated classes.
- **Cancelling or moving a class is a booking event.** When a host cancels a class
  that has guests, that is a refund cascade — the class's `slot_sessions` row and
  its `service_orders` have to unwind exactly like an experience cancel
  (`lib/experienceCancel.ts`), not just vanish from the calendar. Moving a class
  (new date/time) is a cancel-and-rebook or a supervised reschedule; either way it
  is money, not a calendar edit.

---

## 3. What the wizard asks vs what the scheduler owns

The sign-up wizard asks each scheduling question **once**, at the weekly-hours
step `g_slot_hours` (`components/services/ProviderSignUp.tsx:5146-5241`), which is
inherently weekly (seven day toggles + shared hours). Dated classes cannot live
there: a host does not enumerate their autumn timetable while signing up, and the
timetable changes every week — it is **ongoing operational data**, not a one-time
setup answer.

The split:

- **The wizard establishes the shape and the defaults** — "do you run scheduled
  classes, offer open private hours, or both?", and the default capacity / duration
  / price a new class inherits. This is the same pattern the flow already uses:
  category predicates in `lib/joinSteps.ts:stepApplies` swap steps in and out
  (`SLOT_PER_ITEM_DURATION_CATEGORIES`, `SLOT_MIXED_DURATION_CATEGORIES`,
  `serviceProviders.ts:201-217`). "Runs classes" is a new such predicate, and it
  swaps the weekly `g_slot_hours` for (or beside) a first-class prompt — but it
  asks *whether and how*, not *which dates*.
- **The scheduler owns the dated rows** — the actual classes (a class next
  Thursday at 7pm, capacity 8) are created and edited **after** sign-up, in the
  ongoing diary tool, for the life of the business. This is the piece that has no
  home today at all.

**My read:** sign-up should end with a provider who *can* run classes and has
sensible defaults, but with **zero specific classes** — the first real class is
created in the scheduler, the same day or months later. Trying to capture a
timetable at sign-up is the mistake to avoid; it's the weekly template's whole
limitation, one level up.

---

## 4. What the guest sees when a listing has both

Today there is exactly one surface: the day-grouped time grid from the weekly
template (`experiencesData.ts:243-255`, `BookingPanel.tsx:171-175`), item-first,
with overlap-greying. It has **no concept of a class identity** and no second
lane. A provider offering both would, today, force both through the one weekly
grid, where a scheduled class and an open private hour are **indistinguishable
rows** — losing exactly the distinction that makes a class a class.

With both, the guest is looking at two different mental models on one page:

- **A timetable** — named, dated, shared classes: "Vinyasa flow · Thu 12 Sep, 7pm ·
  4 of 8 left." The guest picks a class that already exists.
- **Open private hours** — "book a private 60-minute session, any open time." The
  guest picks a time the system generates.

So `loadMarketplace` gains a **second session source** (declared classes) merged
with the generated open-hours grid, and `BookingPanel` gains a **two-lane
presentation** that shows classes as identified, capacity-bearing things and open
hours as a pick-a-time grid. The overlap-greying already in the panel
(`overlapsBooked`, `BookingPanel.tsx:162-168`) still applies across both lanes — a
booked class greys the open hours it overlaps, and vice versa, which is the guest
seeing the §2 reservation rule.

**My read:** the guest-facing change is a genuine new surface, not a re-skin — a
class has an identity and a fixed time the open-hours grid has never modelled. This
is the largest display change in the feature and wants a design pass, not just a
new row type.

---

## Decisions this needs, in dependency order

1. **Object model.** Is a dated class a **pre-created `slot_sessions` row** (with
   identity fields, reusing the partial-block reservation mechanism) or a
   **separate `slot_classes` table** that materialises into `slot_sessions` on
   booking? Everything else assumes the answer, and it is the collision-adjacent
   one — a human on it. *(Recommend: a `slot_sessions` row with a class identity,
   to keep one collision source.)*
2. **How an empty class reserves its interval** (§1/§2): widen the exclusion
   constraint beyond `seats_taken > 0`, or feed declared classes into
   `generateSessions` as blocking intervals. Depends on 1; this is the
   money-correctness touchpoint.
3. **What a class carries beyond an open session** (§1): identity/title, its own
   capacity, and whether its price/duration are per-class or the provider default
   (ties to `service_provider_items` and the per-item duration/location scopes).
   Depends on 1.
4. **The wizard/scheduler split** (§3): what sign-up asks (shape + defaults) vs
   what the ongoing scheduler owns (the dated rows), and the new category/shape
   predicate that gates it.
5. **The scheduler itself** (§2): create / edit / **cancel** / move dated classes,
   and the refund cascade when a class with bookings is cancelled or moved.
   Depends on 1 and 3.
6. **The guest's two-lane display** (§4): how `loadMarketplace` merges the two
   sources and how `BookingPanel` presents a timetable beside open hours. Depends
   on 1 and 3 — the biggest display piece.

## Not in this doc
- **Recurring class series** (a class *every* Thursday for a term as one object,
  with per-occurrence exceptions) — a dated class is a single occurrence here;
  series generation on top is a later layer.
- **Waitlists** for a full class — capacity is enforced by the existing seat CAS;
  a waitlist is a separate feature.
- **The collision engine itself** — it shipped and is dated-native; this changes
  only what feeds it, never the guard or the seat claim.
- **Per-item location/duration** — where a class happens and how long it runs reuse
  `GUEST-EXPERIENCES-SLOT-LOCATION-SCOPE.md` and
  `GUEST-EXPERIENCES-MASSAGE-DURATION-SCOPE.md`; not re-scoped here.
