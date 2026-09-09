# Overnight run — 2026-09-04

**Rules honoured:** built on the `companion-single-use-links` branch only; deployed previews; **no merge to master; no production deploy; no migration applied to production.** One migration and some seed data applied to **test** only.

**Preview:** https://galloway-getawayas-git-companion-s-9d2518-wazzabeam98s-projects.vercel.app
**Running commit: `671090b`** (origin/companion-single-use-links; deployment `2b91shmls`, Ready). Flag `GUEST_EXPERIENCES_OPEN=true` is set for this branch's preview only — production untouched.
**Seeded trip booking id:** `41c79727-d2fa-4820-9c8c-ba098146aa0f` (WALKTHROUGH — Anchorlee, 5–9 Sep).

---

## 1 · Preview fixes — DONE, verified as you in the browser

### 1c · what3words wasn't rendering — root cause found, fixed, verified
Not an assumption this time. The home card (`components/UpcomingTrip.tsx`) fetched the booking with `select('… status …')` but **not `payment_status`**. #103 tightened `bookingReleasesPrivateData` to require `status==='confirmed' && payment_status in ('paid','deposit_paid')`, so the gate read `undefined`, returned false, and skipped the arrival read entirely — w3w AND Get directions. The row was paid; the card never asked for the column. **Fix:** added `payment_status` to the select. `api/trips/route.ts` and the arrival page already selected it — UpcomingTrip was the only broken caller.
**Verified:** signed in as you (passwordless session via admin magic-link + the app's own /auth/callback), loaded `/` on the fixed code — `///daisy.harbour.lantern` present, Get directions present, real photo present (HTTP 200).

### 1a · Square photo frame
The quarter-width column was stretched into a tall portrait slab by `md:aspect-auto` + `md:min-h-[26rem]`. Now `md:aspect-square` on the photo and `md:items-start` on the row so it doesn't stretch.

### 1b · Real cottage photo
Anchorlee had `images: []` (the placeholder). Pointed it at the real `providers/mkt-cottage.png` (the marketplace demo cottage) via the seed. The seed's listing pick was non-deterministic (`created_at.asc` could flip between my two WALKTHROUGH listings and leave stale data) — fixed to pick by `id.asc` and to clean both listings.

**Three ways a real person could break it:** (1) A confirmed booking with `payment_status` neither 'paid' nor 'deposit_paid' (e.g. a legacy 'unpaid' host-confirmed row) still shows no w3w — correct by the entitlement rule, but looks identical to the bug I just fixed, so it will be misread as regressed. (2) A listing whose only photo is portrait fills the square frame with a centre-crop that can cut the cottage in half. (3) On a phone the photo is still a full-width 4/3 banner (only desktop went square); someone reviewing on mobile won't see the change.

## 2 · Invite bugs — already fixed on companion (never merged), proven

Both were fixed on this branch by the "Group seats: mint atomically, and an unshared link is inert" commit — that's the "never fixed": the branch never merged, so you never saw them land.

- **2a over-mint race:** `ensure-seats` calls an RPC `ensure_booking_seats` (SECURITY DEFINER) that does `insert … on conflict (booking_id, seat_index) where status<>'removed' do nothing`, backed by a partial unique index. **Proven:** fired **8 concurrent** calls at a capacity-4 booking — one minted all 4, the other seven minted 0, final live seats = exactly **4** (ordinals 1–4). No over-mint. (`scripts/_prove-atomic-seats.mjs`; the migration `20260903174512_booking_seats_are_atomic.sql` is applied to **test**.)
- **2b leak-on-open:** an unshared, unbound, unclaimed seat's link shows **"This invite isn't ready yet — Whoever booked hasn't sent this one out yet. Ask them to share your link, then open it again"** + an Explore button. Not an error. (`app/trip-invite/[token]/page.tsx:53`.)

**Three ways a real person could break it:** (1) Remove a seat and re-open the sheet fast — the freed ordinal is refilled, which is correct, but a host watching will see the seat "come back" and think Remove failed. (2) Bind a link to an email, then the guest opens it signed in as a *different* address — the page has to decide whose seat it is; worth a manual check. (3) The RPC is `service_role` only and the route is the only caller — if any future code calls `ensure-seats` before the ownership check, the guard is bypassed.

## 3 · Address-required-to-publish — CHECK done; code written but HELD (needs your call)

### The check you asked for first (read-only, prod)
You have **4 listings on prod, not 5.** Failing the rule (published with no street address + postcode):
- **4 bedroom Townhouse, Kirkcudbright** — published, no address → FAILS
- **Modern 3 Bedroom, Kirkcudbright** — published, no address → FAILS
- **Modern Cottage, with Hot Tub** — published, no address → FAILS
- TEST - DO NOT BOOK — hidden, has "SESAME STREET"/DG6 4EA → passes

### The rule (written, not deployed)
The wizard's `PUBLISH_RULES` already require a street address + postcode, but **only client-side** — the server publish endpoints never enforced it (publish/route checked title+price; visibility/route, the un-hide path, checked nothing). I wrote `addressBlockerForPublish()` and gated both endpoints. **Not** a DB constraint: 3 prod + 14 test listings are already published address-less, so a constraint would reject existing data — they must be backfilled first.

### Why it's held
The change breaks two existing tests, and per your rule I don't rewrite tests silently:
- `404 — hiding and un-hiding a live listing still works` — the visibility gate blocks un-hiding an address-less listing.
- `564 — publishing fills the coordinates from the postcode` — its fixture publishes a listing with a postcode but no street address.

Both are the suite correctly flagging that the rule changes publish behaviour. **Your call:** (a) gate only the *first* publish (drop the visibility gate → fixes 404) and update 564's fixture to carry a street address (the new correct state); or (b) narrow the rule further. The code is saved at `scratchpad/task3-address-rule.patch`; it is **not** on the preview.

**Three ways a real person could break it (once enabled):** (1) A host with a grandfathered address-less listing hides it to make an edit, then can't un-hide it until they add an address — correct, but a surprise mid-task. (2) The postcode format check (`UK_POSTCODE`) rejects a valid BFPO/Crown-dependency code a real host might have. (3) It gates the *transition*, not the row — a listing published before the rule stays live address-less until it's next re-published.

## 4 · Arrival editor — already implemented on companion; the three guest cases

Also already on the branch. `components/LockboxCode.tsx` (the door-code field, separate from ArrivalEditor) already carries the exact copy: *"A code in this field shows on each guest's arrival screen, so if you change the lock, every guest sees the new code the moment you save it. A code typed straight into a message can't be taken back…"* And it uses the existing `check_in_method` via `methodNeedsCode`/`codeHintFor` — no new field. The arrival page renders all three cases:

1. **Code set** (within 3 days of arrival): the code, big, "Shown because your check-in is close." Outside the window: "Your door code shows here a few days before you arrive."
2. **No code, method set** ("met at the door", "key safe"): the check-in method's title + blurb, with a door icon — driven by `check_in_method`.
3. **Neither**: "{host} hasn't set a door code for this place — they'll let you in, or tell you how, in the messages" + a Message button.

**Three ways a real person could break it:** (1) A host sets a code, a guest reads it, then the host changes the lock 2 days before arrival — the new code shows, but a guest who screenshotted the old one won't know. (2) `check_in_method` is the *form* value, not the saved one — pick "lockbox" then leave without saving and the code field appears for a method that isn't stored. (3) A stale code left on a listing whose method no longer needs one still fills `{lockbox_code}` in a template — the editor warns, but only if the host revisits it.

## 5 · Provider sign-up as a fresh sauna owner — stall points (described, not fixed)

Traced the flow (`ProviderSignUp.tsx`, `lib/joinSteps.ts`, `ProviderSlotDashboard.tsx`, `api/services/*`). The sign-up steps are **trade → business → credentials → prices → finish** — there is no first-class *schedule/availability* step. Companion added a weekly-hours editor *inside* the slot shape's fields ("the schedule editor a sauna owner needs and never had"), and submits `availability` rows. Where a real sauna owner stalls:

1. **The hours editor is buried, not a step.** It rides inside the slot fields on an existing step rather than being its own titled step, so it's easy to breeze past — and finishing without hours is the empty-calendar dead-end.
2. **After "finish": pending_review, silently.** The application waits for admin approval with no ETA. A real person doesn't know if they did it right or are just waiting.
3. **Payout gate on the dashboard.** "One step before guests can book you — Set up payouts. You won't appear to guests until this is done." Stripe Connect (identity, bank) is the classic drop-off, and it's presented as the *only* remaining step — which hides #4.
4. **The dashboard can't set hours, only block days.** `ProviderSlotDashboard` offers a payout prompt, an empty "booked times" diary, and "Days off." There is **no way to set or re-edit weekly opening hours on the dashboard.** A sauna owner who finished sign-up without hours (or wants to change them) has nowhere obvious to go — "block a day" is meaningless with no open days to block.
5. **No "you have no availability" signpost.** Payouts done reads as "live," but with no hours the provider is unbookable and nothing says so. They think they've launched; they've launched into an empty calendar.

**Three ways a real person could break it:** (1) Sets payouts, skips hours, tells friends they're live — silent zero bookings, no error anywhere. (2) Needs to change opening hours next week — the only editor is back inside the sign-up wizard, not the dashboard. (3) Sets hours but no capacity/session length (slot-only fields) — slots may generate empty or wrong, and the failure is invisible until a guest can't book.

## 6 · Marketplace polish — NOT reached

Not started tonight. My read on "worst-looking first": the **slot-guest receipt email** is the most concrete, highest-trust gap (a guest pays and gets nothing in writing); then **trust signals** beyond a headshot/description; then the **post-booking moment**. Flagged for the next run.

---

## Data / test-side changes made tonight (all TEST or local only)
- Applied `20260903174512_booking_seats_are_atomic.sql` to **test** (was outstanding; the invite feature needs it).
- Seeded/re-seeded your trip on test (`scripts/_seed-my-trip.mjs`) — now sets a real photo, deterministic listing pick, cleans both WALKTHROUGH listings. Remove with `node scripts/_seed-my-trip.mjs --reset`.
- New tooling (untracked, test-only): `_prove-atomic-seats.mjs`, `_verify-w3w.mjs`.
- Added `GUEST_EXPERIENCES_OPEN=true` for the **companion preview branch** only (you approved this earlier). Production's flag is still unset.

## What needs a decision from you
- **The 3 address-less live listings** need real addresses before any DB-level constraint could ever be added.
- **Task 6 trust signals** — which signals to show (see continuation below).

---

# Continuation — after your go on task 3 + the prod fix

**Preview now runs `ebae859`** (companion, task 3 added). Prod fix is **PR #106**, separate off master.

## Live production bug — fixed in its own PR (#106), off master
`https://github.com/Wazzabeam98/galloway-getawayas/pull/106` — one-line: add `payment_status` to the home card's booking select. Cherry-picked clean off master (no square-photo change rode along), guard green, ready to merge first thing.

**Blast radius — grepped every caller of the gate, not just #103's:**
| Caller | Select | Verdict |
|---|---|---|
| `api/trips/route.ts` | has `payment_status` | ok |
| `arrival/[bookingId]/page.tsx` | has `payment_status` | ok |
| **`components/UpcomingTrip.tsx`** | **missing** | the bug (fixed) |
| `messages/threads/[bookingId]` → `contactNumberVisible` | `select('*')` | ok |
| `dashboard/bookings/[id]` → `contactNumberVisible` | `select('*')` | ok |
| `HostReservations.tsx` → `contactNumberVisible` | has `payment_status` | ok |

I also found a 4th direct caller you'd want checked — `lib/stayWindow.ts`'s `contactNumberVisible` (shows the counterparty phone near arrival). It fails **closed** (hides the phone) rather than leaking, and all three of its callers select the column. Only the home card was broken.

**Three ways to break the prod fix:** (1) A future edit to the card's select drops the column again — silent, since the gate fails closed; a test asserting the card fetches payment_status would catch it. (2) A booking with an odd `payment_status` value (e.g. 'partially_refunded') isn't in the paid set, so its arrival details vanish — correct, but looks like this bug. (3) If #103's helper is ever loosened, the whole gate shifts and every one of these selects becomes moot.

## Task 3 — shipped to the preview (your chosen resolution)
Publish endpoint now refuses an address-less publish (`addressBlockerForPublish`); the un-hide path is left alone (so `404 hide/unhide` stays green); `postcode-geocode` test 564's fixture gained a street address (its intent unchanged). Guard green.

**Three ways to break it:** (1) A host who never set an address hits publish and gets stopped with no obvious "fix it here" link back to the address step. (2) `select('*')`-based publish callers elsewhere would bypass this route's check — this only guards `api/listings/publish`. (3) The rule reads the row the route fetched; if a caller passes a stale listing object, the check is against stale data.

## Task 6 — worked the list, worst-first
- **Slot-guest receipt email: NOT a gap.** It's already on **production** — the slot book route sets `customer_email` + `metadata.kind:'slot_order'`, and the webhook sends "Your booking is confirmed" with the amount + a View-booking button. Verified on master, not just companion.
- **Trust signals: the real gap**, but a guest-facing design call I won't ship unprompted — especially because prod has **0 providers and 0 orders**, so a "N bookings"/rating signal would read "0" and *lose* trust on a fresh marketplace. Data available with no new schema: `approved_at`, `created_at`, and the admin `verify_registration` decision. **No guest review system exists.** My proposed safe set (none of which expose emptiness): a **"Verified business"** badge (registration-verified), **"On Galloway Getaways since <year>"**, and *later*, once there's volume, a bookings count. Say which you want and I'll build it.
- **Post-booking moment:** not assessed in depth yet — next.

**A pattern worth naming:** tasks 2, 4, and the slot receipt were all already built (2 and 4 on companion, the receipt even on master). The bottleneck for most of tonight's list isn't building — it's **reviewing and merging the companion branch.** That's the highest-leverage next move.
