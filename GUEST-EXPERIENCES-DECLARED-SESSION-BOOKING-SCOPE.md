# Declared sessions — the guest side (class scheduling, piece 3) — scope

Scoping doc (GitHub issues are disabled on this repo). Pieces 1 and 2 shipped a
**declared dated session**: a `slot_sessions` row with `declared = true`, a
capacity, a duration and an optional title, that reserves its interval even at
zero seats (`20260917…_dated_class` + the rename), and a **diary scheduler** that
creates them across multiple days at once (`SlotCalendar` + `/api/services/slots/
sessions/declare`). What is still missing is the whole point: **a guest can't see
or book one.** This scopes that — the last piece.

**Status: scoped, NOT started.** No code. Grounded in the current booking path.

## The short version

A declared session exists on the calendar and holds its time, but it is invisible
to guests and unbookable, for two reasons that sit at opposite ends of the flow:

- **The book route can't accept it.** `POST /api/services/slots/book` validates
  every `(date, time)` against the **weekly template** —
  `generateSessions(...).some(s => s.time === sessionTime)`
  (`app/api/services/slots/book/route.ts:175-185`). A declared session at a time
  the template doesn't generate (a bank-holiday 7pm, a day with no weekly hours —
  the whole no-fixed-schedule case) fails that check as "That time isn't
  available." And when a session IS established, the claim **overwrites** the
  row's capacity and duration with values recomputed from the item/provider
  (`:334-345`) — which would throw away exactly the capacity and length the
  provider set on the declared session.
- **The panel can't show it.** `shapeProviders` currently folds declared sessions
  into the open-hours grid's **block set** so a private hour is never offered on
  top of one (`lib/experiencesData.ts:358-366`) — correct, but it means the
  declared session is only ever a *hole*, never a *thing to book*. `BookingPanel`
  has one lane: pick an item, pick a day, pick a time from the generated grid
  (`components/marketplace/BookingPanel.tsx`). A declared session has an identity
  and a fixed time that lane has never modelled.

So piece 3 is: **make the book route claim into a pre-existing declared row**, and
**give the guest a second lane** that shows declared sessions as identified,
capacity-bearing things. The collision core, the seat CAS, the hold/pay/webhook
path and the order shape all stay exactly as they are.

---

## 1. The crux — claiming into a pre-existing declared row

Today a booking **materialises** its session row: the route upserts a fresh
`{ seats_taken: 0, private }` row on the unique key, then the establishing CAS
sets `seats_taken`, `private`, `capacity`, `duration_minutes`, `turnaround_minutes`
in one swap (`book/route.ts:294-345`). A declared session **already exists** as a
row, so three things change, all in the book route:

1. **Accept the time.** A `(date, time)` is legit if the weekly template offers it
   **or a declared row exists there.** Add the declared lookup beside the
   `generateSessions` check (`:175-185`): read the row `where provider_id, session_date,
   session_time, declared = true`; if present, it's legit regardless of the
   template.
2. **Adopt, don't overwrite.** For a declared session the **capacity and duration
   are the row's own** — set by the provider — not recomputed from the item. The
   establishing CAS (`:334-345`) must keep the declared row's `capacity`,
   `duration_minutes` and `turnaround_minutes` and change only `seats_taken` (and
   `private`, the mode — see §2). The `upsert` at `:294-296` already no-ops on a
   declared row (`ignoreDuplicates`), so it's harmless; the fix is the establish
   branch. `resolvedDuration(item, provider)` (`:152`) is replaced, for a declared
   session, by the row's `duration_minutes`.
3. **A released declared session stays declared.** When a booking is cancelled or
   a hold is swept, the seat is given back by decrementing `seats_taken`
   (`:375-379`, and the cancel/refund path). For an open-hours session a 0-seat
   row is just an empty placeholder; for a **declared** row, seats_taken → 0 must
   leave `declared = true` intact so the session stays announced and bookable.
   Nothing should delete a declared row on cancellation (that's the scheduler's
   Remove, which already refuses a booked one).

Everything else in the route — the future-time check, the overlap courtesy check
+ the authoritative exclusion, the hold order, Checkout, the webhook — is
unchanged. A declared session is booked through the **same** hold/pay machinery;
only where the row comes from differs.

## 2. What a declared session's capacity and mode mean — the load-bearing decision

A declared row carries a `capacity` and (from the mode migration) a `private`
column defaulting false. It does **not** carry a price or a mode — price lives on
the provider's items, and a booking's mode (private hire vs shared seat) is pinned
today by the **item** the guest picks (`bookingIsPrivate(unit)`,
`book/route.ts:211`). So: is a declared session a **shared, seated** thing (a
class: N people each take a seat) or can it also be booked **private** (a whole
one-off hired by one party)?

