# The provider diary calendar — range selection and a real day cell — scope

Scoping doc (GitHub issues are disabled on this repo). A provider-side diary
calendar for slot hosts (a sauna, a masseuse) exists on `feat/slot-diary-calendar`
(`components/services/ProviderSlotDashboard.tsx` + `components/services/SlotCalendar.tsx`).
A provider sees their booked times, then a month calendar where they can close a
whole day or part of one. Weekly opening hours live in the listing editor; this
calendar handles **dated exceptions only**, and blocking a day stops *new* bookings
without cancelling existing ones. Two problems, and it reads too basic beside the
rest of the platform. This scopes the upgrade, measured against Airbnb's host
calendar (studied read-only).

**Status: scoped, NOT started.** No code. Proposal for review before anyone builds.

## The two problems, pinned to the code

- **A — booked and selected fight.** A booked cell is `bg-emerald-100 …
  ring-emerald-300` (`SlotCalendar.tsx:112`); selection is a `gray-900` 2px outline
  layered on top (`:118`). On a green booked cell the selection outline competes
  with the emerald ring and is easy to miss — and emerald is reused for the "reopen
  the day" button and an info box (`:132-144`), so green carries three meanings. A
  booked day and a clicked day don't read as clearly different things.
- **B — a count, not a clock.** The cell shows `"N booked"` from
  `bookedByDate: Record<string, number>` (`ProviderSlotDashboard.tsx:212-213`,
  `SlotCalendar.tsx:112`) — a scalar. For a sauna "1 booked" hides the one thing
  that matters: **6pm is taken, the rest of the day is free.** The per-session
  detail already exists in the component (`sessByDay` / the `SlotSession[]` feed
  with time, seats_taken, capacity, sold — `ProviderSlotDashboard.tsx:29-32, 204-208`)
  but is rendered in a *sibling* list, never handed to `<SlotCalendar>`. The cell
  structurally cannot show "when" today.

## What Airbnb's calendar does that ours doesn't

Studied logged-in, read-only, on the multicalendar:

| Element | Airbnb | Ours today |
|---|---|---|
| **Day cell** | Shows *content*: nightly price, a **reservation bar** (guest + payout, "Currently hosting"), diagonal **hatch** for blocked, **"Mini stay"** pill for a min-stay rule | A colour + `"N booked"` count |
| **Selection** | Click a cell to select; **drag / click-start→click-end** for a range; a **"Selected dates" start→end** field in the panel | Single day only (`selected: string \| null`); no range |
| **Side panel** | One panel for the selection: **Availability** (Available/Blocked), **Nightly price**, **Rule-sets**, **Private note**, one **Save** | Inline detail under the grid: close/reopen day, block part of day |
| **Range action** | Set availability / price / rule across **every date in the range** in one Save | One day at a time |
| **Pricing & rules** | Per-night price; **rule-sets** (seasonal / length-of-stay that "replace existing settings for the dates applied"); min-stay pills | None on the calendar (price lives per item in the listing editor) |

## Where the analogy breaks — nights in a property vs sessions within a day

This is the load-bearing difference, and it decides what to copy.

**Airbnb's unit is the night.** A booking is a **contiguous multi-night stay**,
drawn as a horizontal **bar spanning columns**; availability is **per-night
binary** (available/blocked); price is **per night**. A day cell has one state,
and the calendar's job is to set availability/price per night across ranges.

**Our unit is the session.** A booking is a **session at a time** (6pm sauna), a
day holds **many** sessions (10am, 11am, …), and availability is **per-session and
per-seat** (a shared session has N seats). "Block part of a day" is a within-day
concept Airbnb has no equivalent for (their block is a whole night). So:

- **The spanning bar doesn't map.** A session doesn't span days; it sits inside one
  day. Airbnb's most recognisable cell feature is the wrong primitive for us.
- **A day isn't one availability state.** It's a *mini-timeline* of sessions, each
  free / booked / full / blocked. The cell has to summarise a day's worth of times,
  not show one bar.
- **Per-date pricing and rule-sets don't apply.** Our price is per item/session and
  lives in the listing editor, not per calendar date. Airbnb's "Nightly price" and
  "Rule-sets" panel actions have no home here — copying them would invent a pricing
  surface we deliberately don't have.
- **Range selection *does* map — for availability, not price.** "Close the 15th
  through the 22nd", or "block 6–8pm every day next week", are real and useful. The
  range + bulk-panel interaction transfers; the *contents* of the panel are
  availability-only.
- **No listing rows.** Airbnb's multicalendar stacks listings as rows because a host
  has many. One provider = one listing — ours is a single month grid, not a
  timeline of listings.

