# Security audit — overnight, 28→29 August 2026

Everything in one place, as asked. Two parts: **what I fixed on production while
you slept**, and **the wider audit**, ordered by what actually loses you money or
data.

Ground rules I worked under, and kept: migrations to production *before* the
code merges; **nothing merged to master**; every probe row and account removed;
production proven clean at the end. The one thing I could not close live is
explained where it sits — it needs a deploy, and you said don't deploy.

Branch: `audit/write-side-grants`. Test suite: **749 pass, 0 fail.**

---

## PART 1 — the four live holes: fixed and proven

Each was proven going through against production first, fixed with a migration
applied to **test then production**, then proven refused. Raw output is in
`audit-evidence/` (files named per step). The one probe that measures all four:

```
node scripts/write-side-rls.mjs --target prod
```

Before: **5 WRITABLE**. After all three migrations: **0 WRITABLE, 24 refused.**

### 1. Self-set `is_admin` — CLOSED (was: anyone with an email → admin of the live site)

Migration `20260829010000_profiles_are_not_self_administered.sql`.

`profiles` had the blanket default grant, so the policy `USING (auth.uid()=id)`
let a user write *any* of their own 22 columns. Revoked table INSERT/UPDATE;
granted back only the six the account page and the two signup forms actually
send (`full_name, preferred_name, phone, residential_address, avatar_url,
show_full_name`, plus `id, email, is_host` for signup). `is_admin`,
`payout_balance_owed`, `identity_verified`, `stripe_account_id` and the rest are
no longer writable from a browser at all. Added an explicit `WITH CHECK` to the
update policy.

- **Before:** created a free account, set `is_admin=true` on my own row → went through. Reverted.
- **After:** `refused by the grant — 42501`. The whole chain (signup → confirm own email → self-admin) now stops at step 3. `audit-evidence/01-before-all-four.txt` vs `03-after-profiles.txt`.

### 2. Self-set `payout_balance_owed` — CLOSED

Same migration, same mechanism. A user set their own owed-balance to 5000 on
production before; now `refused — 42501`. I did **not** trace whether the payout
run reads this column as an instruction or recomputes it — flagged below under
"worth an hour before the next payout run", but it can no longer be self-set
regardless.

### 3. The £0 confirmed-and-paid booking insert — CLOSED

Migration `20260829011000_a_booking_cannot_arrive_paid.sql`.

`bookings` INSERT policy was only `guest_id = auth.uid()`; every other column was
the caller's to choose. Narrowed the grant to the 12 columns
`components/BookingWidget.tsx` sends, and tightened the policy so a booking may
only be *created* owing money:
`status in ('pending','pending_payment') and payment_status='unpaid' and confirmed_at is null`.
`payment_status`, `amount_paid`, `commission_rate`, `payout_amount` and the whole
Stripe set are no longer browser-writable. UPDATE narrowed to the two columns a
host actually changes when accepting (`status`, `confirmed_at`) — previously a
host could rewrite `total_price`/`payout_amount` on their own bookings.

- **Before:** inserted a `confirmed`/`paid`/£0 booking in another host's cottage. Deleted.
- **After:** `refused — 42501 permission denied for table bookings`.

### 4. The reviews policy OR'd with the strict ones — CLOSED

Migration `20260829012000_a_review_needs_a_stay.sql`.

Three INSERT policies; permissive policies are OR'd, so `reviews - write own`
(`auth.uid()=reviewer_id`) granted everything the two careful "after a completed
stay" policies withheld. Dropped it. Also narrowed the grant so `is_published`
and `published_at` are no longer browser-writable (a reviewer could otherwise
publish their own review out of its blind window and read the other side early).
Checked first that production holds zero reviews and that nothing ever sets a
booking to `completed`, so the two remaining strict policies match reality.

- **Before:** wrote a 1-star review against a booking I was never on. Deleted.
- **After:** `refused — 42501 new row violates row-level security policy`.

### The negative control — nothing legitimate broke

A refusal script scores a database that refused *everything* as perfect, so I
wrote its opposite:

```
node scripts/write-side-allowed.mjs --target prod
```

It performs all 11 legitimate writes copied column-for-column from the deployed
browser code (account edits, signup, create booking, host accept, leave review,
host reply). **11 still work, 0 broken** on production.

### A live bug this uncovered — the account page has been broken since last night

