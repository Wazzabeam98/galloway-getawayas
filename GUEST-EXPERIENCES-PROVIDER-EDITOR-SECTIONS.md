# The provider listing editor — sections & build decisions

Companion to `GUEST-EXPERIENCES-PROVIDER-HOME-SCOPE.md` (on `docs/provider-home-and-editor-scope`).
That doc ratified the **sectioned editor that owns edit**, with the wizard reduced to
first-time create. This one records the **agreed section list, the field
classification, and the decisions taken to build it** (2026-09-15).

**Model:** one provider = one listing, approved once by us, no co-hosts. Once
approved a provider **edits freely — no pending state, no approval queue, changes
go live immediately.** Approval is one-time.

---

## Editor anatomy — what carries over from the holiday-let editor

The holiday-let editor (`app/edit-listing/[id]/page.tsx`) is the model, and it
already embodies "approved once, edit freely": it never gates a save on re-review,
it only blocks a save that would **newly** break a publish rule (grandfathering
everything older), and its "below what a new listing needs" panel **blocks
nothing**.

**Carries over:** the section sidebar + content panel; load-row → prefill → edit in
place; grandfathering / advisory-not-gate; an embedded read-only **guest preview**
(the holiday-let editor renders `GuestBookableHere`; ours renders the real public
listing `ExperienceListingBody`, with each block linking to its editor section);
the Photos machinery (client-side compress, drag-reorder, cover star); and the
**sub-widgets that save on their own secure routes** (`LockboxCode`,
`ArrivalEditor`, `IcalFeeds`) — the precedent for per-section save.

**Drops / changes (one provider · one listing · no co-hosts):** no listings grid or
switcher; no co-host permission path (`can_listing`) and no owner-moderation branch;
**one-Save-at-the-bottom → per-section Save** (each section its own form + Save,
generalising the sub-widget pattern); and a **provider save route** (writing
`service_providers` + `guest_details` + child tables, service-role with an ownership
check) instead of `/api/listings/save` — needed because several columns aren't
owner-writable.

---

## The sections (9)

Each opens, edits and **saves on its own**. ✅ already in the DB · 🆕 new capture.

| # | Section | Holds | Source |
|---|---|---|---|
| 1 | **Title & category** | `business_name` (title/intro), category (`trade` / `custom_label`) | ✅ columns |
| 2 | **About you** | professional title, years, qualifications, recognition | ✅ `guest_details` keys |
| 3 | **Photos** | gallery `photos[]`, headshot, logo | ✅ columns |
| 4 | **What you offer** | menu items (name / price / unit / duration / photo / description / per-item location); group size (`slot_capacity`), min per booking (`slot_min_people`), basis (derived from unit + capacity) | ✅ `service_provider_items` + cols |
| 5 | **What happens** | walk-through paragraph (`what_to_expect`) + structured itinerary | ✅ paragraph · 🆕 `guest_details.itinerary` |
| 6 | **Things to know** | minimum age, activity level, what to bring | 🆕 `guest_details.min_age` / `.activity_level` / `.what_to_bring` |
| 7 | **Food & dietary** *(food categories only)* | `dietary_note`, `dietary_options` | ✅ col + key |
| 8 | **Where it happens** | `fulfilment` (come-to-me / travel / both), private venue address (`collection_*`), coverage regions (`service_areas`) | ✅ columns |
| 9 | **Availability** *(slot shape only)* | session length, weekly hours, turnaround; **lead time + cancellation window**; links into the diary for dated days-off / partial blocks | ✅ columns (turnaround was a dark column) |

Plus a **Listing status** control (take down / put back — see below); small enough
to sit in the editor header rather than as a tenth section.

**Booking & cancellation folded into Availability** (decision): lead time and
cancellation window are both "when people book". **Food & dietary kept separate.**

**Account side — linked from the home, not in the editor:** legal name +
first-name-display toggle, email / phone + contact-release, Stripe payouts, approval
status (admin-set, read-only), notifications. These already live in `app/account`
and the dashboard's Stripe gate.

---

## The homeless fields — resolved

