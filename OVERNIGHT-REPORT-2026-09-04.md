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

*(Sections are filled as each task completes; see the task ledger at the end for
what was checked tonight vs. carried forward.)*

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
