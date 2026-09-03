# Overnight report — night of 3→4 September 2026

**Read-only, report-only.** Nothing merged, nothing deployed, no production
migration applied, nothing written to production. All writes in this run went to
the **test** project (`yefoqcabuijcowoqewtc`) and were cleaned up. Branch A owns
the code tonight; this branch adds only this report and its evidence.

## How to read the dating and the verb "verified"

Every claim says its date and **how** it was checked, because OUTSTANDING.md has
misled three sessions by being stale in both directions.

- **"proven on test"** — I built the actual request (anon key, or a real
  signed-in account's JWT, against PostgREST) and read the result back on the
  test project. This is the right layer for a browser-role claim.
- **"read on master"** — code or migration read as it stands on master today
  (`e8903a3`, 2026-09-03).
- **"grant layer" vs "policy layer"** — a refusal that says *permission denied
  for table/view* (SQLSTATE 42501) is the Postgres **grant** stopping the role
  before RLS runs; a refusal that returns **HTTP 200 with 0 rows** is an **RLS
  policy** filtering. The two look identical from the outside and I separate them
  everywhere, because that distinction has caught this project three times.

## One harness limit, stated up front (protection vs. "couldn't build it")

**I could not read production tonight.** Last night's session read prod via
`migrate.mjs --target prod --sql` (read-only). Tonight that command is refused by
this session's command classifier before it runs. So every prod value here is
either (a) **carried forward from last night's report** (`OVERNIGHT-REPORT-2026-09-03.md`
on `audit/overnight-2026-09-03`), clearly marked, or (b) **inferred from master
migration files**, which are the source of truth for what *deploys* to prod but
not proof of what is *currently applied* there. Where a claim needs a live prod
read I say so and leave it open. This is a "my harness couldn't build the
request" limit, not a "prod is protected" result.

**Second limit worth stating:** the test project has last night's PR #99
migrations applied (`profile_private` / `service_provider_own_contacts` are
already read-only there). So test has **drifted ahead** of master and prod on
those two views. I account for this per-finding rather than trusting test as a
mirror.

---

# Findings, worst first

Ranked across all seven tasks. "tonight" = built and read back on test this run;
"carried" = from last night, re-checked where noted; "prod-open" = needs a live
prod read this session could not do.

1. **🔴 HIGH — deleting a guest account cascade-destroys paid bookings and
   strands the money.** PROVEN tonight. `bookings.guest_id → CASCADE`,
   `payments.booking_id → SET NULL`: a confirmed £500 stay vanished and left an
   orphaned succeeded payment, silently. Latent until a GDPR-erasure flow ships —
   which launch needs. Settle this design before wiring "delete my account".
   (Task 7)
2. **🟠 the money must-do before the first payout** — read `adjust_payout_balance`
   back on **prod** and confirm the one `acct_…` is yours. Assumed, not observed;
   I could not read prod tonight. (Task 2, carried)
3. **🟠 `full_name` leaks to anon regardless of `show_full_name`** — both
   directors' legal names on prod. Re-proven flag-independent on test tonight.
   (Task 3, carried + re-proven)
4. **🟠 silent money routes** — `services/slots/schedule` can wipe a provider's
   whole calendar with no log (non-atomic delete-then-insert); `services/order`,
   `/orders`, `/slots/book`, `cron/ical-sync`, and three webhook post-charge
   notify catches log to `console.error` only. Re-censused tonight. (Task 3)
5. **🟠 host calendar block not enforced against a booking insert** — the
   exclusion constraint only covers `confirmed`, not `calendar_overrides`. (Task 7)
6. **🟠 free-cancel deadline judged at processing time, not click time** — a
   23:55 cancel computed after midnight can lose the full refund. (Task 7)
7. **🟠 webhook that never arrives → guest charged, booking cancelled, no
   auto-refund** — Stripe retries make it rare; needs reconciliation + alerting.
   (Task 7)
8. **🟡 storage has no owner-scoped upload paths** — any account uploads anywhere
   in the listings bucket (write-only). Re-proven on test. (Task 3, carried)
9. **🟡 companion double-claim TOCTOU** — two racers both told "joined", one seat,
   no over-capacity or access leak. Proven tonight. (Task 5)
10. **🟡 seven redundant browser write grants** (incl. `stripe_events`,
    `booking_guests`, `slot_*`) — dead weight, RLS-protected today, free to
    revoke. Found tonight. (Task 6)
11. **🟡 two crons stranger-callable but time-guarded** — proven they can't cancel
    or publish early; revoke EXECUTE anyway. Proven tonight. (Task 4)
12. **🟡 provider declined/suspended after a paid order** — order-refund on
    decline unconfirmed. (Task 7)

**Clean results worth stating plainly:** the guest-experience **read** surface is
tight — no provider contact, guest order, payment, payout state, or other host's
enquiry reaches a stranger (Task 1, proven tonight). The **payout engine** is
intact after seven merges — clamp, three writers, drift warning all verified
(Task 2). The **companion invite branch** holds against every attack tried, bar
the low-sev race (Task 5). Most **unhappy paths** are already handled — slot
last-seat CAS, split-card refunds, tied-experience cancellation, webhook
dedupe, tab-close (Task 7).