| Field | Was | Now |
|---|---|---|
| Turnaround between bookings | `slot_turnaround_minutes` column, used in overlap maths, **no screen** | **Screen only**, in Availability. Saved via the provider route (not owner-writable). No migration. |
| Minimum age | nothing | 🆕 `guest_details.min_age` — no migration (jsonb) |
| Activity level | nothing | 🆕 `guest_details.activity_level` — no migration |
| What to bring | nothing | 🆕 `guest_details.what_to_bring` — no migration |
| Itinerary | `what_to_expect` paragraph only | 🆕 `guest_details.itinerary` (array) — no migration; paragraph stays |
| **Travel time between locations** | not modelled | **Dropped** — not asked for, a profile setting not a listing one. Not built. |

Capturing the 🆕 `guest_details` keys is in scope; **displaying** min-age / activity /
what-to-bring / itinerary to guests is the presentation scope
(`GUEST-EXPERIENCES-PRESENTATION-SCOPE.md`), not this editor.

**Only one migration for the whole editor (test-only): the take-down flag.**

---

## Availability's one home

- **Weekly template** (session length, weekly hours, turnaround, lead time,
  cancellation window) → the editor's **Availability** section. Removed from the
  wizard.
- **Dated exceptions** (a specific day off, a part-day block) → stay in the
  **diary** (an operational act, not a listing edit).
- One implementation of the weekly-hours control, surfaced from both. No unified
  Airbnb-style calendar.

---

## Take the listing down / put it back

- **Mechanism:** a new `owner_paused boolean` on `service_providers`, consulted in
  `isLiveToGuests`, toggled by the provider through the provider route. Isolated
  from the admin `status` machine, so **coming back needs no re-approval**. (Not a
  new `status` value — that constraint is leaned on by the admin console.)
- **Behaviour:** paused **hides the listing from discovery and stops new bookings**;
  **already-confirmed bookings stand** — they're commitments, stay in the diary, and
  are honoured. (Not: cancel/refund forward bookings.)
- **Migration:** add the column, add it to the owner insert/update allow-list, and
  record its SELECT-grant decision. **Test-only.**

---

## Two guards the editor must carry (a delete must not silently unlist)

The marketplace filters on two things; the editor must warn before an edit trips
either, because today the wizard's submit gate catches them but an in-place editor
would not:

1. **Last photo.** The homepage and both marketplace grids filter on `!!hero`
   (`components/HomeExperiences.tsx`, `app/experiences/browse/page.tsx`,
   `components/marketplace/StayBookableGrid.tsx`). Removing the last photo makes a
   provider **vanish from every grid**. The Photos section says so before the delete.
2. **Last priced item.** `submitProblems` refuses a submit with no priced item, and
   `shapeProviders` drops a provider with none (`if (!items.length) continue`). The
   "What you offer" section warns before removing the last priced item — a delete
   must not quietly unlist someone.

Neither hard-blocks (a provider may be mid-edit); both say plainly what the change
does, in the spirit of the holiday-let "below standard" advisory.

---

## What the wizard stops owning (create-only afterwards)

The pivot is that **editing of every listing field moves to the editor**. The wizard
keeps *asking* everything at create (it is the create flow) but is **never entered
for an edit** again:

- **Edit entry point repointed.** `app/services/dashboard/edit/page.tsx` currently
  redirects a guest provider to `/services/join?trade=…` (the wizard, in edit mode).
  It will point to the new editor instead. That alone removes the "resubmit" path
  where the wizard overwrites the row.
- **Weekly hours leave the wizard entirely** — the one field with a genuine
  two-source problem (the wizard *and* the diary both write `slot_availability`
  today). Removed from the wizard: the `g_slot_hours` step
  (`lib/joinSteps.ts`), the `guestScheduleRows()` write (`ProviderSignUp.tsx`), and
  the `scheduleCount` submit-gate in `submitProblems` (`lib/serviceProviders.ts`).
  A new slot provider now sets hours in the editor after create; until they do, they
  generate no sessions and don't appear — surfaced by the editor's missing-hours
  prompt, not a silent gap.

**After this, the wizard is create-only:** it runs only for a provider with no
approved row; every post-approval change is the editor's. No field is written by
both surfaces.
