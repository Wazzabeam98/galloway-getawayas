# The provider's home and listing editor — scope

Scoping doc (GitHub issues are disabled on this repo). A guest-experience provider
today lands on a thin dashboard, and the **only** way to change their listing is to
reopen the twelve-screen sign-up wizard — `app/services/dashboard/edit/page.tsx`
redirects a guest provider straight to `/services/join?trade=…`. And when a field
doesn't fit a wizard step, it has nowhere to live: a one-off "Things to know" page
had to be built to hold three of them, and `slot_turnaround_minutes` is a live
column with no screen at all. This scopes the provider's logged-in **home** and a
real **listing editor**.

**Status: scoped, NOT started.** No code. Grounded in the current worktree plus the
Airbnb host-side capture (the account-vs-listing split), adapted to our model:
**one provider = one listing, approved by us, no co-hosts.**

## The short version

The provider already has a working **diary/inbox** — what they lack is a **home**
and an **editor**. Editing means re-running a create-flow: the wizard loads the
existing row and pre-fills (`ProviderSignUp.tsx:886-1138`), so it's an in-place
edit, but through the full stepped sign-up UI, to change one price. Two symptoms
follow directly from having no editor to hang a field on:

- **The one-off page.** Minimum age, activity level and what-to-bring had nowhere
  to go, so a separate `/services/dashboard/details` editor was built to write them
  into `guest_details` — a bolted-on page, currently **unmerged**
  (`feat/experiences-on-public-site`).
- **The dark column.** `slot_turnaround_minutes` exists, is granted, and is used in
  the booking-overlap maths — but no screen asks for it
  (`GUEST-EXPERIENCES-MASSAGE-DURATION-SCOPE.md` flags this).

Every future provider-facing field faces the same fork: become a dark column, or a
bolted-on page. **A home with a sectioned editor is the missing container** — the
thing you add a field *to*.

---

## 1. What a provider can and can't do today

The dashboard (`app/services/dashboard/page.tsx`) branches by shape into a
**request inbox** (`ProviderExperienceDashboard` — made-to-order / comes-to-you) or
a **diary** (`ProviderSlotDashboard` — slot).

**Can do (from the dashboard):**
| Capability | Shape | Where |
|---|---|---|
| Confirm / decline / refund a request | experience | `ProviderExperienceDashboard.tsx:171-316` |
| See a booked diary + how each time is filling | slot | `ProviderSlotDashboard.tsx:216-294` |
| Block a day / block part of a day | slot | `:296-346` (via `slots/schedule`, `slots/blocks`) |
| Set up Stripe payouts (gate) | both | `/api/services/connect` (`:99-115`) |
| See released guest contact + message per order | both | order threads (`:260-316`) |

**Can't do:**
- **Edit the listing** except by re-running the wizard (see §2).
- **See earnings** — no total anywhere on the dashboard (Airbnb shows "£X this
  month"; ours shows nothing).
- **See a calendar** — the diary is a list of booked times, not an availability
  calendar; **weekly hours can't be edited here at all** (wizard only).
- **Reach Messages or account settings from the home** — both are top-nav only
  (`NavMenu.tsx`); the dashboards don't link to them.
- **Put a new field anywhere** — hence the one-off page and the dark column.

---

## 2. Everything editable only through the wizard

The wizard (`ProviderSignUp.tsx`, steps in `lib/joinSteps.ts`) is the entire
editable surface of a listing. To change any one of these, a provider re-enters the
stepped sign-up:

| Step | Fields | Persists to |
|---|---|---|
| g_verify / trade | name; category | `profiles.full_name`; `service_providers.trade`, `custom_label`, `shape` |
| g_you | years experience, professional title | `guest_details` jsonb |
| g_creds | qualifications, recognition | `guest_details` jsonb |
| g_notice / g_slot_where / g_area | lead time; come-to-me vs travel; address or coverage | `lead_time_days`, `fulfilment`, `collection_*`, `service_areas` |
| g_slot_length / g_slot_hours | session length; **weekly opening hours** | `slot_length_minutes`; `slot_availability` |
| g_slot_basis / g_capacity / g_slot_min | private vs shared; max guests; min per booking | item `unit`; `slot_capacity`; `slot_min_people` |
| g_menu | items: name, price, unit, **duration**, photo, description, per-item location | `service_provider_items` |
| g_photos | gallery, logo, headshot | `photos`, `logo`, `headshot` |
| g_expect | what-to-expect, dietary | `guest_details.what_to_expect`, `dietary_note` |
| finish | terms | `declarations` |

Two things the wizard hides from the provider that an editor would make plain: the
**column-vs-`guest_details`-jsonb** split (invisible and irrelevant to them), and
the fact that **weekly hours** and **days-off** live in two different places
(wizard vs diary).

---

## 3. Everything deferred for want of a home

| Field | State today |
|---|---|
| **Turnaround between bookings** | Real column `slot_turnaround_minutes`, granted, used in overlap maths — **no editor, no wizard step. A dark column.** |
| **Travel time between locations** | Partial: per-item `fulfilment` + a frozen `service_orders.service_address` exist; **no travel-time/buffer value** is modelled or asked (`GUEST-EXPERIENCES-SLOT-LOCATION-SCOPE.md`). |
| **What to bring** | `guest_details.what_to_bring` — editor **only on the unmerged one-off page**. |
| **Activity level** | `guest_details.activity_level` — same one-off page. |
| **Minimum age** | `guest_details.min_age` — same one-off page. |
| **Itinerary / "what you'll do"** | `guest_details.what_to_expect` is the nearest and has a wizard step, but it's one paragraph — **no structured per-step itinerary** (`GUEST-EXPERIENCES-PRESENTATION-SCOPE.md`). |

The through-line: turnaround went one way (dark column), the three "things to know"
went the other (bolted-on page), and the itinerary is stuck as a paragraph. All
three are the same missing thing — an editor section to hold them.

---

## 4. The proposed shape

Airbnb splits **account** (who you are, how you're paid) from **listing** (what you
offer, when, where, for how much), with a sectioned **Listing editor** — a card
list where each section opens and saves on its own — and a unified **Calendar**.
Ours takes the split but drops the multi-listing machinery: **one provider = one
listing, so no listings grid, no listing switcher, no co-host permissions.**

- **The home (landing).** Keep the operational dashboard we already have (the
  request inbox / diary) as the home's working half, and add the two tiles Airbnb
  has and we don't: an **earnings summary** (we hold the order/payout data; we just
  show no figure) and a single, obvious **"Edit listing"** entry into the editor.
  This is the smallest change to the home — it's mostly already right.
