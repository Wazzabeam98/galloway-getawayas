# Who can write what only an admin should — 2026-09-03

The general version of the commission-rate problem. Report only; nothing fixed
here (Branch A owns the commission fix and the listings grants). Verified on the
**test** project: for the live-confirmed rows I built the PATCH as a signed-in
host and read the value back through the service role; the rest are read off the
grants and policies directly.

## The rule every row is judged by

A browser write needs BOTH a column/table **GRANT** and a permissive write
**POLICY** whose `WITH CHECK` it satisfies. RLS is on for every public table, so
a column is only truly guarded when one of these is true:

- **GRANT** — the column is off the browser role's write grant (no table grant
  either), or
- **POLICY/TRIGGER** — a policy `WITH CHECK` pins the value, or a BEFORE trigger
  rejects/overwrites it.

A policy that only limits *which rows* (`host_id = auth.uid()`) does **not** stop
someone rewriting a trust column on their **own** row. That is the commission
bug, and it generalises.

---

## GUARDED BY NOTHING BUT ASSUMPTION (writable directly today)

Every one below is reachable by a plain PostgREST `PATCH` from a signed-in user;
only the UI not offering it stops abuse. Worst first.

1. **`bookings.status='confirmed'` + `confirmed_at` — by the HOST, without
   payment. LIVE-CONFIRMED (HTTP 204, left `payment_status='unpaid'`).** The
   UPDATE grant is exactly `{status, confirmed_at}`, the policy is
   `host_id = auth.uid()`, no value pin, no trigger. **This is the one that
   touches the arrival/PII fix (#99):** `bookingReleasesPrivateData` keys on
   `status='confirmed'`, so a host self-confirming an unpaid booking releases the
   guest's PII to the host and the door code/address to the guest — for a stay
   nobody paid for. A GUEST cannot do this (no guest UPDATE policy), so the
   planted-booking attack #99 closed stays closed; this is host-initiated.
   **Decision needed:** "confirmed" is not a proxy for "paid" — any guard that
   means "paid" (the PII entitlement, payout eligibility) should require
   `payment_status='paid'`, not `status='confirmed'` alone. Fix shape: a
   `WITH CHECK`/trigger that lets the browser move status only along legal,
   paid-backed transitions (or take status off the host's grant and confirm only
   via the webhook/route, as the money paths already do).

2. **`listings.rating_avg`, `rating_count`, and the six `rating_*` sub-scores —
   LIVE-CONFIRMED (set rating_avg=5.00, rating_count=999).** A host fabricates
   their own review score. The refresh trigger only recomputes on review
   inserts/updates, so the forged value stands until the next real review.

3. **`listings.approved_at` / `declined_at` — LIVE-CONFIRMED (stamped now).** The
   moderation verdict's timestamps. `status` itself is trigger-locked
   (`listings_status_authority`), but these paired columns are **the seam the
   trigger doesn't cover** — anything that reads `approved_at` instead of
   `status` is foolable.

4. **`listings.commission_rate` — LIVE-CONFIRMED (15 → 0).** The platform cut.
   *(Branch A is fixing this; listed for completeness.)*

5. **`listings.ical_token` — LIVE-CONFIRMED (set to a chosen uuid).** The private
   calendar-export secret; a host can pick their own.

6. **`listings.stl_licence_status` / `_number` / `_expiry` — writable.** These
   are host-declared today, so self-setting is by design — **unless**
   `stl_licence_status` is ever read as a *verified* gate (admin-confirmed). If
   it is, it's assumption-only; if it's just the host's declaration, it's fine.
   Decide which it is.

**Root cause (listings):** a **table-level** UPDATE grant plus an UPDATE policy
`"Hosts can update their own listings."` whose `WITH CHECK` is **NULL** (so it
falls back to the ownership USING clause — no value constraint at all). The author
saw the state-machine risk and wrote a trigger — but it guards only `status`,
leaving its money/rating/moderation siblings open. Branch A's listings-grants
allow-list (the same shape as the read fixes) closes 2–5 in one move; item 1 is a
separate table (`bookings`).

---

## GUARDED PROPERLY (checked, safe — the model to copy)

- **`profiles.is_admin`, `payout_balance_owed`, `stripe_account_id`,
  `stripe_charges_enabled` / `stripe_payouts_enabled`** — **off the column grant**
  (grant is only avatar_url, email, full_name, host_bio, id, is_host, phone,
  preferred_name, residential_address, show_full_name), no table grant. **SAFE.**
  This directly answers the `is_admin` worry: a signed-in user cannot set it.
- **`service_providers.status` / `confirmed_at` / commission** — off the column
  grant. The moderation/approval gate holds. **SAFE.**
- **`bookings` money columns** — `amount_paid`, `amount_refunded`,
  `commission_rate`, `payout_amount`, `paid_out_at`, `cancelled_*` are all off the
  UPDATE grant (which is only `{status, confirmed_at}`). **SAFE.** (The gap is the
  two columns that ARE granted — item 1 above.)
- **`reviews.rating` / sub-ratings** — UPDATE grant is only
  `{host_reply, host_reply_at}`; INSERT gated by a type+window trigger. **SAFE.**
- **`listings.status`** — TRIGGER `listings_status_authority` rejects any browser
  status change (proven: 403 "done through the server, not the browser"). **SAFE.**
- **`bookings.total_price` (guest INSERT)** — guest-controlled, but
  `app/api/stripe/checkout/route.ts:131` recomputes the quote and overwrites it
  before charging. **MITIGATED at the charge** (any pre-checkout *display* trusts
  it, but the money doesn't).

---

## SAFE ONLY BY ACCIDENT — revoke the grants to match intent

`payments` and `payouts` carry **table-level INSERT/UPDATE grants to BOTH `anon`
and `authenticated`** on every column (`amount`, `settled_amount`, `status`,
`host_id`, `stripe_transfer_id`, `stripe_payment_intent_id`, …). Not exploitable
**today** only because RLS is on and neither table has a write *policy* — just a
SELECT policy — so PostgREST denies the writes. That is **one
`CREATE POLICY … FOR INSERT` away from catastrophe.** The same holds for
`stripe_events`, `services`, `slot_sessions`, `error_log`, `sent_*` and other
grant-but-no-write-policy tables. Recommend
`revoke insert, update on <these> from anon, authenticated` so the grant states
the intent and a future policy can't silently open a money table. Not urgent, but
it's the fault-line the commission bug came from.

---

## The one-line answer to your question

Only an admin/platform should set them, and today **only the UI stops a signed-in
user writing:** `bookings.status`/`confirmed_at` (host, unpaid — and it feeds the
PII/paid guards), and on `listings` the `rating_*` scores, `approved_at`/
`declined_at`, `ical_token`, and `commission_rate`. Everything else that decides
money or trust (`is_admin`, payout balances, Stripe ids, provider approval,
booking money columns, review ratings, listing `status`) is genuinely
grant/policy/trigger-protected. `payments`/`payouts` are safe only because no
write policy exists — revoke those grants before one ever does.
