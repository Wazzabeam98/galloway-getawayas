# Overnight report — night of 2→3 September 2026 (second pass)

Every claim below is dated and says **how it was checked**, because OUTSTANDING.md
has now misled three sessions by being stale in both directions. "Verified on
test" means I built the request and read the result back off the test project
(`yefoqcabuijcowoqewtc`) — this machine holds no production key, so production
was never written to. "Read on master" means I read the code as it stands on
master today. "Proven on prod (read-only)" means I used the **public** anon key
from the live JS bundle to GET — never a write.

Nothing was merged, nothing deployed, no production migration applied.

---

## The one thing to do first

**Merge PR #99 (`fix/arrival-pii-entitlement`) after reading it, and apply its
two migrations to production first.** It closes a proven, signed-in-reachable
leak of every host's contact + financial PII and a **payout-redirection write**,
and it is the fix you asked for. Order of operations is at the end of §1.

---

## 1 — The arrival/PII fix — BUILT, PROVEN, PR #99 (not merged)

**Status: done and proven, waiting on your read.** Verified end-to-end on test
2026-09-03; code read on master; shipped as PR #99, auto-merge OFF.

### What leaked, and the one rule that now governs all of it

Four readers released private data because a booking row **existed**, never
checking it was real. Any signed-in account plants an unpaid `pending_payment`
booking on any listing for free (the checkout INSERT policy allows it — verified
on test: insert with the attacker's own JWT returned HTTP 201). The fix is one
predicate, `lib/bookingEntitlement.ts` → `bookingReleasesPrivateData(booking)` =
`status === 'confirmed'`, imported by the three TS readers, with the SQL twin in
`profile_private`. **What each surface now allows and what a real guest loses:**

| Surface | Allowed status | A legit guest loses… |
|---|---|---|
| `profile_private` (view) | `confirmed` only | nothing — a confirmed counterparty still reads the other's details (proven) |
| arrival page | `confirmed` only | a `pending` (paid, host not yet accepted) guest waits for acceptance — correct, there is no agreed stay yet |
| `/api/trips` arrival attach | `confirmed` only | same; the trips LIST still shows all their bookings, only the address attach waits |
| `contactNumberVisible` | `confirmed` + near-arrival | nothing — confirmed guest still gets the number the day before arrival (pinned in tests) |

**Specifically, the two windows you asked about:**
- *Booking pending host acceptance:* does NOT see the address before the host
  says yes. Correct — a request-to-book is not an agreed stay; the moment the
  host accepts it flips to `confirmed` and everything appears.
- *Between paying and the webhook confirming:* the row is still
  `pending_payment` for those seconds, so no arrival details show. You are
  booking, not arriving — nothing is lost, and the alternative is the leak.

### Proven leak → refuse → legit (the last one mattered most to you)

- **`profile_private` READ** — `audit-evidence/20`. Attacker plants
  `pending_payment` (HTTP 201) → reads host email/phone/`stripe_account_id`/
  `payout_balance_owed` (LEAK) → migration applied → same booking reads **nothing**
  (REFUSE) → a **confirmed** guest still reads all of it (LEGIT). Re-runnable:
  `node scripts/prove-arrival-entitlement.mjs`.
- **arrival page + `/api/trips`** — `audit-evidence/21`. Dev server, real session
  cookies. Pre-fix: planted booking rendered **door code, wifi, address, w3w**.
  Fixed: `/arrival` → **307 to /trips**, `/api/trips` → **no arrival block**;
  the confirmed guest still got the lot.
- **`contactNumberVisible`** — `tests/booking-entitlement.test.ts`, pins every
  status including "a confirmed guest is NOT locked out near arrival".

### A WORSE hole found alongside it — payout redirection — also fixed here

`authenticated` still held inherited **INSERT/UPDATE** on `profile_private` and
`service_provider_own_contacts` (Supabase's default `grant all` on new views was
revoked for `anon` only — verified live: `authenticated` = `INSERT,REFERENCES,
SELECT,TRIGGER,UPDATE`). Both are `SECURITY DEFINER` views owned by a bypass-RLS
role with no `WITH CHECK OPTION`, so a write goes **through the view into the
base table as postgres**, past RLS and the column revokes. **Proven on test
2026-09-03:** a signed-in guest ran `PATCH profile_private?id=eq.<host>
{stripe_account_id: <attacker acct>}` → **HTTP 200, host row overwritten** →
that is the account the next payout is sent to. After migration `20260903011803`
(views read-only): **HTTP 403, unchanged**, and SELECT still works. This is
worse than the read leak and shares its root cause; it is in PR #99.

### Order of operations for merging PR #99
1. Apply `20260903011742` (profile_private counterparty must be confirmed) to
   **production** — pure `create or replace view`, atomic, no window.
2. Apply `20260903011803` (browser views read-only) to production — pure revoke.
   (1 and 2 are independent; either order.)
3. Read back on prod: `profile_private` grants = `authenticated` SELECT only;
   the view's WHERE carries `and b.status = 'confirmed'`.
4. Then merge the PR. The app code already treats a non-confirmed counterparty as
   none, so steps 1–2 are safe to land before the code.

---

## 2 — The layer underneath — the INSERT policy, and the class-removing change

**Read on master 2026-09-03.** With PR #99 in, a planted `pending_payment`
booking now grants **nothing** (no PII, no arrival, and it was never counted as a
busy night, and the 30-minute hold frees its dates). So narrowing the INSERT
policy is now **defence-in-depth, not a live hole.** The question is whether to
do it anyway.

**Does checkout genuinely need the browser insert?** Yes, as built.
`components/BookingWidget.tsx:366` is the sole client insert; it creates the
`pending_payment` row, then redirects to Stripe Checkout carrying its id; the
webhook flips it to `pending`/`confirmed` under the service role. Remove the
browser insert without replacing the flow and checkout breaks.

**If the browser must create it, what bounds the abuse (row-spam, since the leak
is closed)?**
- **One open attempt per (listing, guest):** a partial unique index on
  `(listing_id, guest_id) where status = 'pending_payment'`. Stops an account
  manufacturing thousands of rows against one listing; a genuine abandon-and-retry
  still works because the 30-minute expiry clears the prior one. *Caveat to check
  first:* confirm the expiry **deletes** the row, not just frees the dates — if
  rows accumulate, spam is still cheap (see §7 open question).
- **Rate limiting:** the existing `rate_limit_hits` infra could cap booking
  inserts per user/IP, the same lever `services/apply` uses.
- **Expiry:** already partly present (30-min hold). Make it delete abandoned
  `pending_payment` rows so they cannot pile up.

**The change that removes the CLASS, not this instance (scope, not built):**
move booking creation behind a server route, the way the money paths already
are.
- **New:** `POST /api/bookings/start` — validates the dates are free and the
  listing is bookable, creates the `pending_payment` row **under the service
  role**, returns the id. `BookingWidget` calls it instead of inserting.
- **Then revoke** the browser `INSERT` (12-col) grant and drop the "Guests can
  create their own bookings" policy; also fold the browser
  `UPDATE(status,confirmed_at)` grant (host accept/decline via
  `BookingActions.tsx`) into a server route (`/api/bookings/decide`), so the
  browser can no longer write bookings at all.
- **Cost:** two small routes, one grant/policy migration, one widget change,
  and a money-path test pass (the booking→checkout→webhook chain). Medium, but
  it deletes the "any account can forge a booking relationship" primitive that
  every reader in §3 has to defend against individually. Recommended before the
  experiences phase widens the surface further.

---

## 3 — Same-class sweep: privileged data on a relationship row that isn't checked

**Read on master + verified table shapes on test 2026-09-03.** The four original
readers are fixed (PR #99). Full list of every other join-grants-a-read
relationship, worst-first:

1. **`listings` full row to ANY `authenticated` user — LEAKS, no relationship
   needed.** `GRANT ALL ON listings TO authenticated` (base schema) was never
   column-scoped; the location-privacy migration re-scoped **anon only**. So any
   signed-in account can `select street_address, postcode, latitude, longitude,
   ical_token, commission_rate from listings where id=eq.<any published listing>`
   over PostgREST. `ical_token` is the calendar-export secret; `commission_rate`
   is commercial. **This is the most directly exploitable and is NOT in PR #99.**
   Fix shape: give `authenticated` the same column allow-list `anon` has; the
   confirmed-guest exact address already comes from a service-role reader (the
   arrival page), so nothing legitimate breaks. *Cross-check:* on **production**,
   the **anon** role is correctly refused these columns (proven read-only, §6) —
   this is an `authenticated`-only leak.
2. **`may_read_listing()` trusts a `bookings` row on existence — forgeable,
   NEEDS-STATE-CHECK.** `20260828193000_listings_read_policy.sql` has three
   `exists` branches with no status filter: a planted `pending_payment` booking
   (or a `booking_guests` row) unlocks a **draft/hidden** listing's full row
   (amplified by #1 into the address/`ical_token` leak). Fix: add
   `b.status='confirmed'` to the bookings/booking_guests branches and
   `la.status='active'` to the access branch — the same rule as
   `bookingReleasesPrivateData`.
3. **Revoked/invited co-host keeps listing-row read — minor.** Same policy's
   `listing_access` branch ignores status; not browser-forgeable (owner-only
   INSERT), so low severity, matters only alongside #1.

**Checked and SAFE** (each checks the relationship *state*, or the row can't be
forged): `booking_guests` companions (all readers check `status='active'`),
`listing_access` co-hosts (`lib/access.ts` checks `active`; owner-only INSERT),
`service_orders` (service-role only, not browser-insertable), `service_enquiries`
(INSERT needs provider `status='approved'`; PII is the host's own), `messages`
(participant-gated; planted booking only exposes messages the attacker sent),
`payments`/`payouts` (payments existence-based but a planted booking has no
payment rows; payouts admin-only), `reviews` (INSERT needs booking
`status='confirmed'` AND checkout passed), `service_applications` (RLS on, no
policies, revoked). Note for later: the order/enquiry **message-participant**
functions gate on existence with no status filter — harmless today because the
rows aren't browser-forgeable, but they become the same shape the day
`service_orders`/`service_enquiries` gain a browser INSERT grant.

---

## 4 — Granted views: what a stranger reaches, and can WRITE

**Verified live on test 2026-09-03.** Exactly three views are reachable by
browser roles:

| View | anon | authenticated | Writable through it? |
|---|---|---|---|
| `profile_private` | none | was SELECT+**INSERT+UPDATE** | **YES → payout hijack (fixed in PR #99)** |
| `service_provider_own_contacts` | none | was SELECT+**INSERT+UPDATE** | **YES** — UPDATE limited to own rows, but no CHECK OPTION so INSERT can name another `owner_id` (fixed in PR #99) |
| `listing_busy_nights` | SELECT | SELECT | No (read-only already) |

All three are SECURITY DEFINER owned by a bypass-RLS role with **no WITH CHECK
OPTION** — the WHERE is the whole of the protection and does not constrain a
write's SET list. PR #99's `20260903011803` revokes the writes from both
`profile_private` and `service_provider_own_contacts`. `listing_busy_nights`
exposes `listing_id, check_in, check_out, status` for `pending`/`confirmed` rows
to anon (a public availability calendar) — it leaks the `status` string
(pending vs confirmed) but no identity or money; consider dropping `status` from
it. **The root cause is general** — Supabase grants `all` on every new view to
`anon, authenticated`; any future browser-facing view needs `grant select` + a
revoke of the rest.

---

## 5 — Payout engine before the first real payout — PR #45 is IN, and INTACT

**Read on master + verified the function on test 2026-09-03.** Important
correction: **PR #45 is already MERGED** (commit `9990ed7`, 31 Aug) — the "before
it merges" framing is stale. Its migration `20260831120000_host_debt_moves_
atomically.sql` is in master and, per the ledger (prod == test identical across
4,334 facts at the 1 Sep backfill), applied to production. So the questions that
still matter — is the fix intact, are the writers still three, is the clamp
present — I answered against master:

- **The atomic function exists and is correct.** `adjust_payout_balance(host,
  delta)` does `set payout_balance_owed = greatest(0, round(coalesce(...,0) +
  delta, 2))` — read-modify-write in one statement, **clamp at zero present**
  (`greatest(0, …)`), SECURITY DEFINER, and **revoked from anon/authenticated/
  public** (verified live: no browser-role grant on the routine).
- **Exactly three writers, all through the function, no direct writes left.**
  `grep payout_balance_owed: app lib` returns **nothing** (no `.update({payout_
  balance_owed})` anywhere). The three `rpc('adjust_payout_balance')` callers are
  `lib/clawback.ts:131` (carry-forward), `app/api/stripe/refund/route.ts:198`
  (5% penalty), `app/api/cron/host-payouts/route.ts:369` (recovery decrement) —
  the exact three the migration names. No whole-file paste has reverted it.
- **The overpayment direction is closed.** The payout run reads the clamped
  balance and deducts `Math.min(owed, hostShare)`, so `owed` is never negative
  and the transfer is never more than the host's share. The drift warning fires
  (`logError('the same debt looks to have been recovered twice', {expected,
  actual, deducted, booking})`, with the host id) when the balance comes back
  lower than expected, and partial recovery is recorded as **partial**, not
  marked settled — the "books agreed afterwards so it could never fire again"
  failure is closed.
- **What I could NOT check from here:** that the function and migration are
  genuinely on **production** (no prod key). The ledger says so as an assumption
  from the 1 Sep comparison, not a live read. **Read `adjust_payout_balance` back
  on prod before the first real payout run** — it is a two-minute check and it is
  the one thing standing between "proven" and "assumed" on the money path.

---

## 6 — Production crawl as a signed-out stranger (re-established, not re-quoted)

**Proven read-only on production 2026-09-03** with the public anon key read from
the live bundle (`audit-evidence/23`). JS browser, not curl.

- **Public pages:** `/`, `/homes/[id]`, `/holiday-cottages/{town}`, `/business`,
  `/services/property`, `/contact`, `/terms`, `/privacy`, `/cancellation-policy`,
  `/addhome`, `/trips`, `/dashboard`. Homepage + listing pages are
  server-rendered; a listing page to anon shows **town-level** location + the
  host's display name, **no** exact address/postcode/phone/email. Location
  privacy holds at the page level.
- **The anon surface is tight.** Every PII/money/secret table refuses anon:
  `profiles`(email/phone), `profile_private`, `bookings`, `listings`(sensitive
  columns incl. `ical_token`), `listing_arrival`, `listing_access_codes`,
  `payments`, `payouts`, `disputes`, `error_log`, `service_orders`,
  `service_providers`, `admin_actions` — all 401.
- **The one live anonymous leak: `profiles.full_name`.** `select=full_name`
  returned **"Liam Worrall", "Jamie Clarke"** — both directors' legal names, and
  every guest's, are enumerable by any anonymous visitor, **regardless of
  `show_full_name`** (see §7). Minor: `calendar_overrides` is anon-readable and
  exposes every listing's per-date `price_override`/`is_blocked`.
- **Important framing:** tonight's `profile_private` and `listings`-column holes
  need a **signed-in** account (`authenticated`), a different role than `anon` —
  not reachable anonymously, but reachable by anyone who makes a free account.

---

## 7 — Outstanding items, re-checked

- **`full_name` ignores `show_full_name` at the data layer — TRUE, proven on
  prod (anon read).** Two layers cost it out (from the sweep): (A) the two
  remaining third-party greeting bypasses are `app/api/booking-guests/route.ts:123`
  and `app/trip-invite/[token]/page.tsx:49` (the other four the old note named
  are own-name greetings — a person seeing their own name — and are fine);
  ~30 min to route both through `displayName`. (B) the durable fix is a masking
  view: `profiles_public` selecting `case when show_full_name then full_name else
  null end`, grant SELECT to anon/authenticated, **revoke `full_name` from the
  raw table**, repoint the ~15 client reads. Half a day + a careful migration;
  only (B) closes the raw-API read. Do the same `case` on `profile_private`.
- **Silent routes — the count is now 16 of 76, not 24** (verified by census
  2026-09-03; some of the old 24 have no catch at all, others gained logError).
  The money/experience ones catching with `console.error` only, and what a
  failure looks like to the person:
  - `services/slots/schedule` — **delete-then-insert of availability**; if the
    insert throws after the delete, the provider's **whole calendar is wiped**,
    no error logged, no console.error even. Highest severity — silent provider
    data loss.
  - `services/slots/book` — a thrown update can leave the seat `holding`,
    blocking capacity until a cron clears it; guest sees "that time filled up".
  - `services/order` — a broken provider Stripe account fails every guest's
    checkout silently; directors get no `error_log` row.
  - `services/orders` (GET) — provider's order list blanks; they may think they
    have no bookings.
  - `cron/ical-sync` — sync failure invisible → double-booking risk, not even a
    console.error.
  - Plus three **post-charge** webhook email catches (`webhook:346` slot provider
    notify, `:375` slot guest receipt, `:598` order provider notify) that use
    `console.error` — the guest is charged and hears nothing, or the provider is
    never told to fulfil. These should be `logError`. ~1–2 hours, mechanical.
- **Storage still has no owner-scoped upload paths — TRUE** (verified on test).
  The `listings`-bucket INSERT policy checks only `bucket_id='listings'`, not
  `(storage.foldername(name))[1] = auth.uid()`. A signed-in account can upload
  (image, ≤10 MiB) to **any** path, incl. under another user's avatar prefix;
  cannot overwrite (no UPDATE policy) or delete (no DELETE policy). Namespace
  pollution / cost, not theft. Fix: per-user path prefix + a `foldername[1] =
  auth.uid()` INSERT policy, plus a one-off migration of the flat-root objects.

- **Open question I could not close:** does the 30-minute hold **delete**
  abandoned `pending_payment` rows or only free their dates? It bears on §2's
  row-spam bound. Worth a one-line check of `cron/service-orders` /the hold sweep
  before relying on expiry as the limiter.

---

## 8 — Email failures now surface — PROVEN failing

**Proven on test 2026-09-03** (`audit-evidence/22`;
`scripts/prove-email-failure-surfaces.mjs`). Reporting lives inside
`lib/email.ts` `sendEmail` → `report` → `logError` → `error_log`. I broke the
send (invalid `RESEND_API_KEY`, so Resend answers 401 before anything is sent)
and drove the same `sendEmail` the money paths call, for the balance-ladder,
payout and order subjects. **All three surfaced** in `error_log` with recipient
+ status 401 + the **subject naming which email** — enough to chase which mail
failed and to whom. The **dispute** notice (the one carrying the evidence
deadline) is reported **twice**: `sendEmailToAll`'s own `report`, plus the
webhook's dedicated `logError('a dispute alert did not send', {dispute, booking,
failed, reached})` — verified by reading `webhook:107-115`. The four paths that
matter (72/48/24 ladder, payout, order, dispute) all funnel through this
reporting.

---

## 9 — Branch A (provider sign-up / adaptive wizard) — reviewed

**Static review of `origin/overnight/guest-experiences` 2026-09-03 (read-only).**
- **The slot-provider opening-hours bug is FIXED.** A slot provider now finishes
  sign-up with **real `slot_availability` rows** (`day_of_week, open_time,
  close_time`): collected in `ProviderSignUp.tsx` (`guestScheduleRows()`
  ~1566), POSTed to `/api/services/apply` (whitelisted to those columns), stored
  on `service_applications` **before any account exists**, and inserted with a
  server-stamped `provider_id` in `/api/services/finish` (~156-162). Columns
  confirmed on test. The prior "empty calendar" (schedule lived only in client
  state) is closed.
- **Reachable/completable:** guest flow trade → business → finish; all required
  fields have inputs; the inferred shape defaults rather than going undefined;
  slot trades get the schedule step, request trades don't. No dead-end found.
- **No regression in apply/finish:** account is still created only in `/finish`
  after the emailed token proves the address; everything the old finish wrote is
  still written.
- **One residual to guard:** nothing forces a slot applicant to open at least one
  day, so an **empty** calendar is still reachable by leaving every day closed —
  now a visible choice, editable before approval, not silent data loss. Add an
  "open at least one day" validation for `shape==='slot'`.
- **Live walk:** the other worktree session has this branch checked out and has
  staged "the preview URL, sign-ins, and the walk list" for the morning. On the
  shared local dev server (:3000) the `/services/join` shell rendered fine at
  375px (header/footer/layout intact) but the wizard body stuck on "Loading…"
  with 404 chunk errors — a stale-bundle artifact of that server rebuilding, not
  a confirmed wizard bug; do a hard refresh on the staged preview.

---

## Evidence index (all under `audit-evidence/`, all re-runnable)
- `20-*` profile_private read + payout-hijack write: leak → refuse → legit
- `21-*` arrival page + /api/trips: leak → refuse → legit (dev server)
- `22-*` email failure reaches error_log
- `23-*` production anonymous crawl
Scripts: `scripts/prove-arrival-entitlement.mjs`,
`scripts/prove-arrival-routes-e2e.mjs`, `scripts/prove-email-failure-surfaces.mjs`.
