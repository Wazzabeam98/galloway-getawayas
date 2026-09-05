# Overnight run — night of 2026-09-04

**Rules honoured:** built on branches only; previews deployed; **no merge to master, no production deploy, no production migration.** Any migration is applied to **test** only.

**Branches:** `overnight/marketplace-and-card` (fixes), plus per-option preview branches noted below.

This file is written as I go, so it's complete even if I don't finish everything. Each section ends with **three ways a real person could break it.**

---

## Status board

1. Marketplace stalls — category / "1 left" / time grid / instant-vs-hold / allergy — **fixes built (3 of 5); 2 need your call**
2. Experiences entry below the fold — two placement options — **built as ?exp= toggle; recommend Option B**
3. Provider sign-up walk (fresh sauna owner, incl. emailed link) — **walked; empty-calendar gap confirmed structural**
4. Trip card gaps — **rating added; house-rules-on-finished fixed; cancelled/deposit edge cases flagged**
5. Republish a live listing with no street address — **clear on publish, SILENT on edit/save + un-hide**

---

## 1 · Marketplace stalls

**Category — "LOCAL EXPERIENCE" on everything → FIXED (code).** `guestCategory()` (lib/serviceProviders.ts) now falls back to a short, guest-facing word derived from the provider's `stripe_mcc` when the free-text `custom_label` was left blank at review. The MCC is a hard visibility gate, so every visible provider has one. Chef → "Private chef", baker → "Bakery", photographer → "Photography", florist → "Florist", etc. A hand-typed `custom_label` still wins.
- **Your call:** MCC `7997` ("Clubs, activities & recreation") covers sauna, whisky tasting, general recreation — they all read "Activity". Distinguishing them without a hand-typed label would need finer sub-categories. Fine to leave, or I add them.

**"1 left" false scarcity → FIXED (code).** The count now shows only for a **shared** session that's genuinely low (`capacity > 1 && seatsLeft ≤ 2`). A whole-hire session (capacity 1, the sauna) no longer shows "1 left" on every slot.

**Time grid, a wall of 56 → FIXED (code).** The slot picker is now **pick-a-day** (a row of day pills) then that day's times — never every day's slots at once.

**Instant vs 48-hour hold looked the same → FIXED (code).** A badge at the top of the panel now says it plainly: emerald **"Instant book — confirmed straight away"** vs amber **"Request — {host} has 48 hours to confirm"**, on top of the existing button label and reassurance line.

**Allergy — a guest commits and waits → YOUR CALL.** Today: for a food *request*, the card is **held, not charged**, until the chef confirms (nothing taken if they decline), and the provider page shows the host's `dietary_note` if they set one. The gap is the guest getting *certainty before committing*. Options, both product decisions:
- (a) Make the allergy field **required** for food, and have chefs **declare the allergens they can handle** at review — shown on the card upfront.
- (b) A pre-book "can you cater for X?" message step before payment auth.
I've not built either — they change the booking contract and want your steer.

**Three ways a real person could break it:**
1. Two providers on the same generic MCC (7997/7999 → "Activity") still read identically — only a hand-typed `custom_label` tells a sauna from a tasting.
2. A provider assigned an MCC outside the map falls back to "Local experience" again (shouldn't happen with the current assignable list, but a new code would).
3. A provider available most days shows a long horizontal row of day pills; on a phone a guest may not scroll far enough right to see later days.

---

## 2 · Experiences entry below the fold — two placements

Built as a `?exp=` toggle on the trip card so both can be compared on one preview (the card is unchanged with no param; this is a proposal, not shipped). The promoted entry is a compact banner: **"Make more of your stay near {town} — chefs, bakers, saunas and guided walks · →"** linking to the marketplace.

- **Option A — `?exp=top`:** directly under the facts row, above Getting in. Maximum visibility; it's the first thing after the booking summary. Trade-off: it sits above the access code, the one thing a returning guest opens the card for.
- **Option B — `?exp=arrival`:** right after the arrival essentials (access code, where, times, parking), before the house rules. Still well above the fold, but it doesn't compete with the primary task — the guest gets their way in first, then "make more of your stay".

**My recommendation: Option B.** It converts without getting in front of the access code, and it reads as a natural next step once arrival is sorted. Whichever you pick, the existing bottom panel would fold down to just "Booked for your stay" (the browse teaser moves up into this entry) so there's one entry, not two.

**Three ways a real person could break it:**
1. With the entry at the top (A), a guest in a hurry for their door code taps it by mistake and lands in the shop instead of their access screen.
2. A guest with experiences already booked sees the promo banner AND the "Booked for your stay" list — until the bottom teaser is folded down, it reads as two competing calls.
3. On a stay with the marketplace flag OFF (production today), the entry must not render at all — if it ever shows with nothing behind it, it's a dead end.

---

## 3 · Provider sign-up as a fresh sauna owner

Flow: `/services/join` (stepped modal) → steps **Trade → Business → Credentials → Prices → Finish** (from `lib/joinSteps.ts`) → emailed finish link → `/services/join/finish/[token]` → `/services/dashboard`.

**The empty-calendar gap is real and structural.** The step model (`ALL_STEPS`) has **no availability/schedule step**. A guest slot provider's weekly hours ARE collectable (there's a `schedule` state and an `availability` collapsible block in `ProviderSignUp`), but it's a block a provider can leave unopened, not a step they're walked through, and nothing in the step model makes an empty schedule a blocking problem. So a sauna owner can finish sign-up with no `slot_availability` rows → `generateSessions` yields nothing → the grid drops them (a slot provider with no future session is filtered out) → **they're invisible and never told why.**