- **The listing editor — the core of this.** Replace *wizard-as-editor* with a
  **sectioned editor** that OWNS edit: open a section, change it, save it, leave.
  Sections map onto the wizard steps **plus** the deferred fields **plus** the
  one-off "things to know", all in one place — so a new field is a new section, not
  a new page or a dark column. The wizard stays as the **first-time create** flow;
  the editor is where a live provider changes anything after approval.
- **Bookings & diary.** Already present (orders inbox, slot diary, seat-fill,
  day/partial blocks). Fold them into the home, and move **weekly-hours editing out
  of the wizard** into the editor/diary so availability lives in one place
  (weekly hours + days-off + partial blocks together).
- **Payouts & settings.** Payouts are the Stripe connection already gated on the
  dashboard — promote it to an account-level **"Payments"** area reachable from the
  home. Account/contact/notifications already exist in `app/account`; the home
  should **link** to them rather than re-implement them.

### Listing vs account — our split

| **Listing** (the one offering) | **Account** (the person) |
|---|---|
| Title/intro, category | Legal name + **first-name display** |
| The menu items (name / price / unit / duration / photo / description / per-item location) | Email, phone, **contact-release** |
| Photos, gallery | Identity + **approval status** (admin-set) |
| What-to-expect / itinerary | **Stripe payout connection** |
| Things to know (min age, activity level, what to bring) | Notifications |
| Capacity, basis, minimum | Taxes / business details |
| **Weekly availability + days-off**, session length | Language / currency |
| **Turnaround**, travel/buffer, fulfilment + address | |
| Cancellation window | |

The test is Airbnb's, even though one-provider-one-listing blurs the line: **"who
you are and how you're paid" is account; "what you offer, when, where and for how
much" is listing.** Turnaround and travel-time are operational **listing** settings;
the Stripe account, identity and approval are **account**. Because there's one
listing, we don't need Airbnb's per-listing switcher or co-host access model — the
home is one listing's editor + diary, not a portfolio.

---

## Decisions this needs, in dependency order

1. **Home vs editor.** Is the provider "home" the existing dashboard (diary/inbox)
   with an editor entry added, or a new landing? *(Recommend: keep the dashboard as
   the operational home; add the editor and the two missing tiles.)*
2. **The editor model — the pivot.** A **sectioned editor that owns edit**, with the
   wizard reduced to first-time create — vs keeping wizard-as-editor. Everything
   below hangs on this. *(Recommend: sectioned editor.)*
3. **Where the deferred fields land. DECIDED (2026-09-15):** the one-off "Things to
   know" page (`/services/dashboard/details` → min age / activity / what-to-bring)
   **stays unmerged for now.** The fields are real, but the page lives on
   `feat/experiences-on-public-site` (PR #147), which tangles **demo scaffolding
   with real product** and carries an **unapplied production reviews migration** —
   merging it now would put seed/demo decisions into master and force a real prod
   deploy mid-demo, on a branch still being pushed to. So it waits. The **editor
   absorbs these fields when it's built** (a section for min age / activity /
   what-to-bring), rather than the one-off page being merged as a permanent
   surface. The **turnaround** screen and the itinerary land the same way — editor
   sections under decision 2. Depends on 2.
4. **Availability's home.** Move **weekly-hours** editing out of the wizard into the
   editor/diary, unified with the days-off / partial blocks already there. Depends
   on 2.
5. **The listing/account boundary.** Ratify the table above; decide where payouts,
   contact and notifications live and how the home links to them (one-provider,
   one-listing makes this lighter than Airbnb's).
6. **Earnings on the home.** Add an earnings summary from the order/payout data we
   already hold. Largely independent — can land early as a quick win.
7. **The wizard's future.** Once the editor owns edit, does the wizard stay a pure
   create-flow, and does the `g_*` step-gating still drive both surfaces or only
   create? Depends on 2.

## Not in this doc
- **Dated-class scheduling** (`GUEST-EXPERIENCES-CLASS-SCHEDULING-SCOPE.md`),
  **standalone purchase** (`…-STANDALONE-PURCHASE-SCOPE.md`), **per-item location**
  (`…-SLOT-LOCATION-SCOPE.md`) and **per-treatment duration**
  (`…-MASSAGE-DURATION-SCOPE.md`) — each **adds fields the editor must host**, but
  their mechanics are scoped elsewhere. This doc is the container they land in.
- **A guest-facing itinerary/reviews** — presentation, `…-PRESENTATION-SCOPE.md`.
- **Multi-listing / co-hosts** — out of model (one provider, one listing).
- **The visual/interaction design** of the editor — a design pass, separate.
