# Morning — the overnight build

Branch: **`overnight/guest-experiences`** (off `trips-card-polish`, which already
carries PR #98). Nothing merged to master, nothing deployed to production, no
production migration. Everything below is on the preview.

**Preview URL:** _(filled in once the deploy is green — see the end)_
**Sign-ins** (all password `market-demo-2026`):
- **Guest:** `morag@gallowaymarket.test` — has a cottage booking near Kirkcudbright (19–26 Sep) with experiences to browse and book.
- **Provider:** `sauna@gallowaymarket.test` (a slot — the diary dashboard), or any of `bakehouse@`, `hamper@`, `chef@`, `photographer@`, `swim@`, `whisky@`, `yoga@` `@gallowaymarket.test`.
- **Host:** _(see the URL list — the cottage owner login)_

---

## Walk this (one line each)

_(URL list filled in with the preview host once deployed. The paths:)_

| Path | What you're looking at |
|---|---|
| `/business` | The front door — two cards, redrawn. Tradesman vs guest experiences. |
| `/services/join?trade=guest` | The guest sign-up. Pick a category → answer one plain question → the fields adapt (a menu for a chef, a schedule for a sauna). This is the big one. |
| `/experiences/<Morag's booking>` | The marketplace as Morag sees it — slate, headshots, "New here"/booked counts, shape cues. |
| `/experiences/<booking>/<provider>` | A provider listing page. On a phone, the fixed "Book · £X" bar. |
| `/experiences/order/<order>?booked=1` | The new post-booking confirmation (what happens next + add-to-calendar). |
| `/experiences/requested?p=<provider>` | The "request sent — held, not charged" moment for a chef/baker. |
| `/trips` and `/arrival/<booking>` | The rebuilt check-in/checkout rail (was two big boxes). |
| `/services/dashboard` (as a provider) | The chef's inbox — the email now deep-links to the exact request. |

---

## What got built (in the order you asked)

1. **`/business`** — the PR #77 fork, made to look like something: icon medallions, real CTAs, tick-lists, a soft hero. Not rebuilt, polished.
2. **Guest category picker** — the guest's version of the tradesman grid. Nine categories chosen for D&G (below), "Something else" last, leading to the generic template. It also **deletes the branch-reset bug** you flagged: the trade step is now audience-aware, so a guest never sees the tradesman trades under a "Guest experience" header.
3. **Adaptive sign-up (§10)** — one plain question ("how do guests get what you offer?") infers the shape; only the fields that apply then show. Nobody sees the words shape, unit or capacity.
4. **Schedule editor** — private/shared, capacity, session length, weekly opening hours, block-a-date. A sauna owner can finally say "Tue–Sat, 10–6".
5. **"Your business" desktop layout** — wider two-column modal (phone unchanged), grouped into three, "Your name" moved up beside the business name, item row given labels + a bigger photo well, and the food question made conditional in *logic* (food categories only), not just wording.
6. **Display-name recommendation** — I did **not** build a toggle. See the section below.
7. **Marketplace** — themed slate to match the app; a trust signal on every card (headshot + name + a booked-count or an honest "New here"); a fixed mobile "Book · £X" bar.
8. **Post-booking** — a real confirmation page for slots (what-happens-next + add-to-calendar) and a "request sent" page for held requests, instead of a banner on /trips. The slot receipt email already existed (your note was stale) — I improved its link.
9. **Chef "View the request" email** — now deep-links to the exact request on the dashboard (which highlights it), not the inbox (and, before the earlier fix, the trade picker).
10. **Cottage-cancel cascade** — proven, and it turned up a real bug: it refunded a slot order but never gave the seat back, so the session read as full for the next guest. Fixed + tested.
11. **Baker vs chef** — a cake is no longer "£45 · 2 guests · 21 Sep". The date is framed by shape (appointment / "Ready for" / date-and-time) and the headcount is dropped where nobody attends.
12. **PR #98 fixes** — the `balance_due_date` BST-a-day-early bug (day-key treatment, proven failing first) and the order-page address select (real columns, error handled, `as any` gone).
13. **Address required** — a listing now needs a street address to publish. **Read the flag below first** — 4 of your 5 live listings would fail it.
14. **Trips card / Getting there** — the check-in/checkout rail, half the height, carrying the dates the boxes never did.

---

## The categories I chose, and why

Dumfries & Galloway is a rural coast-and-forest region — the Solway, the Galloway
Forest and its dark skies, the Kirkcudbright artists' town, food and drink
producers. So the nine (eight + "Something else"):

- **Private chef & catering** — dinners at the cottage, grazing tables (comes to you)
- **Cakes & baking** — celebration cakes, tray bakes (made for a date)
- **Hampers & local produce** — welcome hampers, fresh fish, veg boxes (made for a date)
- **Drinks & tastings** — whisky, gin, wine (a slot)
- **Guided outdoors** — walks, wild swimming, fishing, foraging, dark skies (a slot)
- **On the water** — kayaking, paddleboarding, boat trips (a slot)
- **Wellness & spa** — massage, sauna, yoga (a slot)
- **Arts & crafts** — pottery, painting, workshops (a slot)
- **Something else** — the generic template, for anything the eight don't cover

Each carries a *hint* of its usual shape (to pre-select the plain question) and a
*food* flag (to show the "what can you cater for?" field only to food trades).
Both are a starting point — you still confirm the category, MCC and shape at
review, exactly as before. Photography folds into "Something else" for now; say
the word and it becomes its own tile.

---

## Display-name option — my recommendation (not built, as you asked)

**Short version: don't add a provider toggle. Providers already control their
displayed name by typing it.**

- `profiles.show_full_name` is a **guest/host** setting, and it *is* honoured —
  `displayName()` in `lib/utils.ts` reads it: a preferred name wins, else the
  full name unless `show_full_name` is false, else "Host". The one production
  account that set it false shows as "Host" on its listing today. (So "nothing
  honours it" isn't quite right — it's honoured for the host path. What has no
  code path is a *provider* honouring it, and that's the point below.)
- A **provider's** name on the marketplace is a *different field* —
  `service_providers.provider_name`, free text the provider types ("Rosa"). They
  already choose exactly what a guest sees: a first name, or nothing. A boolean
  toggle would be redundant, and reusing the profiles one would read the account
  *owner's* setting — a different person-concept from the business's public name.
- **The card with a name hidden:** if `provider_name` is blank, the card falls
  back to the business name + the "a short line about you" + the headshot. The
  guest still sees a face and a business, just not a personal name. Given the
  section exists to tell a guest who's walking into their cottage, a fully hidden
  name weakens that — so rather than a hide switch, the sign-up nudges a first
  name (the field is right there, placeholder "Rosa"). My recommendation: **keep
  it a free-text field, no toggle; if you ever want "hide my surname", store a
  `provider_name` that's a first name — which is already what happens.**

---

## ⚠️ Flag: the address rule and your live listings

I checked production read-only before tightening the "street address required"
rule. **Of 5 live listings, 4 have neither a street address nor a postcode** —
they predate the rules or went live through the old direct-publish bypass:

- 4 bedroom Townhouse, Kirkcudbright (published)
- Modern 3 Bedroom, Kirkcudbright (published)
- Modern Cottage, with Hot Tub (published)
- TEST TEST TEST (hidden)

The rule runs **at publish time**, so it does **not** unpublish them — but those
hosts will be **blocked from re-publishing** until they add an address. That's
also true of the *existing* postcode rule, which they already don't meet, so
this is a pre-existing gap the new rule surfaces rather than causes. **Your call:**
backfill those four addresses, or leave them and accept they can't re-publish
until someone adds one. `scripts/_check-listing-addresses.mjs` re-runs the check.

---

## Honest cut list (what I did NOT do)

- **The full 3-widths screenshot-every-step + email round-trip walk:** I walked
  the fresh-applicant path (category → business for both a chef and a slot →
  through to the account/email step) and screenshotted the key screens at desktop
  and 375px, and the whole flow type-checks and renders. I did **not** click a
  real emailed link end-to-end (that needs a live inbox); the `/finish` route
  that materialises the application — including the new shape/schedule rows — is
  wired and reviewed, but wants one manual fresh sign-up on the preview to be
  called fully proven. It's the flow that must not break, so please do that walk.
- **Collection-vs-delivery as structured data** on a made-to-order booking: I
  framed the booking note to capture it in words (size, message, collection or
  delivery) rather than adding a column tonight. A small follow-up.
- **Provider reviews / stars:** there's no reviews table, so the trust signal is
  the honest booked-count / "New here" — not fake stars. Reviews are the real
  next step there.

See `OVERNIGHT-PROGRESS.md` for the commit-by-commit log.
