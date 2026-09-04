# Overnight run — night of 2026-09-04

**Rules honoured:** built on branches only; previews deployed; **no merge to master, no production deploy, no production migration.** Any migration is applied to **test** only.

**Branches:** `overnight/marketplace-and-card` (fixes), plus per-option preview branches noted below.

This file is written as I go, so it's complete even if I don't finish everything. Each section ends with **three ways a real person could break it.**

---

## Status board

1. Marketplace stalls — category / "1 left" / time grid / instant-vs-hold / allergy — **fixes built (3 of 5); 2 need your call**
2. Experiences entry below the fold — two placement options — _pending_
3. Provider sign-up walk (fresh sauna owner, incl. emailed link) — _pending_
4. Trip card gaps — no rating; payment/confirmation/policy across deposit / cancelled / finished — _pending_
5. Republish a live listing with no street address (address rule) — _pending_

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
