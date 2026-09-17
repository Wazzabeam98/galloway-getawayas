# The slot provider's calendar — design

Design doc (GitHub issues are disabled on this repo). Companion to
`GUEST-EXPERIENCES-DECLARED-SESSION-BOOKING-SCOPE.md`. Records the agreed shape of
the slot provider's calendar before it's built, and why.

## The structural problem

We borrowed **Airbnb's month grid**, but Airbnb's unit is the **night** — one
state per day, so a month grid is the whole interface. **Our unit is the slot** — a
session at a time inside a day. Clicking a day therefore has to open *that day's
slots* (9am, 10am, 11am…), each showing what's booked and what's free — not a form
to type a time into. A provider wants to **see their day and manage it, not
describe it**.

Researched the appointment/class family (single-practitioner): **Fresha, Square
Appointments, Acuity, Mindbody** all lead with a **day/week time-axis** — time down
the side, bookings as blocks sitting at their time and sized by their length, a
"now" line, click empty time to add, click a block for details. The **resource
scheduler** the user has been looking at is the same, minus the staff axis: we're
one provider, so the vertical axis is **time**, not people. Airbnb's month
treatment is the right reference for the **overview** only. (Sources at the bottom.)

## Jobs to design against

1. Check what's on **today**.
2. **Block Thursday afternoon** for a dentist appointment.
3. **Add next month's classes.**
4. See **who's booked** into a session.
5. Notice **a class that isn't filling**.

## Views

Build **Month** and **Day** now. **Week** and **Agenda** come later (Week matters
for a busy provider; neither exists yet). Default **Month on desktop, Day on
mobile** — revisit if providers routinely run several sessions a day.

### Month — the overview

Each cell shows the **day's shape at a glance**, never one truncated time chip:

- A **tick strip** — one small tick per slot in the day, in time order, coloured by
  state (booked = emerald, private hire = solid emerald, declared class = violet
  with a fill notch, blocked = grey hatch, free = light). Three sessions a day → 3
  ticks; a 9–5 hour grid → 8 ticks. You read "full / one gap / empty / something
  blocked" instantly.
- A **count** under it — e.g. "5 booked · 2 free", or "Day off".
- Today ringed, past dimmed with a struck number, a day off hatched across the
  whole cell.

Clicking a day opens the **Day view** for that date. Month answers *which days are
filling, which are empty, what next month looks like* — and scales: the strip stays
legible whether a day holds three ticks or eight, and you page months for range.

### Day — the workhorse

A **time-axis** for the chosen day: the hours down the left (open→close, extended
to cover any out-of-hours session or block), and each slot as a block at its time,
its height ~ its length so a 90-minute class visibly spans more than an hour slot.

- **Free slot** — a light, outlined block, "10:00 · free". Click it to **add a
  session** there (the builder opens with the time filled in) or **block** it.
- **Booked shared session** — emerald, "10:00 · 3 of 8 · 5 left" with a fill bar.
  Click → the guests in it + Call / Email / Cancel & refund.
- **Private hire** — the one that needed working out: it takes **one hour out of the
  day, not the day**. It's a solid emerald block at its time, "11:00 · Private ·
  Aisha, party of 3", sized to its length — one slot filled whole, exactly like a
  booking, never a day-level block. On the month it's one solid tick among the
  day's ticks.
- **Declared class** — violet (provider-created), same occupancy fill: "18:00 ·
  Sunset class · 4 of 8". A low fill with the date approaching earns a quiet
  "filling slowly" cue (job 5). Click → its guests, or Remove while empty.
- **Block** — a neutral **hatched band** across its span, "13:00–17:00 · blocked",
  visibly occupying those hours and nothing else. Never emerald (not a booking),
  never the whole day. Click → remove it.
- **Day off** — the whole day reads as off, with Reopen.

So the three states never collide: **colour + fill = something's happening, hatch =
closed, light = free.** No legend — the day is self-evident.

**Interactions (drag is a follow-up):** click a free slot → add there; a part-day
block uses a from–to control in the day header (and clicking a free slot offers
"block this time"); "Day off" toggles the whole day; clicking a booking → its
detail; clicking a block → remove. Adding next month's classes still uses the
**multi-day builder** from the Month view (select several days → add sessions to
all), so a monthly class is one action, not one per date.

## The hard day (8 one-hour slots 9–5: 3 booked, 1 private hire, 1 blocked, 1 class half-full, 2 free)

Day view, top to bottom: **9** free · **10** booked 6/8 · **11** Private — Aisha ×3
(solid) · **12** free · **13–14** blocked (hatched, "dentist") · **14** booked 8/8
full · **15** Sunset class 4/8 (violet, "filling slowly") · **16** booked 2/8. Every
job is one glance and one click. The month cell for that day: eight ticks (3
emerald, 1 solid, 1 violet-half, 1 hatch, 2 light) + "5 booked · 2 free".

## Mobile

Not the desktop shrunk. Default **Day**. A **week strip** of seven day-chips (each
carrying its shape as dots) sits on top; tap or swipe to change day. **Month** is a
full-screen overview reached from the view toggle; tap a day → back to Day. Tapping
a session opens its bookings as a **bottom sheet**; tapping a free time opens the
add sheet. Same jobs, phone-native.

## What this changes vs today

Today's month-grid-plus-rails becomes: **Month** (reworked tick-strip cells) as the
default overview, a **Day** time-axis as the working surface behind it, the builder
reached by clicking a free time (or multi-day in Month for bulk), blocks by the
from–to control (drag later), and booking detail as a rail (desktop) or sheet
(mobile). `SlotCalendar` keeps the month grid; the Day view is new; the dashboard
owns the view toggle and the shared slot-shaping (generate open-hours slots for a
date, overlay booked sessions, declared sessions and blocks) used by both Month
ticks and the Day timeline.

## Decisions taken

- Build **Day + Month** first; Week + Agenda later.
- Default **Month desktop / Day mobile**.
- **Click a free time to add, click a block to manage**; drag-to-create is a
  follow-up.
- A **private hire is one slot**, rendered at its time, never a day block.

## Not in this doc

- **Week and Agenda views** — later.
- **Drag-to-create / drag-to-move** — a follow-up nicety.
- **The guest-side booking** of declared sessions — that's
  `GUEST-EXPERIENCES-DECLARED-SESSION-BOOKING-SCOPE.md` (piece 3).
- **Proportional-height edge cases** (overlapping blocks of odd lengths) — the data
  rarely produces them (declared sessions reserve their interval); handled simply.

## Sources

Fresha calendar (day/week/month, "now" line, click-to-add):
https://www.fresha.com/help-center/knowledge-base/calendar ·
https://www.fresha.com/help-center/knowledge-base/calendar/16-manage-your-calendar-display-settings- ·
Square Appointments (block time as an event on the day):
https://squareup.com/help/us/en/article/5349-schedule-and-accept-appointments ·
Acuity (day view, blocked time, click a block for details):
https://help.acuityscheduling.com/hc/en-us/articles/16676934756109-Managing-your-schedule ·
Mindbody (class capacity / spots-left / waitlist):
https://www.mindbodyonline.com/business/scheduling ·
Airbnb host calendar (month, struck blocked nights, tap-swipe a range):
https://www.airbnb.com/help/article/447