Where a real person stalls or gives up, in order:
1. **The "Trade" step is trade-shaped, not experience-shaped.** The default trade is `sponge` (a cleaning trade) and the model carries trade concepts (registration/gas credentials, building type, panes). A sauna owner has to work out which tile is "them"; the guest-experience-tailored sign-up ("branch by audience", one page) is designed-not-built per your own notes.
2. **The schedule is a collapsible block, not a step.** A slot provider who doesn't open "availability" finishes with an empty calendar. This is the single highest-leverage fix: make availability a **required step for slot shapes**, or block Finish when a slot provider has zero hours.
3. **Finish → dashboard with no "set your hours" prompt.** After the emailed link, a slot provider lands on the dashboard; the schedule editor is there (`ProviderSlotDashboard` → `/api/services/slots/schedule`) but nothing pulls them to it. A first-run "You have no hours yet — add them so guests can book" call-to-action would close the loop.
4. **The emailed link is the drop-off cliff.** Sign-up pauses for an email verification; every provider who doesn't click through is lost silently (there's a `ResendLink`/`resend-verification` path, but only if they come back).

**Recommended (needs your steer, not built): make availability a required step for `shape==='slot'`**, and add a first-login "add your hours" prompt on the slot dashboard. Both change the sign-up contract.

**Three ways a real person could break it:**
1. A sauna owner opens the availability block, adds no rows, and Finishes — empty calendar, invisible, no error.
2. They add hours only for days that fall outside every guest's stay window during the demo period → they appear to no one and assume the marketplace is broken.
3. They pick a trade tile that maps to a non-guest audience → they land in the trades flow (credentials/building type) that doesn't fit and abandon.

---

## 4 · Trip card gaps

### 4a — No rating on the card → FIXED (code)
The card now shows **★ {avg} · {n} reviews** in the header (once the listing has a public score, ≥3 reviews, the same bar the listing page uses), linking to the listing's reviews. Below 3 reviews it shows nothing (rather than a misleading number).

### 4b — Payment breakdown / confirmation / policy across booking states
Walked each state against the card's gates (`upcomingConfirmed` = confirmed && not-past; `isCompleted` = confirmed && past):

- **Deposit booking (confirmed, `deposit_paid`, balance > 0):** correct. Facts show Total + "Show breakdown"; the breakdown shows Accommodation/cleaning/Total/**Paid so far**/**Still to pay · due {date}**; the amber "Pay the balance now" block shows; the cancellation position is right. No break.
- **Cancelled booking:** the arrival panel, house rules, the cancel control and the balance block all correctly hide. **But** the facts row still shows **Total £X + "Show breakdown"** with "Paid so far / Refunded", as a bare record — there's no explicit "This booking was cancelled — £X refunded" line, so "Total £480" on a dead booking can read as money owed. Not broken, but thin; worth a one-line cancelled/refunded summary.
- **Finished (past) stay:** was showing **house rules on a stay that's already over** — pointless. **FIXED** by gating house rules on `upcomingConfirmed` (confirmed + paid + not-past) instead of just confirmed+paid. Everything else on a finished card (facts, rating, "Leave a review") is correct.