**My read: a declared session is a shared, seated session** — the class model.
Its `capacity` is the **seat pool**; the guest books it with a **per-person item**
(the price), and seats fill up to the declared capacity. This reuses every
existing rule: `optionAvailability(row, unit, seat)` already reads seats-left off
the row, `seatConfig` already resolves capacity, and the establish/join CAS
already enforces it — the only change is that the **declared row's capacity is the
pool** (adopted, per §1), not the item/provider's. A provider who wants a private
one-off books the guest into the **whole-session (flat) item** instead — that's
already a private hire, and the declared capacity becomes the attendee cap.

The decision this forces (decision 2 below): **which item(s) a declared session is
bookable with.** Simplest: any of the provider's active priced items, exactly as
an open-hours session — a per-person item takes seats from the declared pool, a
flat item books it whole. That keeps one model. The alternative — a declared
session carrying its own price/mode — is cleaner conceptually but adds a price
surface to the scheduler and a second pricing source; I'd avoid it unless a class
genuinely needs a price distinct from the menu.

## 3. Surfacing declared sessions to the marketplace

`shapeProviders` must return declared sessions as a **distinct bookable list** on
`MpProvider`, not only as partial-block intervals. Concretely:

- Keep feeding declared intervals into `providerPartialBlocks` so the **open-hours
  grid still hides** overlapping starts (`experiencesData.ts:358-366`) — unchanged.
- **Add** a `declaredSessions` array to `MpProvider`: each `{ id, date, time,
  duration, capacity, seats_taken, title }`, filtered to the same window the
  open-hours grid uses (the stay, or the standalone horizon) and to future times,
  and dropped when full to every option the provider offers (reuse
  `sessionClosedToAll`). Seats-left per option comes from the same
  `optionAvailability(row, unit, seatConfig(...))` the grid uses.
- Eligibility is unchanged: a provider still needs a priced item to appear
  (`if (!items.length) continue`), because a declared session is booked with one.

## 4. The guest's two lanes

`BookingPanel` / `StandaloneBookingPanel` gain a **timetable lane** beside the
open-hours grid — the biggest piece, and the one the class-scheduling scope flagged
for a design pass:

- **Open hours** (today): item-first → day → a generated time grid. Unchanged.
- **Declared sessions** (new): a **session-first** list — "Sunset sauna · Fri 18
  Sep, 7pm · 4 of 8 left" — the guest picks a session that already exists, then
  chooses how many / which per-person item, then books. Date, time and duration
  are fixed by the session; the guest doesn't pick them.

Both lanes end in the same `POST /slots/book` call — a declared booking just sends
the declared session's `(date, time)` (and its `slot_session_id` is resolved
server-side). The overlap-greying already in the panel still applies across both:
a booked declared session greys the open hours it overlaps, and vice versa, which
the guest reads as the §1 reservation. A listing with only declared sessions (empty
weekly template) shows only the timetable; one with only weekly hours shows only
the grid; one with both shows both — the additive model, surfaced.

## 5. Where a declared session shows on the listing body

The public listing (`ExperienceListingBody`) is the panel's host. The timetable
is part of the booking panel (the right column), not the body prose, so the body
needs no new section — but the "Book a time" cue and any "next session" hint should
reflect that dated sessions exist. Minor; rides on the panel work.

---

## Decisions this needs, in dependency order

1. **Adopt-not-overwrite in the claim.** Confirm the establishing CAS keeps a
   declared row's capacity/duration/turnaround and changes only seats_taken/mode.
   Everything else hangs on this — it's the one change to the money-correctness
   path. *(Recommend: yes — the declared row is the source of truth for its own
   size and length.)*
2. **What a declared session is bookable with** (§2): any active priced item
   (per-person = shared seats from the declared pool, flat = private hire), vs a
   declared session carrying its own price/mode. *(Recommend: reuse the items —
   one pricing source.)*
3. **Mode of a declared session.** Is it always shared/seated, or may a provider
   declare a private one-off? *(Recommend: shared by default; a private one-off is
   the flat item booked whole — no new concept.)* Depends on 2.
4. **Marketplace shape** (§3): the `declaredSessions` array on `MpProvider`, its
   window/eligibility, and seats-left via the shared helper. Depends on 1–3.
5. **The two-lane panel** (§4): how the timetable reads beside the grid, the
   session-first sub-flow, and the empty/only-one-lane cases. The design pass.
   Depends on 4.
6. **Release semantics** (§1.3): a cancelled/swept declared booking returns to
   seats_taken = 0 and stays declared; confirm nothing deletes the row. Small but
   on the cancel path, so pin it. Depends on 1.

## Not in this doc

- **The scheduler** (create/edit/remove declared sessions) — shipped in piece 2.
- **The reservation core** (the exclusion, block_minutes) — shipped in piece 1;
  this changes only what reads and claims the rows, never the guard.
- **Recurring class series, waitlists** — out (per the class-scheduling scope).
- **A price per declared session** — only if decision 2 goes that way; not scoped
  here.
- **The exact visual design** of the timetable lane — a design pass after
  decisions 1–4.