**Taken from theirs:** range selection (click-start → click-end / drag), a side
panel that applies actions to the whole selection at once with one Save, a cell
that shows *what's happening* rather than a count, and a clear visual separation
between "booked" and "selected". **Left behind:** the multi-night spanning bar,
per-date pricing, rule-sets, per-night binary availability, and the multi-listing
timeline.

## The proposal

### 1. A day cell that shows *when* (Problem B + "too basic")
Thread `sessByDay` (the `SlotSession[]` the component already holds) into
`<SlotCalendar>` alongside — or instead of — the `bookedByDate` count. The cell
becomes a **compact within-day summary**, not a number. Options to decide between
(decision 1): a small **segmented strip** of the day's sessions coloured by state
(free / booked / full / blocked), or a **one-line "6pm booked · rest free"** for
sparse days, or a tiny **density bar**. Either way the cell answers "which times are
taken", and a day that is *part* booked and *part* blocked stops collapsing to one
green fill (today `booked > 0` is tested before `blocked`/`partial`, so those cues
are suppressed — `SlotCalendar.tsx:108-114`).

### 2. A visual language where every state is its own thing (Problem A)
Give each state a distinct treatment so nothing collides: **free / part-booked /
fully-booked / day-off / partial-block / closed-weekday / past** — and **selected**
and **in-range** as their own layer that never reuses the booked-green. Selection
should read as a mode (a fill/inversion or heavy border), not a thin outline lost
on a green cell; retire emerald as a shared colour for "booked", "reopen" and "info".

### 3. Range selection
Click a day to select it; **click a start day then an end day (and/or drag)** to
select a range — everything between highlights in the in-range treatment from (2).
A **"Selected: 15–22 Sep"** header confirms it, editable like Airbnb's start→end
field. This is the core new interaction the calendar is missing.

### 4. A side panel that acts on the whole selection
Replace the inline single-day controls with a panel keyed to the selection:
- **Single day** → the day's **sessions listed with times + seats** (move "how each
  time is filling" *into* the panel), plus **Close the day / Reopen** and **Block
  part of the day** (a time range). Per-booking actions (view, cancel & refund) stay
  in the diary, linked from a session.
- **A range** → actions that apply to **every day in the range at once**: **Close
  all these days / Reopen all**, and **Block a time across all these days** (e.g.
  6–8pm Mon–Fri). One **Apply**, one confirmation. No pricing, no rule-sets.

### 5. Range write semantics
Today "close a day" POSTs the *entire* new blocked-date list to
`/api/services/slots/schedule` (wholesale replace), and a partial block is one
interval to `/api/services/slots/blocks` (`ProviderSlotDashboard.tsx:122-152`). A
range close still fits the wholesale-list POST (add N dates). A "block 6–8pm across
Mon–Fri" needs **N partial blocks, one per day** — decide whether to loop the
existing single-interval endpoint or add a small bulk endpoint (decision 5), and
keep the existing DB guards (a block can't overlap a booking — the
`slot_sessions_no_overlap` exclusion already refuses it, mapped to a 409).

## Decisions this needs, in dependency order

1. **What a day cell shows** instead of a count — segmented session strip vs
   "6pm booked · rest free" vs density bar. Requires threading `sessByDay` into
   `<SlotCalendar>` (data exists; not passed). Fixes Problem B and the "too basic".
2. **The state visual language** — a distinct, non-colliding treatment per state so
   booked ≠ selected and emerald isn't overloaded. Fixes Problem A. Depends on 1
   (the cell's internals change).
3. **The selection model** — single day + range (click-start→end and/or drag), with
   a distinct in-range highlight. The core new interaction. Depends on 2.
4. **The side panel** — single-day contents (sessions + close/reopen/block-part) vs
   range contents (bulk close/reopen/block-a-time), and Apply-to-range. Depends on 3.
5. **Range write API** — loop the single-interval block endpoint vs a bulk endpoint
   for "block a time across a range"; range-close via the existing wholesale list.
   Depends on 4.
6. **The boundary — what we do NOT copy** — no per-date pricing, no rule-sets, no
   multi-night bars, no listing rows. Record it so the pricing UI never creeps in;
   price stays per item in the listing editor.

## Not in this doc
- **Weekly opening hours** — they live in the listing editor (this calendar is
  dated exceptions only); moving/duplicating them here is the provider-home scope
  (`GUEST-EXPERIENCES-PROVIDER-HOME-SCOPE.md`), not this.
- **Cancelling existing bookings from the calendar** — stays in the diary; blocking a
  day deliberately never cancels a booking.
- **Class scheduling / dated classes** (`GUEST-EXPERIENCES-CLASS-SCHEDULING-SCOPE.md`)
  — declaring bookable sessions is a different surface from blocking them.
- **The exact visual design** of the cell and panel — a design pass after the
  decisions above.