Confirmation number and the derived policy line are state-safe (the policy line lives inside the cancel block, which only shows for a live, cancellable booking).

**Three ways a real person could break it:**
1. A guest looks at a **cancelled** booking, sees "Total £480 · Show breakdown", and thinks they still owe it.
2. A **deposit** booking whose `balance_due_date` has passed still says "Still to pay · due {past date}" — reads as overdue with no "now overdue / taken automatically" nuance.
3. A stay **checking out today** flips from upcomingConfirmed to past at London midnight — house rules and the arrival panel vanish mid-checkout-day, which a guest still on-site might miss.

---

## 5 · Republish a live listing with no street address

The required-address rule (`addressBlockerForPublish`, lib/listingRules.ts) returns a **clear message** — *"Add the street address before publishing — a booked guest needs somewhere to be sent."* — and the **publish** route returns it as a `400 {ok:false, error}`. So a genuine (re)publish is caught clearly.

**But the common edit path is a silent pass.** The editor's "Save changes" calls `/api/listings/save` (app/edit-listing/[id]/page.tsx:535), and **save does not enforce the rule**. The **visibility** (hide/un-hide) route doesn't either. So for your three grandfathered live listings with no address:
- Edit fields → **Save changes** → succeeds, no message, listing stays live and address-less. The rule never fires.
- Hide then un-hide → succeeds, no message.
- Only if the listing goes back through **publish** (a fresh publish, or re-publishing from draft) does the clear message appear.

**What a host who doesn't know the rule experiences:** nothing. They edit and save as normal; there's no prompt to add an address, and the address-less listing stays bookable. The rule protects *new* publishes but leaves the existing address-less listings untouched on the edit path — a silent gap, not a silent failure of a shown message.

**Recommended (your call):** either run `addressBlockerForPublish` in `save` when the row is/stays `published` (hard block — but this will surface those 3 listings and may trip the tests your morning notes flagged), or a **non-blocking banner in the editor** for a published address-less listing ("Add a street address — guests can't be sent to this cottage") that nudges without breaking save. The banner is the gentler fix; the hard block is the guarantee.

**Three ways a real person could break it:**
1. A host edits a grandfathered address-less listing for months, saving each time, and is never told it has no address a guest can be sent to.
2. A host adds a street address but a malformed postcode — `save` accepts it silently (only `publish` runs the `UK_POSTCODE` check), so the bad postcode sits live until a re-publish.
3. A host un-hides an address-less listing (visibility route, no check) and it goes live with nowhere to send a guest.

---

## Built this run (branch `overnight/marketplace-and-card`, preview only)
- Marketplace: MCC-derived category fallback; "1 left" hidden on whole-hire; pick-a-day slot step; instant/request badge.
- Trip card: cottage rating in the header; house rules gated to upcoming (not finished) stays; experiences-entry placement toggle (`?exp=top|arrival`).
- **Not built (need your decision):** allergy guarantee; finer categories for generic MCCs; availability-required sign-up step + slot first-run prompt; cancelled-booking refund summary; deposit overdue wording; address rule on the save/edit path.

**Nothing merged, nothing on production, no production migration.** Demo data (marketplace + reviews + the windowed trip) is on **test** and comes out with:
`LISTING=<cottage> node scripts/_seed-reviews.mjs --reset` · `node scripts/seed-marketplace.mjs --reset` · then delete the branch + its GUEST_EXPERIENCES_OPEN flag.

---

# Follow-up (2026-09-05): builds + the live sign-up walk

## Live provider sign-up walk — corrected (2026-09-05)

**RETRACTED:** my first write-up said "a sauna owner can't sign up — `/services/join` offers only trades." That was wrong. I reached `/services/join` **directly**, which is by design the trades branch of the flow. The public fork is at **`/business`**: "Get work from holiday lets" → `/services/join`, "Sell guest experiences" → `/services/join?trade=guest`. Both work; Liam has walked them. There is no dead end for an experience provider *when they enter through `/business`*.

**The real bug, once I looked for it (per Liam):** several links back into the flow point at **bare `/services/join`** with no `?trade=`. Because the join page's existing-provider resume keys on `?trade=` (`.eq('trade', tradeFromUrl)`), a bare link shows the **trades grid** and resumes nothing — and the trades grid has no guest option, so an *experience* provider following one is dropped into a page that isn't theirs and can't get back to their own record. Every one of these is reachable by a guest provider:

| Link | Was | Now |
|---|---|---|
| Admin decision emails ×4 (approve / decline / changes) | bare | `?trade=provider.trade` |
| Stripe Connect refresh + return URLs | bare | carry `?trade=` |
| "You already have an account" apply email | bare | carry `?trade=` (added `trade` to the apply select + email helper) |
| Finish page — "already claimed → Sign in" | bare | `?trade=application.trade` |
| `FinishForm` post-finish redirect | bare `?finished=1` | `?trade=…&finished=1` |
| `removeDraft` (undo a wrong pick) | bare | guest → `?trade=guest`, trade → grid |
| Dashboard "No business here yet → List your business" | bare | **`/business`** (fresh start, no known audience → the fork) |
| Finish page — "link not recognised → Set up a business" | bare | **`/business`** (fresh start) |

Two of them are *fresh starts* with no known audience, so they correctly go to the fork `/business`, not to a trade-keyed join. The rest carry the provider's own trade so the flow **resumes** their record instead of showing the grid. Nav/footer were already clean — the footer's "Set up a business" points at `/business`.

**Three ways a real person could still break it:**
1. A brand-new experience provider who is handed a bare `/services/join` link *from outside the site* (a forwarded old email pre-dating this fix, a bookmark) still lands on the trades grid. The fix covers every link we generate from here on; it can't reach links already in someone's inbox.
2. Someone reaches the guest flow, fills it, then closes the tab on the "check your email" step and never clicks the link — the finish/email drop-off is common to every provider and still worth a "we've emailed you — didn't arrive? resend" screen state.
3. A provider whose `trade` value is somehow blank (bad seed / hand-created row) gets `?trade=` empty and still sees the grid — the `|| ''` guards against a crash, not against a missing trade upstream.

## Built this follow-up (branch `overnight/marketplace-and-card`, preview only)

- **Address rule gap closed for everyone else.** Editor shows a non-blocking amber banner when a live listing has no street address or postcode ("This listing is live but has no street address… Add it under Location"), with a jump to the Location section. **Save is never blocked.** The **un-hide** path now enforces the address rule (going live is a publish); **hiding is never blocked.** Test `hiding and un-hiding a live listing still works` updated to the new intent (fixture has an address) + a new case asserts un-hiding an address-less listing is refused and hiding still works.
- **Availability required for slot sign-up.** `submitProblems` now flags a guest slot provider with no weekly hours (field `availability` → the Business step), so Finish is blocked and the availability block opens on the jump. Plus a **first-login prompt** on the slot dashboard ("You have no bookable hours yet — Add your weekly hours") for anyone who reaches it empty.
- **Allergies (guest side).** Common-allergen **tick-box chips** (Nuts, Peanuts, Gluten, Dairy, Eggs, Fish, Shellfish, Soya, Sesame) at the point of booking, combined with the free-text field into one line the provider reads. The chef-declares-what-they-handle side is left until you have a real chef.
- **Cancelled + overdue-deposit states.** A cancelled booking now shows **"Cancelled — £X refunded"** (or "No refund due" / "Nothing was paid") instead of "Total £X · Show breakdown" that read as a bill. A deposit past its due date reads **"overdue"** and "This was due on {date} and is taken automatically — pay now to settle it", not a future "due {past date}".

- **Trade-aware links back into `/services/join`** (the table above) — every link an experience provider can follow now resumes their record instead of the trades grid.
- **`/business` trades card reworded — PLACEHOLDER pending your pick.** Currently reads "Get work from holiday lets" (option A below). Guest card untouched.

### Trades card wording — pick one of each (guest card stays as is)

**Heading** (was "Work for property owners"):
- **A.** Get work from holiday lets *(in the preview now)*
- **B.** Pick up work from local cottages
- **C.** Get leads from self-catering owners

**Supporting line** (was "…Owners find you by the areas you cover and ask you for work."):
- **A.** …Cottage owners across your area find you by the work you do and send the job your way. *(in the preview now)*
- **B.** …The jobs come to you — owners near you find you by the areas you cover and get in touch.
- **C.** …Owners of self-catering lets nearby find you by what you do and bring you the work.

**Still your call (unchanged):** the trades-card wording (pick above); the guest-experience sign-up entry (scope the questions); finer categories for generic MCCs; the chef-declares-allergens side.
