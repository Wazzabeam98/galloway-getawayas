# Overnight report — night of 4→5 September 2026

**Read-only, report-only.** Nothing merged, deployed, or applied to production.
All writes went to the **test** project (`yefoqcabuijcowoqewtc`) and were cleaned
up. Baseline: I **fetched first** — this report is anchored to `origin/master`
**`2ef544e`** (PR #114, 2026-09-04 21:19), not a local checkout. (Last night I
reported a fixed leak as live off a stale tree; not repeating that.)

## Method vocabulary
- **proven on test** — built the real request (anon key, or a real signed-in
  user's JWT, against PostgREST) and read the result back on the test project.
- **read on master** — code/migration read on `origin/master` `2ef544e`.
- **grant layer vs policy layer** — `permission denied for table` (SQLSTATE
  42501) is the Postgres grant stopping the role before RLS; HTTP 200 + 0 rows is
  an RLS policy filtering. Separated everywhere.

## Harness limits, stated up front (protection vs "couldn't build it")
- **No live production reads.** `migrate.mjs --target prod --sql` (read-only) is
  refused by this session's command classifier. Prod claims are inferred from
  `origin/master` migration files (what deploys) or carried and marked. Not a
  "prod is protected" result — a harness limit.
- Test carries all merged migrations plus, sometimes, unmerged ones; I anchor
  grant claims to committed `origin/master` migrations.

Today's production merges under review: **#106** (upcoming-trip payment status),
**#108** (verified-business badge), **#110** (provider-dashboard apostrophe),
**#111** (companion single-use invites), **#112** (directions picker), **#113**
(getting-in / map / breakdown), **#114** (house rules + quiet-hours default).

---

# Findings, worst first

Ranked across everything tonight. "tonight" = built/ran and read back on test;
"carried" = from a prior night, re-checked where noted.

1. **🔴 HIGH — the erasure cascade is schema-wide, not just `bookings.guest_id`.**
   Deleting a **host** profile (`listings.host_id → CASCADE`) destroys their
   listings **and every guest's booking on them**, plus door codes, arrival
   secrets and reviews; `payouts.host_id → SET NULL` severs the payout audit
   trail; `reviews.*/messages.* → CASCADE` erase reputation and dispute evidence.
   Same "anonymise + retain" fix, but the FK change-list is bigger. Extends last
   night; add "host-side too" to the parked solicitor item. (tonight)
2. **🟠 MEDIUM — `migrate.mjs --record` footgun.** It writes ledger-presence
   without checking, and **no automated gate reacts** (status exits 0 on an
   assumption; the pre-push hook is a note that greps only OUTSTANDING/EDITED).
   **74% of the ledger (73/99) is assumption, not observation** and
   checksum-null (undriftable). A wrongly-recorded money migration would be
   silent — a read-back caught today's. (tonight)
3. **🟠 MEDIUM — `full_name` leaks to anon regardless of `show_full_name`.**
   Re-proven on test with the flag off. (carried)
4. **🟠 MEDIUM — silent money routes** (`slots/schedule` unlogged calendar-wipe;
   `order(s)`, `slots/book`, `ical-sync`, webhook notify catches → `console.error`
   only). Untouched today. (carried)
5. **🟠 MEDIUM — free-cancel deadline judged at processing time, not click time.**
   Untouched today. (carried)
6. **🟠 MEDIUM — webhook that never arrives → guest charged, cancelled, no
   auto-refund.** Stripe retries usually save it; needs reconciliation. (carried)
7. **🟡 LOW — storage has no owner-scoped upload paths.** Re-proven on test. (carried)
8. **🟡 LOW — companion double-claim TOCTOU shipped (#111).** The unguarded claim
   UPDATE is now live; false-success only, no over-capacity/access. (tonight)
9. **🟡 LOW — demo data half-removed on test.** The `@gallowaymarket.test` seed is
   gone, but other-domain demo providers + 2 live Stripe test accounts persist.
   Test only. (tonight)

**Clean / proven-good tonight:**
- **The arrival-secret wall HOLDS after six merges, and is stronger** — door code
  + wifi password never fetched, entitlement now `confirmed && paid/deposit_paid`,
  planted booking refused, guest can't self-confirm (Task 1, proven).
- **Quiet-hours migration is clean** — custom times preserved, nothing else
  touched (proven on test).
- **Payout invariants intact** and untouched by today's merges (Task 3).
- **Unhappy paths ran green** — slot last-seat race never oversells, webhook-twice
  dedupes, a hidden listing doesn't lock out a confirmed guest (Task 2).
- **First-name display respects `show_full_name`** (Task 1).

---

## TASK 1 — Six merges together, and the arrival-secret wall — **RESULT: wall HOLDS, and is STRONGER than yesterday**

**Read on master `2ef544e` + proven on test 2026-09-05.** Five of the six merges
touched arrival/trip-card files (`app/api/trips/route.ts`, `app/trips/page.tsx`,
`components/arrival/*`, the new `DirectionsPicker`). The two real secrets — the
**door code** and the **wifi password** — are still walled, on two independent
layers:

1. **Grant layer:** `listing_access_codes` and `listing_arrival` have **(none)**
   for anon/authenticated — the code and wifi tables are unreadable by any
   browser role, full stop.
2. **The trips API never even fetches them.** `/api/trips` selects
   `listing_access_codes(listing_id)` — existence only, **never `code`** — and
   `wifi_name` (never the password). Address / what3words / directions / times
   are queried **only** for entitled trips (`trips.filter(bookingReleasesPrivateData)`,
   `:108`) and attached only after a second `if (!bookingReleasesPrivateData(t))
   return` gate (`:148`). The new DirectionsPicker is fed from that entitled block.

**The entitlement rule got STRONGER, not weaker** (the #103 change, intact on
master): `bookingReleasesPrivateData` now requires
`status==='confirmed' && payment_status ∈ {paid, deposit_paid}` — closing the
edge where a host flips their *own* booking to `confirmed` without paying.

**Proven end-to-end on test (the attacker path):**
- An authenticated attacker **can** still plant a `pending_payment` booking on a
  host's listing (HTTP 201 — the column-scoped browser INSERT survives; it
  cannot set `payment_status`, which stays `unpaid`).
- With that planted booking, reading the host via `profile_private` returns
  **HTTP 200, 0 rows** — host email / `stripe_account_id` / payout balance **not
  released**. The rule refused it.
- The attacker (guest) tried to `PATCH` their own booking to `status='confirmed'`
  → **0 rows changed** (status stayed `pending_payment`): the bookings UPDATE
  policy is `host_id = auth.uid()`, so a guest cannot self-confirm.

**Verdict:** nothing that was proven yesterday about the arrival wall quietly
stopped being true; the six merges left it intact and the entitlement tightening
made it stricter.

### Other cross-merge interactions checked
- **First-name display (#113 header, #40007f6 messages) vs `show_full_name` — SAFE.**
  `firstName()` (`lib/utils.ts:74`) is built on `displayName()`, which honours the
  switch (`legalAllowed = show_full_name !== false`, `:57`). If a user hid their
  legal name and set no preferred name, `firstName` returns the fallback
  (`Host`/`Guest`), not a slice of the legal name. The messages routes use
  `firstName(other, 'Host'|'Guest')` correctly. The one raw `split(' ')[0]` in
  `Navbar.tsx:35` is the signed-in user's **own** name shown to themselves —
  `show_full_name` governs showing your name to *others*, so this is fine.
- **House rules on the card (#114) — consistent with the wall.** Shown only on
  "confirmed, paid reservations" (commit `c99954a`), the same entitlement gate.
- **Directions picker (#112) — gated.** Its address/w3w come from the entitled
  arrival block; no separate unauthenticated fetch.
- **Verified-business badge (#108) — reviewed, low.** A display badge on approved
  providers; noted, not deep-audited (not money/PII path).
- **Companion single-use invite (#111) — the TOCTOU I flagged shipped.** The
  merged `booking-guests/accept/route.ts` still does the claim as an
  **unconditional** `UPDATE … WHERE id = :id` (`:118–123`), no `status` guard.
  Same low-severity false-success race as last night: two concurrent claimers of
  one link both get `ok`, one seat, no over-capacity or access leak — the loser
  is just wrongly told "joined". Now live. Fix remains a conditional update; see
  last night's Task 5.

---

## TASK — Quiet-hours migration `20260904121837` — **RESULT: CLEAN, custom times preserved (proven)**

**Read on master + proven on test 2026-09-05.** The migration (a) sets the
`quiet_hours_enabled` column **default** to `true` (new listings only — an
`ALTER … SET DEFAULT` does not touch existing rows), and (b) backfills with:
```
update listings set quiet_hours_enabled = true,
   quiet_hours_start = coalesce(nullif(quiet_hours_start,''), '22:00'),
   quiet_hours_end   = coalesce(nullif(quiet_hours_end,''),   '07:00')
 where quiet_hours_enabled = false;
```

**Two guards make it safe, both proven behaviourally on test** (set up two
listings, ran the exact backfill UPDATE, read back, restored):
- **A listing already ON with custom times is untouched** — the `WHERE
  quiet_hours_enabled = false` excludes it. Proven: `21:00/08:00` → still
  `21:00/08:00`.
- **A listing that was OFF with custom times keeps its times** — `coalesce(nullif(…))`
  preserves any non-empty value and only fills truly-empty ones with the
  `22:00/07:00` default; it just flips `enabled` on. Proven: `23:15/06:45` (off)
  → `23:15/06:45` (on).

**Nothing else in the table was disturbed** — the UPDATE's SET list is exactly
the three `quiet_hours_*` columns; no other column is written, and the ALTER only
changes the default. Test confirms the column default is now `true`. (I could not
read prod, but the migration text is deterministic and its safety is in the
`WHERE`/`coalesce`, which I proved on test.)

---

## 🟠 MEDIUM — `migrate.mjs --record` is an honest design with a footgun the automation doesn't catch

**Read on master + ledger read on test 2026-09-05.**

### Intended or footgun? Both — intended, with real mitigations, but a genuine footgun.
`--record` **exists on purpose**: two sessions edit this repo and only one goes
through the runner, so a migration applied by hand (Supabase SQL editor, or a
work-laptop branch) leaves the schema changed and the ledger silent, and
`--status` then cries "OUTSTANDING" forever — a warning that's always wrong gets
ignored, which is the exact failure the ledger was built to prevent (it bit on
1 Sept). So `--record` writes a ledger row **without running or checking the
SQL**. It is honest about that: the row is `backfilled = true`, `checksum = null`,
a `--note` is **required**, and `--status` prints these under **"ASSUMED, NOT
OBSERVED"**.

### The footgun: nothing automated reacts to an assumption, so a wrong `--record` is silent.
- `--record` writes **ledger presence without verifying** → the file leaves the
  OUTSTANDING set.
- `--status` **exits non-zero only on OUTSTANDING or EDITED** (`migrate.mjs:584`)
  — an assumption exits **0** (clean).
- The pre-push hook is a **note, not a refusal** anyway (`exit 0`), and its `sed`
  extracts only the `OUTSTANDING` and `EDITED SINCE` sections — **never the
  ASSUMED section**.
- **Net:** if someone `--record`s a migration that was *not* actually applied,
  it is not OUTSTANDING, not surfaced by the hook, and exits clean. The schema
  silently diverges from the code. The **only** thing that catches it is a human
  running `--status` and reading the ASSUMED section — i.e. the manual read-back
  that caught it today. A migration that widens a check constraint, adds a
  `revoke`, or moves money-touching logic could be "recorded" and never run, and
  no gate would notice.

### Is anything else in the ledger an assumption rather than an observation? YES — most of it.
On test: **73 of 99 rows (74%) are assumptions** (`backfilled=true`,
`checksum=null`). Almost all carry the 1 Sept note *"production and test compared
and identical across 4,334 schema facts"* — a reasonable bulk assertion, but an
assertion: it says prod==test at a moment, not that each file's SQL was observed
to run. And `checksum=null` means `--status` **cannot detect if any of those 73
files is later EDITED** — there's no stored hash to compare. So three-quarters of
the ledger is both unverified and undriftable-by-tool.

### What would make a recorded-but-unapplied migration impossible to mistake for a real one
1. **Verify at record time — the high-value one.** Require `--record` to run a
   read-only predicate proving the change is present, and refuse to record if it
   fails (e.g. `--check "select to_regclass('public.foo') is not null"`). The
   notes already *describe* the check ("index present, column present") — have
   the tool actually run it. That converts the assertion into an observation.
2. **Make the gate honour assumptions.** At minimum, add `/ASSUMED, NOT OBSERVED/`
   to the pre-push hook's `sed` so assumed rows are surfaced; better, have
   `--status` exit non-zero (or a distinct code) for an assumption that has no
   verification predicate, so CI/pre-push can react.
3. **Backfill checksums where the file is in the repo**, or add a `verified_at`
   column set by a reconciliation pass that re-runs each assumed row's predicate
   against the live schema — so the 73 stop being permanently uncheckable.

Rank: MEDIUM — not a live security hole, but this is precisely the silent
code-vs-schema divergence that produces a money bug (a revoke or constraint that
"landed" only in the ledger). It nearly did today; the read-back saved it.

---

## 🔴 HIGH (extends last night) — the erasure cascade is NOT just `bookings.guest_id`; the same shape is all over the schema

**Read on test 2026-09-05 (FK `delete_rule` is authoritative); the `bookings`
leg was behaviourally proven last night.** I swept every `CASCADE` / `SET NULL`
FK. Deleting a `profiles` row (what a "delete my account" does) or a `listings`
row detonates far wider than one booking. Worst first:

| FK | Deleting the parent… | Damage |
|---|---|---|
| `listings.host_id → profiles CASCADE` | delete a **host** account | **all their listings vanish**, and via `bookings.host_id → CASCADE` **every guest's booking on those listings** (each guest's paid stay), plus `listing_access_codes`, `listing_arrival`, `calendar_overrides`, `reviews`. Bigger blast radius than guest deletion. |
| `bookings.guest_id / host_id → profiles CASCADE` | delete a guest or host | their bookings gone (proven last night); `payments`/`payouts` orphaned (`SET NULL`). |
| `payouts.host_id → profiles SET NULL` | delete a host | payout rows **lose which host was paid** — the financial audit trail is severed while the money record remains. |
| `reviews.reviewer_id / reviewee_id → profiles CASCADE` | delete any user | **reviews erased** — a departing guest destroys the honest reviews they wrote about hosts; a host's reputation record is mutable by a third party leaving. |
| `messages.sender_id / recipient_id → profiles CASCADE` | delete any user | conversation history erased — **dispute evidence gone**. |
| `reviews.listing_id → listings CASCADE` | delete/remove a listing | that property's reviews erased. |

**The common thread:** a profile (or listing) deletion silently destroys
**money trail** (payouts orphaned), **access/secrets** (arrival, door codes),
**reputation** (reviews) and **evidence** (messages) — none of it announced.
`payments.booking_id`/`payouts.booking_id` are `SET NULL` and `bookings.listing_id`
is `RESTRICT`, so the money rows *survive* but disconnected, and a listing with
bookings can't be deleted — small mercies, not a design.

**This widens last night's erasure scope, it doesn't change the fix:** the same
"anonymise + retain, never hard-delete the row, resolve money first" answer
covers all of it — but the **FK change list is bigger than `bookings.guest_id`**.
Every `→ profiles CASCADE` and `payouts.host_id → SET NULL` above wants the same
`RESTRICT`/anonymise treatment, or a host/guest erasure quietly shreds other
people's money, stays, and reputation. This belongs in the same solicitor-bound
erasure design already parked in `OUTSTANDING.md §1` — the note there should say
"host-side too", not just guest.

---

## 🟡 LOW — demo data: the marketplace seed IS gone, but other-domain demo providers persist (test only)

**Proven on test 2026-09-05.** The specific worry — the `seed-marketplace.mjs`
demo under `@gallowaymarket.test` — is **fully removed**: 0 such users remain, so
`--reset` did its job for its own domain. Fake reviews are effectively gone too:
**1** review total, **unpublished**.

**But the reset only knows its own domain**, and four demo/test providers under
*other* domains survive — approved and marketplace-visible, two with **live Stripe
test accounts still attached**:

| Provider | Owner (test domain) | Stripe test acct | Orders |
|---|---|---|---|
| Effie's Bakes | `effie@gallowaybaker.test` | `acct_1UApt…` (live) | 1 |
| Demo Chef — Solway Table | `demo-chef@gg-preview.test` | `acct_1U9my…` (live) | 0 |
| Nith Valley Plumbing | `nith@gallowaywalk.test` | — | 0 |
| Baxter Plumbing & Heating | `baxter@gallowaywalk.test` | — | 0 |

Plus junk under your own account (`liamworrall18@hotmail.com`): a `declined`
provider `jhgjuv` and an approved provider literally named `TEST`.

**Why it's the confusion source:** these are exactly the "half-removed seed"
rows — `seed-marketplace.mjs --reset` cleans `@gallowaymarket.test` and nothing
else, so anything seeded from `gallowaybaker.test` / `gg-preview.test` /
`gallowaywalk.test` (earlier runs or manual preview setup) lingers, shows in the
test marketplace, and carries dangling Stripe test accounts. **Test only** (the
seed lib refuses a non-test key), so no prod exposure — but on test they'll keep
appearing as real approved businesses. **Fix:** either broaden the reset to match
all `*.test` demo domains (or a shared marker column), or delete these four + the
two junk rows by hand and close the two Stripe test accounts. Low, but it's the
recurring confusion you named.

---

## TASK 3 — Payout engine on today's master — **RESULT: invariants intact, untouched by today's six merges**

**Read on master `2ef544e` + function on test 2026-09-05.**
- **None of today's six merges touched** the payout / clawback / refund path
  (`git diff` name-only: empty for those files) — so nothing could have regressed
  it, but I re-checked anyway.
- **Clamp present:** `greatest(0, round(coalesce(payout_balance_owed,0)+p_delta,
  2))` verbatim in `20260831120000_host_debt_moves_atomically.sql:45–47`.
  `adjust_payout_balance` on test is SECURITY DEFINER with **no** browser EXECUTE.
- **Exactly three writers survive:** `host-payouts/route.ts:371`,
  `stripe/refund/route.ts:199`, `lib/clawback.ts:131`. `grep payout_balance_owed`
  across `app/`+`lib/` shows **no direct writes** — every move goes through the
  function.
- **What the first LIVE payout does that test cannot exercise** (unchanged from
  last night's detailed §, still the gate): real card-funds settlement
  (`source_transaction` covers single-charge stays; the deposit+balance untied
  fallback is safe only while the 30-day rule holds), real KYC / `payouts_enabled`
  state, real Stripe fees eating the platform's cut, real disputes → clawback
  with a real negative balance. **The one carried must-do stays open:** read
  `adjust_payout_balance` back on **prod** and confirm the single `acct_…` is
  yours before the first run — I still can't read prod this session.

---

## TASK 2 — Unhappy-path scenarios — RAN them this time. Nothing lands money or access wrong.

Ran on test 2026-09-05 where executable; the rest read on master (cancellation /
webhook / door-code paths were **not touched by today's merges**, so last night's
analysis carries).

| Scenario | How | What happened | Money/access misplaced? |
|---|---|---|---|
| **Two guests take the last slot at once** | **RAN** (real concurrent CAS on `slot_sessions`) | one got the seat, the other **LOST THE SWAP**; final `seats_taken = 2/2`. The compare-and-swap (`update … where seats_taken = <value read>`) serialises it. | **No** — never oversold; loser charged nothing (hold released). |
| **Webhook arrives twice** | **RAN** (duplicate `stripe_events.event_id`) | second insert is a **no-op** — the unique `event_id` dedupes; the handler returns `{duplicate:true}` and skips. | **No** — never double-processed. |
| **Listing hidden while a guest holds a confirmed booking** | **RAN** (confirmed+paid booking, set listing `hidden`, read `profile_private` as the guest) | guest **still reads the host** (1 row) — entitlement keys on **booking status, not listing visibility**. | **No** — a paid guest keeps their address/door code; hiding only stops new bookings. |
| **Guest cancels 23:55 on the last free day, refund computed after midnight** | read master (unchanged today) | `lib/cancellation.ts` evaluates the cutoff with `new Date()` at **processing** time — a cancel just before the deadline, processed just after, can drop to a smaller refund. | **Edge risk** — carried MEDIUM; stamp the request time. Only bites at the exact boundary. |
| **Webhook never arrives / an hour late** | read master (unchanged today) | *late*: the confirm has no status guard so it un-cancels the booking; if the dates were re-taken the exclusion constraint fires `23P01` → refund. *never*: booking cancelled after 1h, **no auto-refund** — Stripe's ~3-day retry usually saves it; a persistent outage needs reconciliation + alerting. | *late*: **no** (money safe). *never*: **potentially yes** but low-probability; carried MEDIUM. |
| **Host changes the door code the day a guest arrives** | read master (unchanged today) | the arrival page reads `listing_access_codes.code` **live** via the service role — the guest sees the new code on next load. An **already-sent** scheduled door-code message keeps the old one. | **No** for the live path; set the physical lock to match, and note the stale message. Carried LOW. |

**Verdict:** the three I could execute (slot race, webhook dedupe, hidden-listing
access) all put money and access exactly where they belong. The three carried
ones are unchanged since last night — today's merges didn't touch those files —
so their ranks stand.

---

## TASK 4 — Carried items — re-verified on current master, all THREE still true

| Item | Re-verified tonight | Cost to fix (carried) |
|---|---|---|
| **`full_name` leaks to anon regardless of `show_full_name`** | **proven on test** — set a profile `show_full_name=false`, anon still read `full_name`. (Two directors' legal names on prod, per last night.) | masking view `profiles_public` (`case when show_full_name then full_name else null end`), revoke `full_name` from the raw table, repoint ~15 reads. ½ day + careful migration. |
| **Storage has no owner-scoped upload paths** | **proven on test** — the `listings`-bucket INSERT policy is still bare `bucket_id = 'listings'`. Any signed-in account uploads to any path (write-only; no overwrite/delete). | per-user path prefix + `(storage.foldername(name))[1] = auth.uid()::text` INSERT policy + migrate existing objects. ½ day. |
| **Silent money routes catch with `console.error` only** | **read on master** — today's merges did **not** touch `services/order(s)`, `services/slots/*`, `cron/ical-sync`, or the webhook post-charge notify catches; all still `console.error`-only. `slots/schedule`'s non-atomic delete-then-insert calendar-wipe still unlogged. | swap `console.error` → `logError` (~1–2h); wrap `slots/schedule` in one atomic function. Breaks nothing. |

None of today's six merges changed any of these; the fixes and their costs are exactly as last night.

---

## Task ledger — checked tonight vs carried

Anchored to `origin/master` `2ef544e` (I fetched first).

| The seven asks | Method | New vs carried |
|---|---|---|
| Six merges together + arrival wall | proven on test + read master | **NEW** — wall holds, stronger; first-name respects the switch; companion TOCTOU shipped |
| Unhappy-path scenarios (run them) | **RAN 3 on test**, read 3 on master | **NEW execution** — slot race, webhook-twice, hidden-listing all green |
| Payout before first real payout | read master + function on test | carried, re-verified on today's master |
| Carried items (full_name / storage / silent routes) | proven on test + read master | carried, all three still true |
| Erasure cascade — other same-shape cascades | FK sweep on test | **NEW** — host-side + payouts/reviews/messages |
| Quiet-hours prod migration landed cleanly | **proven on test** (backfill re-run) | **NEW** — custom times preserved |
| Demo data actually gone | proven on test | **NEW** — marketplace seed gone; other-domain demo persists |
| `migrate.mjs --record` footgun | read master + ledger on test | **NEW** — 74% of ledger is assumption; no gate catches a bad record |

### What I could NOT check tonight, and why
- **Any live production value** — `migrate.mjs --target prod --sql` is refused by
  this session's command classifier (harness limit, not "prod protected"). Prod
  claims are from `origin/master` migration files or carried. Open prod read-backs:
  `adjust_payout_balance`, the single `acct_…`, and that the quiet-hours backfill
  on prod left custom-time listings untouched (same deterministic migration I
  proved on test).
- **Live HTTP** for the arrival page / cancel route / slot booking end-to-end —
  I proved the DB-layer and route-logic pieces; a dev-server walk is the final
  confirmation for the full request path.

### Test housekeeping
Reused throwaway accounts from prior nights (`sweep-stranger@` etc.); seeded and
deleted bookings, a slot session, a `stripe_events` row, and toggled one
listing's status/quiet-hours, all restored. No writes to production.
