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

*(filled as each task completes; ledger at the end says what was checked tonight
vs carried.)*

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