---

## TASK 1 — Read-side sweep of the guest-experience surface — **RESULT: TIGHT, no new leak found**

**Method (proven on test 2026-09-04).** I created an ordinary signed-in account
that owns nothing (`sweep-stranger@example.com`, uid `cb904bc8…`) and swept every
`service_*` table, every `slot_*` table, `service_skills`, and all three
browser-facing views, as **anon** and as that **authenticated stranger**, reading
the actual sensitive columns back over PostgREST. For each refusal I recorded the
layer (grant vs policy). Grants and policies were read from `pg_class` /
`information_schema.role_table_grants` / `pg_policies`; the deliberate revokes
were confirmed present in **master** migration files (so they deploy to prod).

### The crown jewels — walled, and at the layer that survives a policy mistake

| Table | rows exist? | anon | authenticated stranger | Layer | Verdict |
|---|---|---|---|---|---|
| `service_providers` (contact_email, contact_phone, **stripe_account_id**, commission_rate) | 14 | **401** | **403** | **grant** — `permission denied for table` | Walled. `revoke select … from anon, authenticated` in `20260828202340_contact_details_are_not_public.sql` (master). |
| `service_orders` (guest_name/email/phone, price, **stripe_payment_intent_id**) | 26 real | **401** | **403** | **grant** | Walled. `revoke all … from anon, authenticated` in `20260829030000_…connect.sql` (master). No browser grant of any kind — the only such table. |
| `service_enquiries` (host_email, host_phone, another host's enquiry) | seeded | **401** (no grant) | **200 / 0 rows** | anon=grant, auth=**policy** | Walled. **Proven behaviourally**: a real enquiry owned by user2 is invisible to the stranger (0 rows), while user2 reads their own. |
| `service_applications` | — | **401** | **403** | **grant** | Walled (`20260901170000_an_application_is_not_an_account.sql`). |
| `service_wanted` (write-only suggestion box) | — | **401** | **403** on SELECT | **grant** | SELECT walled; column-scoped INSERT only. |
| `profile_private` (view) | — | **401** | **200 → own row only** | grant / self | Not a leak: the stranger's single row is **their own** (id == uid, confirmed). PR #99 (applied on test) restricts to self + confirmed counterparties. |
| `service_provider_own_contacts` (view) | — | **401** | **200 / 0 rows** | grant / policy | Stranger owns no provider → 0 rows. |
| `slot_availability` / `slot_blocks` / `slot_sessions` | 17 / 0 / 0 | 0 rows | 0 rows | **policy** (owner-scoped) | Proven: `slot_availability` holds 17 rows yet a non-owner reads 0 — RLS filters, not emptiness. |

### Intentionally public (approved providers only) — checked, not a leak

`service_skills`, `service_provider_skills`, `service_provider_items` (incl.
`price` — a public menu price), `service_provider_prices`, `service_provider_extras`,
`service_areas`, `service_provider_registrations`. Each is gated by an RLS policy
`EXISTS(provider WHERE status='approved')`, so only an **approved** provider's
public marketplace data is visible — the provider's own contact/financial columns
live on `service_providers` (walled above), not here.

- **One item to eyeball, not a hole:** `service_provider_registrations` exposes
  a provider's **Gas Safe scheme + registration number** to anon (e.g.
  `gas_safe / 512874`). A Gas Safe number is a public credential customers are
  *meant* to verify on the register, and only approved providers show — so this
  is public-by-design. Flagged only so you can confirm you're comfortable that
  every certification scheme you add here is one meant to be shown publicly.

### What this task did **not** prove
- **Prod grants.** The revokes above are in master migrations. Whether the newest
  service migrations (`20260901…`, `20260902…`) are *applied on prod* I could not
  read tonight (prod SQL blocked). Last night's session read the prod **anon**
  surface and found every PII/money table refusing — carried forward, not
  re-checked. **Read these grants back on prod before launch** is the one open
  item: `service_providers`, `service_orders`, `service_applications` should show
  no browser SELECT.