`write-side-allowed.mjs` failed 7/11 on the first run — and the cause **predates
this branch**. Last night's `20260828234003` revoked table-level SELECT on
`profiles` (correct — it hid email/phone/address). But the account page and both
signup forms wrote profiles with `upsert()`, and PostgREST compiles upsert to
`INSERT … ON CONFLICT DO UPDATE`, which needs SELECT on every column it writes.
So **every profile save has been returning "permission denied for table
profiles" since that migration reached production.** I reproduced it with last
night's exact grants to be certain it wasn't my change.

Fixed in code (not a migration): the `add_profile_for_new_user` trigger already
creates the row, so the upsert was never needed. All five call sites in
`app/account/page.tsx`, plus `components/auth/SignupModel.tsx` and
`components/services/ProviderSignUp.tsx`, are now plain `update()`s writing only
the changed field. This is **code**, so it only reaches users when you deploy —
see the note at the end about what is live vs. what is staged.

### And the tool you asked me to fix

`scripts/data-privacy-rls.mjs` called `loadEnv()` with no argument, which reads
`.env.local` — the **test** project. `--target prod` only skipped the guard; it
never repointed. So every "against PRODUCTION" run it ever printed was querying
test, and **nothing it reported about production was ever true.** Fixed: it now
loads `.env.production.local` under `--target prod` and verifies the project ref
both ways. Ran for real against production for the first time:
**28 passed, 0 failed** (`audit-evidence/07-...`). The read side is genuinely
clean — email, phone, address, all Stripe and payout columns refuse the anon
key; display name and avatar still readable; calendar still works.

---

## PART 2 — the wider audit, worst first

I worked as an attacker with the public anon key and a free account. Verdicts
are backed by either a live probe against production (cleaned up) or a reading of
the exact code. "Proven" means I saw it; "code-level" means I read the path but
did not land a live request.

### A. The `getSession()` family — 14 routes trust a forgeable identity — HIGH, staged not live

This is the biggest single thing, and it is the "34 routes on the list for days"
item. `supabase.auth.getSession()` reads the caller's id from the auth cookie
**without verifying the JWT signature**. `getUser()` verifies with the auth
server; the admin routes already use it. 14 non-admin routes use `getSession()`
and then trust `session.user.id` for authorization or mutation.

**I proved the primitive against the exact installed library**
(`audit-evidence/14-cookie-primitive-proof.txt`): handed
`@supabase/auth-helpers-shared` a cookie containing a JWT with a victim's `sub`
and an **attacker-invented signature**, and it returned
`session.user.id = <victim>`, valid shape, future expiry, no signature check.
The library source confirms it — `GoTrueClient.__loadSession` validates only
shape and expiry, never the signature. So an attacker who writes their own
cookie becomes any user id they choose.

**Honesty on the repro:** I could not land the full end-to-end HTTP request
against `gallowaygetaways.co.uk` — my hand-built cookie produced a null session
even with a *real* token, which means the deployed cookie wire-format differs
from what I constructed from outside (chunking/encoding). That is a
test-harness limitation, not a mitigation: the vulnerable code is the code that
runs the site, and the forgery primitive is proven against it. A real attacker
reproduces the format trivially — they log in, copy their own cookie's
structure, and swap the id.

The 14, ranked by what a forged id gets you (all file:line evidence in the
branch):

**Money / takeover:**
1. `stripe/refund` — forge a booking's host_id → issue a real Stripe refund of the full paid amount and claw back the host's payout, on any booking.
2. `stripe/connect` — forge a host's uid + attacker email → staple a brand-new Stripe Express account (attacker's) onto the victim's profile; future payouts route to the attacker.
3. `bookings/host-refund` — forge host_id → refund + payout clawback on others' bookings (money returns to the guest's card, so it's disruption/clawback, not direct theft).
4. `bookings/cancel` — forge guest_id → cancel anyone's reservation.

**Personal data / physical:**
5. `listings/access-code` — forge owner/co-host uid → **read the property's door entry code in the clear**, or overwrite it.
6. `messages/threads/[bookingId]` — forge a party's uid → read the full conversation, the other party's name and **phone number**, and the money fields.
7. `messages/threads` — forge a victim uid → enumerate their whole inbox.
8. `trips` — forge a victim uid → read their upcoming stays (property, dates, location).
9. `listing-access` — forge a listing owner's uid → grant yourself durable co-host access (a privilege escalation) and fire invite emails.
10. `booking-guests` — forge guest_id → add/remove companions on a stranger's booking, send email in the booker's name.
11. `listings/visibility` — forge owner uid → hide/unhide anyone's listing.
12. `stripe/payout-schedule` — forge host uid → alter when a stranger gets paid.
13. `stripe/checkout` / `balance-checkout` — forge guest_id → read a stranger's booking/price data (checkout also rewrites `total_price`).
14. `notify` — forge a party's id → drive booking emails on strangers' bookings (spam/phishing primitive).