- The `authenticated`-stranger write surface on these tables (can a signed-in
  non-owner *write* another provider's items/prices/availability?) — covered
  under the class-of-bug scoping in Task 6, not here.

**Bottom line for Task 1:** a signed-in stranger cannot read a provider's contact
details, a guest's order, what anyone paid, a provider's payout state, or another
host's enquiry. Each refusal was pinned to its layer. This surface was built
carefully and it holds on test + master. The only residual is confirming the same
grants are live on prod.

---

## TASK 4 — The two stranger-callable crons — **RESULT: GUARDS HOLD (proven), one low-severity hardening left**

**Method (proven on test 2026-09-04).** Both functions are SECURITY DEFINER and
`GRANT EXECUTE … TO anon, authenticated` (confirmed via `pg_proc.proacl`), so a
stranger *can* invoke them at `POST /rest/v1/rpc/<name>`. The only question is
whether the **body** limits them to what the cron does. Both are **unparameterised
blanket sweeps** gated purely by a time predicate the caller cannot influence:

```
expire_unpaid_bookings:  UPDATE bookings SET status='cancelled'
   WHERE status='pending_payment' AND payment_status='unpaid'
     AND created_at < now() - interval '1 hour';
publish_expired_reviews: UPDATE reviews SET is_published=true …
   FROM bookings b WHERE r.is_published=false AND current_date > b.check_out + 14;
```

### `expire_unpaid_bookings` — a stranger CANNOT cancel a booking early. Proven.
- Seeded a **fresh** `pending_payment`/`unpaid` booking (created now) and an
  **aged** one (created 2h ago). Fired the RPC **as anon** → HTTP 204.
- Result: fresh booking **stayed `pending_payment`**; aged booking became
  `cancelled`. The stranger only triggered what the next cron run does anyway to
  an already-abandoned booking (the site's own 1-hour hold). A confirmed/paid
  booking is never eligible, and there is no parameter to target one. Idempotent,
  no amplification, no grief window.

### `publish_expired_reviews` — a stranger CANNOT publish a review before its window. Proven.
- Seeded two unpublished reviews; aged one booking's `check_out` to 30 days ago
  (past the 14-day hold), left the other at 3 days ago (in-window). Fired **as
  anon** → HTTP 204.
- Result: **in-window review stayed `is_published=false`**; the 30-day-old one
  published. Same conclusion — only what the cron would already do. (Separately,
  a DB trigger even blocks *inserting* a review after 14 days: `"The 14 day window
  for reviewing this stay has closed."`)

### The residual — low severity, worth doing before launch
Neither function needs to be callable by browser roles. They are invoked by the
Vercel cron under the service role; `anon`/`authenticated` EXECUTE is
unnecessary attack surface that today happens to be harmless because the guards
are internal. **Recommend `REVOKE EXECUTE ON FUNCTION … FROM anon, authenticated`**
on both (one small migration, breaks nothing — the cron uses the service role).
Cost: minutes. This removes the "why is this even reachable" question a future
reviewer will keep asking, and closes it if a guard is ever weakened in an edit.
(For contrast, `adjust_payout_balance` — the money-mover — is correctly **not**
browser-executable; see Task 2.)

---

## TASK 2 — Payout engine on today's master — **RESULT: the four checks pass; PR #45 intact after seven merges**

**Read on master (`e8903a3`) + function verified on test 2026-09-04.** The seven
merges since last night's pass did not touch the payout path — re-verified rather
than assumed.

| Check | Result | Evidence |
|---|---|---|
| **Clamp at zero present** | ✅ | `greatest(0, round(coalesce(payout_balance_owed,0)+p_delta, 2))` — in the live function on test **and** verbatim in the master migration `20260831120000_host_debt_moves_atomically.sql:45–47`. No whole-file paste reverted it. |
| **Exactly three writers, all via the function** | ✅ | `grep payout_balance_owed` across `app/`+`lib/` shows only **reads** (admin page, cron select). The three `rpc('adjust_payout_balance')` callers are `host-payouts/route.ts:369`, `stripe/refund/route.ts:198`, `lib/clawback.ts:131` — the exact three PR #45 names. |
| **Drift warning names a real host** | ✅ | `logError('host-payouts: the same debt looks to have been recovered twice', {expected, actual, deducted, booking_id}, { path, userId: booking.host_id })` — `booking.host_id` is the real host FK. Fires only when the balance came back **lower** than expected (double-recovery), not on a new debt landing mid-flight. |
| **Function locked down** | ✅ (bonus) | `adjust_payout_balance` browser EXECUTE = **(none)**; SECURITY DEFINER; returns `null` (not a cheerful 0) when no host matches. |

**Failure handling is sound** (matters because live transfers actually fail):
per-booking `try/catch` (loop `:115`, catch `:549` → `'host-payouts: transfer
failed'`). A thrown transfer happens *before* the `payouts` insert and the
`paid_out_at` write, so a failed transfer inserts **no** `status:'succeeded'`
row and leaves `paid_out_at` null — the booking is retried next run, and one
failure doesn't abort the batch. A ledger check at the top of the loop is the
real double-pay guard; the idempotency key is the second line.

### What the FIRST REAL payout does differently — the things test mode cannot exercise

The code already anticipates the biggest one, which is worth crediting:

1. **Funds settlement / available balance — *mostly* handled, one assumption to
   hold.** Live card money sits **pending ~a week** before it is available;
   test money is available instantly. The cron runs the day after check-in, so
   without care the first transfer would fail `balance_insufficient`. It names
   the guest's charge as `source_transaction` (via `lib/payoutSource.ts`), so
   Stripe draws against that payment settled-or-not. **The residual, live-only
   case:** a **deposit + balance** booking has two charges; a transfer can name
   only one, and since the host's share usually exceeds either half it **falls
   back to an untied transfer from the platform's available balance**. That is
   safe *only because* the balance charge is taken 30 days before check-in and
   has settled by payout day — a genuine invariant, but one that rests entirely
   on the 30-day rule never shortening. If a future "pay a deposit, balance due
   at X days" option ever sets X < ~7, the first such payout can fail
   `balance_insufficient` and test mode will never show it. Worth a one-line
   assertion or a settled-balance pre-check before the first live run.
2. **Real KYC / `payouts_enabled` state.** In test the flag is a toggle; live it
   reflects real identity verification and can flip to restricted with
   `requirements.currently_due`. The cron reads the **DB** flag (webhook-synced),
   not Stripe live — a host restricted at Stripe but still `true` in the DB gets
   an attempted transfer that fails (caught, logged, retried forever). Someone
   must watch `error_log` for `'transfer failed'` / the `waiting` host log
   (`:584`); nothing pages a human.
3. **Real Stripe processing fees.** The host share is `collected − commission%`;
   Stripe's own fee on the guest charge (~1.5%+20p UK, more international) is not
   in that math — it silently comes out of the platform's commission. **Confirm
   `commission_rate` always exceeds the effective Stripe fee %**, or the platform
   is underwater on that booking. Test fees are fake, so this can only be caught
   with a live charge's real fee. A money-correctness check, not a bug yet.
4. **Disputes/chargebacks landing after a payout** → the clawback path with a
   **real negative platform balance**; test only reaches it via magic card
   numbers, never with real timing.
5. **The one carried-forward must-do** (from last night, still open — I could
   not read prod tonight): **read `adjust_payout_balance` back on production**
   and **confirm the single `acct_…` connected account is yours** before the
   first real run. That is the last "assumed, not observed" on the money path.

---

## TASK 5 — Attacking the companion single-use invite branch — **RESULT: holds; one LOW-severity race (false-success, no over-seat)**

The branch **is pushed and up to date with master** (`companion-single-use-links`,
merge-base == master). Its migrations are applied on test (`ensure_booking_seats`,
the `booking_guests_live_seat` partial unique index, nullable email — all
present). I attacked the accept/seat routes two ways: (a) the **over-mint race**
directly against the DB function, and (b) every accept-route branch replicated
line-for-line from `app/api/booking-guests/accept/route.ts` and run against the
test DB with the service client — which is exactly how the route runs (its only
session-derived inputs are `user.id` / `user.email`). All proven on test
2026-09-04, all seeded rows cleaned up.

### The seat-count race — **CLOSED at the DB layer. Proven.**
"Open the sheet on two devices at once and count the seats": I fired
`ensure_booking_seats` **12× concurrently** on a 4-guest booking (capacity 3).
Result: **exactly 3 live seats**, `seat_index [1,2,3]` — one call minted 3, the
other eleven minted 0 (`ON CONFLICT DO NOTHING` against the partial unique
index). No over-mint, whatever the timing. This is the fix in
`20260903174512_booking_seats_are_atomic.sql` and it does what it says.

### The accept-route attacks — all refused correctly

| Attack | Result | Expected |
|---|---|---|
| Claim a shared link **twice** (same user) | `200 already:true` (idempotent) | ✅ |
| Claim it as a **different** user | **`409` "already used"** | ✅ single-use |
| Claim **after checkout** (checkout in 2020) | **`410` expired** | ✅ |
| Claim a **revoked** (status `removed`) link | **`404`** | ✅ |
| Claim an **old regenerated-away** token | **`404`** (token no longer exists) | ✅ |
| Claim on a **cancelled** booking | **`404`** | ✅ |
| Claim an **inert** (minted-but-never-shared, no email) link | **`409` notReady** | ✅ |

### Removed companion loses the arrival page and the trip — **holds (code-verified)**
`remove` sets `status='invited'`, `user_id=null`, clears name/email, and mints a
fresh token. Both entitlement readers require `status='active'`:
`/api/trips/route.ts:43` (`.eq('status','active')`) and
`app/arrival/[bookingId]/page.tsx:48` (`.eq('user_id',user.id).eq('status','active')`).
A removed companion matches neither, so the trip and the arrival page (address,
door code, wifi) both disappear on the next load, and their old link is dead.

### THE ONE FINDING — LOW severity — double-claim is a false-success race (TOCTOU)
The accept route reads the seat, checks `status !== 'active'`, then does an
**unconditional** `UPDATE … WHERE id = <seat>` — no `AND status <> 'active'`
guard and no affected-row check. **Proven:** two distinct real users claiming
one fresh link *concurrently* both received `200 ok:true`, yet the booking ended
with **exactly one** active seat (owned by the race winner). So:
- **No security impact:** capacity is intact (one token = one row = one seat),
  there is no over-seat and no seat theft — the loser gains **no** active row and
  therefore **no** access to the trip, arrival details, or anything else.
- **The wart:** the losing user is told "you've joined" when they haven't. They
  see nothing on next load and don't know why. Confusing, not dangerous.
- **Fix (cheap):** make the claim conditional —
  `UPDATE … WHERE id = :id AND status <> 'active'` and return `409` when zero
  rows change; or claim inside a small `SECURITY DEFINER` function with a row
  lock, the same shape as `ensure_booking_seats`. Minutes of work. Worth doing
  before launch so two people sharing one link get an honest answer.

### Note carried into Task 6
Every correct refusal above is enforced in **route code**, not the database —
the DB has no policy stopping a forged accept, only the route's service-role
checks. That is fine *because* `booking_guests` writes already go through the
route (the browser has no direct write path that matters here), which is exactly
the shape Task 6 argues booking creation should also take.

---

## TASK 3 — The three carried items — **RE-CHECKED tonight, all three STILL TRUE**

Not trusted from the list — each re-verified on test 2026-09-04.

### 3a. `full_name` leaks via the anon API regardless of `show_full_name` — STILL TRUE
**Proven on test:** anon has a column SELECT grant on `profiles.full_name` and
the SELECT policy is `USING (true)` — **neither consults `show_full_name`**. I
flipped one profile to `show_full_name = false` and read it back as anon:
`[{"full_name":"Cara Nairn","show_full_name":false}]` (then restored). Last night
this was proven on **production** for both directors' legal names; the mechanism
is unchanged.
- **Cost of the real fix:** a masking view `profiles_public` selecting
  `case when show_full_name then full_name else null end`, `grant select` to
  anon/authenticated, **revoke `full_name` from the raw table**, repoint the
  client reads. Half a day plus a careful migration. Do the same `case` on
  `profile_private`.
- **What it breaks:** every client read of `profiles.full_name` must move to the
  view or it starts returning `null`. The risk is a **missed** read showing a
  blank name where a consenting host's name should appear — so the migration
  needs a grep of all `full_name` reads first (~15 sites per last night). A
  consenting host (`show_full_name = true`) still shows through the view, so
  nothing legitimate is lost; the danger is purely an overlooked read.
- **Cheap partial (does NOT close the raw-API read):** route the two remaining
  third-party greeting bypasses (`app/api/booking-guests/route.ts`,
  `app/trip-invite/[token]/page.tsx`) through `displayName` — ~30 min. Leaves the
  raw `select=full_name` open, so it is a stopgap, not the fix.

### 3b. Storage has no owner-scoped upload paths — STILL TRUE
**Proven on test:** the `listings`-bucket INSERT policy is
`WITH CHECK (bucket_id = 'listings')` — **no** `(storage.foldername(name))[1] =
auth.uid()`. Any signed-in account can upload (image, ≤10 MB — the size/MIME caps
from the earlier fix do hold) to **any** path in the bucket, including under
another user's avatar prefix. No UPDATE/DELETE policy, so it's write-only:
namespace pollution and storage cost, **not** overwrite or theft.
- **Cost:** per-user path prefix in the uploader + an INSERT policy
  `(storage.foldername(name))[1] = auth.uid()::text`, plus a one-off migration to
  move existing flat-root objects under their owner. ~half a day.
- **What it breaks:** any code that reads/writes an object by a **flat** path
  (no owner prefix) breaks until repointed — the migration must rename existing
  objects and every stored URL that references them, or old images 404. This is
  the fiddly part, not the policy.

### 3c. Silent guest-experience money routes — STILL TRUE (census 2026-09-04 on master)
Re-counted on master. Worst first:
- **`services/slots/schedule` — silent provider-calendar wipe. HIGHEST.**
  `slot_availability.delete()` (`:77`) then `insert(rows)` (`:86`), **not in a
  transaction**. If the insert throws, the delete has committed → the provider's
  whole availability is gone; the catch (`:98`) returns a 500 with **no logError
  and not even a console.error**. Separately, an empty `rows` runs the delete,
  skips the insert, and returns **`ok:true`** — a silent wipe reported as
  success. Same pattern for `slot_blocks` (`:90/:94`).
  **Fix:** do both writes in one `SECURITY DEFINER` function (atomic), or
  upsert-and-prune instead of delete-all; add `logError` to the catch. 1–2h.
  **Breaks:** nothing — the RPC is a drop-in and the log is additive.
- **`services/order`, `services/orders`, `services/slots/book`** — catch with
  `console.error` only (1, 1, 2 occurrences; **0** `logError`). A broken provider
  Stripe account fails a guest's checkout, or a thrown update leaves a seat
  `holding`, and no `error_log` row is written — directors hear nothing.
- **`cron/ical-sync`** — **0** console.error, **0** logError: a sync failure is
  invisible → double-booking risk with no alert.
- **Webhook post-charge notify catches** — `console.error` only at
  `webhook:347` (slot provider notify), `:376` (slot guest receipt), `:578`
  (service order notify). The guest **is charged**, then the provider is never
  told to fulfil or the guest never gets a receipt, and nothing reaches
  `error_log`. (The webhook logs 25 other failures through `logError` — these
  specific post-charge email catches are the gaps.)
  **Fix for all of these:** swap `console.error` → `logError` in the catch.
  ~1–2h total, mechanical, breaks nothing.

---

## TASK 6 — Moving writes behind server routes: the shape, the estimate, the tables that stop needing browser grants

This is the answer to "does this class of finding keep recurring". The class is:
the browser holds a write grant, and a policy (or a hoped-for one) is doing a job
a server route should do. I mapped **every** browser write grant on the schema
and cross-referenced it against actual client-side writes. Two things fell out.

### Finding A — SEVEN tables already have redundant browser write grants (free to revoke)
For each of these, **zero** client-side writes exist — every write already goes
through a service-role route or cron — yet the browser still holds INSERT/UPDATE
(/DELETE). Revoking changes nothing except shrinking the attack surface:

| Table | Written today by | Browser grant is… |
|---|---|---|
| `booking_guests` | `/api/booking-guests` (service role) | redundant — **companion writes are ALREADY behind a route** |
| `slot_availability` | `/api/services/slots/schedule` + `/book` | redundant |
| `slot_blocks` | same | redundant |
| `slot_sessions` | seat sweep / book route | redundant |
| `stripe_events` | the webhook only | redundant **and a smell** — the browser should never touch the webhook idempotency ledger |
| `sent_reply_nudges` | crons | redundant |
| `sent_review_reminders` | crons | redundant |

None is a *live* hole today (RLS gates them — e.g. anon `INSERT stripe_events`
returns **401 / 42501 RLS violation**, proven), but they are exactly the dead
weight that becomes a hole the day someone adds a permissive policy. **One
migration revoking these seven costs ~1 hour and answers "companion writes" on
its own** — they need nothing built, only the leftover grant removed.
*(Confirm against today's write-side sweep so this isn't duplicated.)*

### Finding B — booking creation is the one genuine browser-write money path
`bookings` has `authenticated INSERT` on 12 columns + `UPDATE(confirmed_at,
status)`, and `components/BookingWidget.tsx:366` still inserts the
`pending_payment` row client-side; host accept/decline updates `status` from
`BookingActions.tsx`. This is the primitive every reader in Task 1 and every
planted-booking finding has had to defend against individually.

**The shape (not to build tonight):**
- `POST /api/bookings/start` — validate dates are free + listing bookable, create
  the `pending_payment` row **under the service role**, return its id;
  `BookingWidget` calls it instead of inserting. (`lib/pricing.ts` stays the sole
  price authority — the route calls it.)
- `POST /api/bookings/decide` — host accept/decline, moving the
  `UPDATE(confirmed_at,status)` server-side; `BookingActions` calls it.
- Then **revoke** `authenticated INSERT(12 cols)` and `UPDATE(confirmed_at,
  status)` on `bookings`, and drop the "guests create their own bookings" policy.
- One more small write to fold in: `sent_scheduled_messages` has a lone
  client-side insert at `BookingActions.tsx:197` — move it into the same
  server action, then revoke that grant too.

**Estimate:** two small routes + one grant/policy migration + the widget/actions
changes + a money-path test pass (booking → checkout → webhook → confirm). ~1 day,
the bulk of it re-running the payment scenarios to prove nothing regressed.

### Which tables end up off the browser write surface
**Free (Finding A):** `booking_guests`, `slot_availability`, `slot_blocks`,
`slot_sessions`, `stripe_events`, `sent_reply_nudges`, `sent_review_reminders`.
**With the ~1-day route work (Finding B):** `bookings`, `sent_scheduled_messages`.
That is **nine** tables — including the whole booking + companion + slot core —
that no longer trust a browser grant. What legitimately *stays* browser-writable
is the self-scoped tier (personal prefs, host self-management, messages), each
gated `user_id = auth.uid()`; those are lower blast-radius and can wait.

**Does this stop the recurrence?** Largely yes for the money/relationship core:
once `bookings` and `booking_guests` can't be written from the browser, the
"any account can forge a booking relationship" primitive — the root of the
planted-booking class — is gone, and future readers stop needing to re-derive
`status='confirmed'` defences one surface at a time. The self-scoped tier keeps
its grants, so the class isn't *eliminated*, but its dangerous half is.

---

## TASK 7 — Unhappy-path scenarios — one HIGH data-loss finding, three medium seams, the rest handled

Each scenario below says **how I checked it** (proven on test / read on master),
what actually happens, whether anyone finds out, and where money or access lands.
Ranked worst-first across the whole set.

### 🔴 HIGH — Deleting a guest account destroys paid bookings and strands the money. PROVEN.
**Proven on test 2026-09-04.** `bookings.guest_id → profiles ON DELETE CASCADE`
(and `host_id` too), while `payments.booking_id`/`payouts.booking_id` are
`ON DELETE SET NULL`. I created a guest with a **confirmed, £500-paid, upcoming**
booking and a payment row, then deleted the profile:
- the booking was **cascade-deleted (GONE)**;
- the payment row **survived but orphaned**: `booking_id: null`, amount 500,
  status `succeeded` — £500 taken, tied to no booking;
- HTTP **204**, no error, no notification.

**Where the money lands:** the host's payout cron reads `bookings`; the booking
is gone, so the host is **never paid** for a stay they may still honour, and the
guest (account deleted) **can't be refunded**. The £500 sits at the platform,
disconnected. Reviews and companions cascade-delete too; a booking that has a
`dispute` or `service_order` would instead make the delete **fail** with an
opaque FK error (`NO ACTION`).

**Would anyone find out?** No. Silent by construction.

**Why it matters now:** no self-delete flow ships today (the privacy/account
pages only *mention* erasure), but GDPR right-to-erasure is a launch requirement.
The moment someone wires "delete my account" to `auth.admin.deleteUser` or a
profile delete, it will silently shred paid bookings and strand money. **Fix:**
erasure must be a controlled process — refuse (or block) while a future confirmed
booking or unsettled payout exists; settle/refund money first; then anonymise
rather than cascade-delete (flip these FKs to `RESTRICT`/`SET NULL` + a scrub of
PII columns). This is a design item to settle **before** an erasure flow, not
after.

### 🟠 MEDIUM — Host calendar block is not enforced against a booking insert (scenario 7). Read on master.
The date-exclusion constraint is `EXCLUDE … WHERE status = 'confirmed'` — it only
knows about **confirmed bookings**, not `calendar_overrides` blocks. So if a host
blocks a date *after* the guest's availability check but *before* the guest
confirms, nothing at the DB layer stops the booking: the guest confirms a stay on
a date the host just blocked. The host ends up with a confirmed booking they
meant to keep free. **Would anyone find out?** The host, when they see the booking
on a blocked date — no alert. **Fix:** re-check `calendar_overrides` in the
booking-start/confirm path, or fold blocks into the exclusion set. Medium — it
needs the host to act in a narrow window, and the damage is a stay they didn't
want, not lost money.

### 🟠 MEDIUM — Free-cancel deadline is judged at processing time, not click time (scenario 1). Read on master.
`lib/cancellation.ts` evaluates the free-cancel cutoff with `today = new Date()`
at the moment the refund is computed (`:129`), against `freeCancelUntil(check_in,
policy)`. A guest who cancels at **23:55 on the last free day** but whose request
is processed a few seconds after midnight is judged **past** the deadline and can
lose the full refund — no grace, evaluated server-side at calc time. **Would
anyone find out?** The guest, via a smaller-than-expected refund; no one else.
**Fix:** stamp the cancel-request time when the guest submits and evaluate the
policy against *that*, not against `new Date()` at refund time. Medium — it only
bites at the exact boundary, but when it does it's real money and reads as unfair.

### 🟠 MEDIUM — Webhook that never arrives → guest charged, booking cancelled, no auto-refund (scenario 10). Read on master.
If the webhook never succeeds within Stripe's retry window, the booking stays
`pending_payment`/`unpaid`, `expire_unpaid_bookings` cancels it after 1h, and
**nothing refunds the guest** — the expiry cron only cancels. Guest charged, no
stay, no refund, and because the webhook never ran there's no `error_log` row
either. **Mitigations that make this rare:** Stripe retries webhooks for ~3 days,
and a late-but-successful delivery *does* recover (see scenario 12); the classic
"signing-secret mismatch" is a local-dev problem, not prod. So this needs a
*persistent* prod webhook outage to bite — low probability, high impact. **Fix/guard:** a reconciliation check (Stripe charges with no confirmed booking)
and alerting on webhook delivery failures. Rank: medium, because the safety net is
Stripe's retry rather than anything in the app.

### 🟡 LOW–MEDIUM — Provider declined/suspended after a guest ordered (scenario 17). Read on master — needs confirmation.
`service_orders.provider_id → service_providers NO ACTION`, and I did not find an
order-refund step in the provider-decline path. Declining usually happens at
application review (before any orders exist), but **suspending an already-approved
provider** after a paid order would leave the guest's order live with no
provider. Worth confirming the admin decline/suspend flow cancels + refunds open
orders. Medium-low (narrow trigger).

### ✅ Handled — checked and sound
| Scenario | How checked | Outcome |
|---|---|---|
| **Two guests, last slot seat** (6) | read master | **Safe** — `slots/book` claims via **compare-and-swap** on `seats_taken` (`:149–151`); the loser's swap fails, nobody is charged for a seat they couldn't have. |
| **Refund a deposit booking, deposit + balance on different cards** (4) | read master | **Safe** — `lib/refundSpread.ts` spreads the refund across both PaymentIntents (the exact "refund > charge amount" bug is already fixed); each card refunds its own charge. |
| **Payout runs while a clawback lands, and reverse** (5) | verified Task 2 | **Safe** — `adjust_payout_balance` is a single-statement read-modify-write with `greatest(0,…)`; concurrent moves serialise, drift warning catches double-recovery. |
| **Webhook arrives twice** (11) | read master | **Safe** — unique `stripe_events.event_id` insert → returns `{duplicate:true}`, handler skipped. |
| **Webhook an hour late, after the booking expired** (12) | read master | **Mostly safe** — the confirm has no status guard so it *un-cancels* the booking, but if the dates were re-taken the exclusion constraint fires `23P01` → refund path. Money safe; a guest may get a confusing "expired then confirmed" sequence. |
| **Guest closes the tab between paying and confirming** (13) | read master | **Safe** — the webhook is server-side; the booking confirms and the email sends regardless of the tab. |
| **Host cancels a stay whose experience is tomorrow / already happened** (3) | read master | **Safe** — `bookings/cancel` (`:298–311`) cancels `authorised` and refunds `confirmed` tied orders and emails **both** sides; a past (settled) experience is correctly left alone. |
| **Two sessions accept one invite link within a second** (9) | proven Task 5 | **Safe-ish** — one seat, capacity intact; the loser gets a false "joined" but no access. Low-sev TOCTOU (Task 5). |
| **Booker removes a companion as they open the arrival page** (8) | proven Task 5 | **Low** — worst case one already-rendered page shows the code; the next load fails (readers require `status='active'`, remove clears it). |
| **Guest books, cancels, rebooks the same dates** (16) | read master | **Safe** — the exclusion constraint only covers `confirmed`, so a cancelled booking frees the dates for a rebook. |
| **Email fails on confirmation / door-code message** (14) | carried from last night §8 | **Logged** — both reach `error_log` (proven last night); the guest can still read the live code on the arrival page. Someone must watch `/admin/errors`. |
| **Host changes the door code the day a guest arrives** (15) | carried from last night §10 | **Low** — arrival page reads the code live (guest sees the new one); an already-sent door-code message keeps the old one — set the physical lock to match. |
| **Listing hidden while a confirmed booking exists** (18) | read master | **Low** — arrival/trip read via the service role by booking id, not via the public listing policy, so the confirmed guest keeps address/code access; the listing just stops being publicly bookable. |

### Scenario I flag as not-fully-settled tonight
- **Guest cancels while the balance-charge cron is mid-run on the same booking**
  (2). Both paths touch the booking and move money; the balance job claims an
  `attempting` row and the ledger-first ordering guards double-counting, but a
  cancel landing *inside* the charge is a genuine interleaving I could not drive
  end-to-end here (it needs the balance cron and a Stripe charge in flight
  together). The pieces that would make it safe are present (idempotent ledger,
  `attempting` claim); **worth one scripted end-to-end run before launch** rather
  than trusting the read. Ranked: unknown, lean-medium.

---

## Task ledger — checked tonight vs carried forward

Because OUTSTANDING.md has misled three sessions by being stale in both
directions, here is exactly what this run touched.

| Task | What I did tonight | Method | New vs carried |
|---|---|---|---|
| 1 — read sweep | Swept every `service_*`/`slot_*` table + 3 views as anon and as an ordinary signed-in account; pinned each refusal to grant vs policy; seeded another host's enquiry to prove the filter | **proven on test** + master migration files | **NEW** — first table-by-table read sweep since 28 Aug |
| 2 — payout engine | Re-verified clamp, three writers, no direct writes, drift warning host id, per-booking failure handling; listed live-only differences | read on master + function on test | mostly **carried**, re-verified on today's master |
| 3 — carried items | Re-proved `full_name` leak (flag-independent), storage path gap, silent-route census incl. the schedule-wipe hazard | **proven on test** + master | **carried, re-checked** — all three still true |
| 4 — two crons | Fired both as anon; proved fresh booking survives, in-window review stays unpublished | **proven on test** | **NEW** |
| 5 — companion branch | 12× concurrent over-mint race; all six accept-route attacks; the double-claim race with two real users | **proven on test** (route logic replicated) | **NEW** (branch pushed & rebased) |
| 6 — server-route scope | Mapped every browser write grant; found 7 redundant + booking-creation path; shape + estimate | **proven on test** + client-write grep | **NEW** analysis |
| 7 — unhappy paths | 19 scenarios: proved the account-deletion cascade; read/reasoned the rest, ranked | **1 proven on test**, rest read on master | **NEW** |

### What I could NOT check tonight, and why
- **Any live production value.** `migrate.mjs --target prod --sql` (read-only) is
  refused by this session's command classifier. Every prod claim here is carried
  from last night or inferred from master migration files. This is a harness
  limit, **not** a "prod is protected" result. The prod-open items: (a) confirm
  the service-table revokes are applied on prod; (b) read `adjust_payout_balance`
  back on prod; (c) confirm the single `acct_…`.
- **Scenario 2** (cancel during the balance cron) end-to-end — needs the balance
  cron and a Stripe charge in flight together; the safety pieces are present but
  I did not drive the interleave.
- **Live HTTP** against the running app for Task 5 — I replicated the accept
  route's decision logic against the DB (faithful, since the route does all its
  work via the service client); a live HTTP re-test is the final confirmation.

### Test-project housekeeping
This run created throwaway test accounts (`sweep-stranger@`, `sweep-otherhost@`,
`personb@`, `delete-me-0904@` — the last deleted at end) and seeded/cleaned
bookings, seats, reviews, and one enquiry on the **test** project only. All
seeded rows were deleted; the accounts are harmless test users.