**Cost / how to fix:** for the attacker, ~free — craft a cookie. Fix is the
one-line swap `getSession()` → `getUser()`, deriving id/email from `user`,
exactly as the 9 already-migrated routes do. **I did not do this tonight:** you
asked to *trace* these ("what each one actually lets you do"), not fix them; the
memory frames this as a task you're scoping; and it's a 14-route change that
only takes effect on deploy, which the rules forbid — so fixing it in code would
not close anything live tonight anyway. It's ready for your call. The four DB
holes I *did* close protect the RLS-enforced paths even against a forged cookie —
but the routes above use the **service role**, which bypasses RLS, so only the
`getUser()` fix closes them.

### B. `services/apply` — anonymous, unauthenticated, creates auth users — HIGH

`POST /api/services/apply` goes straight to the service role with **no auth gate
at all**. A stranger can: create real Supabase auth users on arbitrary email
addresses (account-squat a victim's email so they can't sign up, and trigger a
"confirm your signup" email to anyone); flood `service_providers` and its child
tables unbounded; and **exhaust the project-wide SMTP quota**, which would block
real password-reset and confirmation emails site-wide. Only validation is
password length ≥ 8 and a valid trade key. This is part of the unmerged services
phase — worth an auth gate / captcha / rate limit before it ships. Cost to
attacker: nothing.

### C. `import-listing` — SSRF via a bypassable host allowlist — HIGH (needs a session)

`POST /api/import-listing` fetches a caller-supplied URL server-side. The
allowlist is `['airbnb.','booking.com'].some(h => hostname.includes(h))` —
`.includes()`, so `airbnb.evil.com` or `booking.com.evil.com` pass. Point such a
hostname's DNS at a link-local address (e.g. cloud metadata `169.254.169.254`)
and the server fetches it, returning `og:` content back to the caller — a
semi-blind SSRF that can leak internal responses. Gated only by the (forgeable)
`getSession`. Fix: exact-hostname allowlist + block private/link-local resolved
IPs.

### D. A host can publish a listing past admin review — HIGH (my find, live-proven)

`listings` UPDATE is `USING (auth.uid()=host_id)` with no column restriction, so
a host can `PATCH status='published'` on their own listing directly via REST,
skipping the pending-review queue. **Proven on production**
(`audit-evidence/09-...`): a draft, and a `pending_review` listing, both went
straight to `published` (204). The `listings_published_are_complete` constraint
still requires a non-blank title and price > 0, but nothing else. So a free
account can put arbitrary (including fraudulent) listings live on the
marketplace with no human check — the downstream risk is a guest paying for a
scam listing. I did **not** fix it: it isn't in your four and doesn't *directly*
take money/PII/an account, so by your rules it waits for your decision. The fix
mirrors the ones I shipped: revoke UPDATE on `status` and move publish behind the
admin decide-route (which already exists and uses `getUser` + `is_admin`).

Good news on the neighbours: a provider **cannot** self-approve
(`status='approved'` → 403) or self-set their `commission_rate` (→ 403) — those
columns were already locked by `20260827185827_provider_status_grants`. Proven.

### E. `profiles.full_name` + `is_admin` readable by anyone — MEDIUM (PII)

The read-side audit found `profiles` has `SELECT USING (true)` for `public` and
anon is granted `full_name` and `is_admin`. So a stranger reads every real name
(confirmed: "Liam Worrall" came back to the anon key), **even for rows with
`show_full_name=false`** — the grant ignores the preference the app clearly
intends to honour — and can enumerate which accounts are admins by name. Contact
PII (email/phone/address/stripe) is correctly *not* here (it moved to the
`profile_private` view, which anon cannot touch — verified). I did **not** fix
this blind: names are already shown publicly on listings and reviews by design,
so the correct fix is a view/column that respects `show_full_name`, and getting
it wrong breaks every public byline. Your call on product intent. `is_admin`
could be revoked from anon cheaply as a standalone win.

### F. Storage: any free account can upload arbitrary unbounded files — MEDIUM (cost/abuse)

The public `listings` bucket's INSERT policy is `bucket_id='listings'` with **no
path/owner scoping, no size limit, no MIME allowlist**. Proven on production
(`audit-evidence/08-...`): an ordinary account uploaded an arbitrary file to the
public bucket (200), publicly readable with no auth. Mitigations that hold:
overwrite (PUT) and delete are **refused** (no UPDATE/DELETE policy) so a host's
images can't be tampered or removed; and content came back as `text/plain`, so
it won't render as a phishing page. Residual risk is storage-cost / hosting
arbitrary content on your infrastructure. The private `listings-removed` bucket
is correctly private. Not fixed (abuse/cost, not theft/PII). Fix: add
`file_size_limit`, an image MIME allowlist, and owner-scoped path prefixes.

### G. `ical-import`, `errors/report`, `services/wanted` — MEDIUM/LOW (spam/enumeration)

- `ical-import?listing=<id>` returns a listing's booked/blocked dates with **no
  token**, while its sibling `ical/[id]` correctly gates the same data behind a
  secret token. Anyone who has a listing id learns when a property is occupied.
- `errors/report` and `services/wanted` are intentionally public but unbounded
  and un-rate-limited: a stranger can flood `error_log` / `service_wanted` and
  trigger an admin email per call with attacker-controlled text. Cost/spam.

### H. What is CLEAN — verified, not assumed

- **The Stripe webhook.** Signature *is* verified: raw body read before parsing, HMAC-SHA256 over `timestamp.body`, `crypto.timingSafeEqual` compare, 300s replay window, both `STRIPE_WEBHOOK_SECRET(_2)` tried, empty secrets filtered. Any failure returns 400 and does **not** process the event — no fall-through. Duplicate events rejected on a `stripe_events` unique key. A forged `checkout.session.completed` cannot mark a booking paid.
- **Money is recomputed server-side everywhere.** Every charge/refund/payout/commission figure is derived from the listing/booking, never trusted from the browser. `checkout` recomputes via `quoteBooking`+`totalsMatch`; `balance-checkout` charges `booking.balance_amount` from the DB; refunds use `refundDue()` from DB values; `host-refund`'s body amount is hard-bounded to `amount_paid − amount_refunded`; the payout cron derives everything and keys idempotency on `payout-<bookingId>`. `admin/commission` is `getUser` + `is_admin` + bounds 0–100.
- **Connect/payout ownership** is correctly scoped to the caller's own account (the only caveat is that "the caller" comes from `getSession` — item A).
- **All cron routes** use the correct `CRON_SECRET` check, header-only, fail-closed on a missing secret, before any DB work. `errors/export` too.
- **auth/callback** guards against open redirect (`safeNext`), verifies the OTP/code properly, and fails closed.
- **Read side of every table** (the second agent swept all 35): besides item E, the sensitive tables are protected — `stripe_events.payload`, `payments`, `payouts`, `bookings`, `booking_guests` (email/token), `listing_ical_feeds.url`, `messages.body`, `notification_preferences.unsubscribe_token`, `error_log`, and all three views all refuse the anon key. One latent one: `service_providers` exposes `commission_rate`/`settlement`/`owner_id` to anon for `status='approved'` rows — **0 such rows today**, but worth narrowing before the services phase ships.

---

## What I changed on production tonight, precisely

**Applied to production (DB migrations — live now):**
- `20260829010000_profiles_are_not_self_administered.sql`
- `20260829011000_a_booking_cannot_arrive_paid.sql`
- `20260829012000_a_review_needs_a_stay.sql`

These are also applied to test. They close holes 1–4 and take effect
immediately — they are grants/policies, not code.

**Committed to the branch (code — NOT live until you deploy):**
- The account-page / signup upsert→update fix (closes the profile-save
  breakage, but the breakage stays live until deploy).
- `scripts/write-side-allowed.mjs`, the `data-privacy-rls.mjs` fix, and
  `audit-evidence/`.

**Not merged, not deployed.** Nothing touched master.

## What I did NOT fix, and why

Per your rules, these wait for your decision (all documented above with fixes):
the `getSession` → `getUser` migration (item A — you asked to trace, not fix; it
needs a deploy anyway); `services/apply` auth gate (B); the `import-listing`
SSRF (C); host self-publish (D); the `profiles` name/admin read leak (E);
storage limits (F); the spam/enumeration routes (G). None of these let a
stranger take money, take over an account, or read personal data *live tonight*
in a way I could both prove and close with a migration — the ones that come
closest (item A's money routes) are gated by code that only a deploy changes.

## Cleanup

Every canary row, user, listing, booking, review, provider and storage object I
created was removed. Final production check: **0 canary anything, admin count
back to 2.** Test project holds the three real migrations and nothing else.

Fastest way to re-see the state yourself in the morning:
```
node scripts/write-side-rls.mjs --target prod       # 24 refused, 0 WRITABLE
node scripts/write-side-allowed.mjs --target prod    # 11 still work, 0 broken
node scripts/data-privacy-rls.mjs --target prod      # 28 passed, 0 failed
```
