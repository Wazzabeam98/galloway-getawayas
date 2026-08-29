# What's left

29 August 2026, second pass. One list — everything still open from the
overnight security audit, everything flagged during the site audit, and
everything that surfaced while fixing the first six.

**Every entry was re-checked against master and against production today.** Not
copied forward: a stale list is worse than no list, which is why this one has
been rewritten rather than ticked.

Live on production: `34129ae`. Tests **891** pass.

---

## Closed since the first pass

Six, in the order they were done, each deployed and verified against production
rather than assumed from a green build.

| Fix | Live at |
|---|---|
| `services/apply` had no gate — a stranger could exhaust the site's email allowance | `efc713f` |
| `sendEmail` discarded 15 of 25 results, including every money email | `691e67a` |
| `ical-import` handed out occupancy for unpublished listings, and named the platform | `f1e2058` |
| `is_admin` readable by anyone with the site key | `4a82273` |
| `select('*')` on `reviews`, on the public listing page | `8604998` |
| Every page without a canonical claimed to be the home page | `34129ae` |

Two of those came out differently from how this list described them, and the
difference is the useful part:

- **`ical-import` did not get a token.** That route feeds the booking widget on
  every public listing page; a guest has to see the 12th is taken before they
  try to book it. A token would have stopped people booking, and the first
  symptom would have been a double booking. The dates were never the leak — the
  unpublished listings, the platform name and the feed id were.
- **`sendEmail` was fixed in one place, not fifteen.** No call site was touched.

---

# 1. New, found while doing those six

### A. Every table grants DELETE and TRUNCATE to `anon` and `authenticated` — MEDIUM

Found while revoking `is_admin`. It is not just `profiles`: **every table in
`public`**, including `payments`, `payouts`, `bookings`, `messages` and
`error_log`.

This is the Supabase default (`grant all on all tables … to anon, authenticated`),
so it is unsurprising — and it means the only thing standing between a stranger
and a delete is each table happening to have no DELETE policy.

**Not exploitable today, and I checked rather than assumed.** Every
DELETE-capable policy that exists requires `auth.uid()`, so `anon` matches zero
rows, and `authenticated` matches only its own. On the money tables —
`payments`, `payouts`, `bookings` — there is no DELETE policy at all, so a
delete matches nothing. PostgREST answers **204 No Content** and removes
nothing.

**That 204 is the problem.** The grant is already in place, so the day anybody
adds a permissive `FOR ALL` policy to one of those tables — the most natural
thing in the world to write — the delete starts working, silently, with no
error to notice.

The fix is a grant sweep, not a policy change:

- revoke DELETE and TRUNCATE from **`anon`** on every table. Every delete policy
  already requires `auth.uid()`, so anon can never legitimately delete anything.
- revoke TRUNCATE from **`authenticated`** on every table. Nothing should ever
  truncate from a browser, and TRUNCATE is not subject to row-level security at
  all.
- leave `authenticated` DELETE where a deliberate policy exists — `quick_replies`,
  `conversation_prefs`, `reviews`, `message_templates`, `listing_access`,
  `listing_ical_feeds`, `calendar_overrides` and the `service_*` tables.

`profiles` is already done. Half a day, one migration, applied test-then-prod.

### B. `services/apply` still lets a stranger squat somebody's email — MEDIUM

The rate limit closed the outage risk, which was the urgent half: nobody can
empty the mail allowance now. It did **not** close the other half. Inside the
limit — twenty an hour across the site — a stranger can still create a real
Supabase auth user on an address that is not theirs, so the real owner cannot
sign up later, and gets a "confirm your signup" email they did not ask for.

Properly fixing it means not creating the account until the address is proved,
which is a change to the join flow rather than a guard in front of it. Worth
doing before the services phase launches; not urgent while it has not.

### C. `rate_limit_hits` grows for ever — LOW

I added the table and no way to empty it. One row per limit per application, so
at this scale it is a handful a week — but there is no retention and nothing
prunes it. A `delete from rate_limit_hits where created_at < now() - interval
'7 days'` on one of the existing crons is the whole job.

### D. Any `.select()` on a profile update returns 403 — LOW, but it bites

Found while proving the `is_admin` revoke had not broken anything. A plain
`update()` on `profiles` works. Add `.select()` — or `Prefer:
return=representation` — and PostgREST does a `SELECT *`, which needs every
column, and `authenticated` has grants on twelve of about twenty-two. Result:
**403, 42501**.

This is the same root cause as the account-page upsert breakage from the
overnight audit, and it is still armed. The next person who writes
`.update({...}).select().single()` on `profiles` — a completely ordinary thing
to write — gets a 403 they will not understand. Nothing does it today. Worth a
comment on the table's migration at minimum.

### E. `migrate.mjs` was letting a truncate through — **CLOSED**, recorded because of how

Its data-loss guard stripped `$$…$$` bodies along with comments and string
literals, so `do $$ begin truncate … end $$;` was invisible to it. Found by
running one, which the guard waved past and which truncated `rate_limit_hits`
on the test project. It also refused `revoke truncate` as data loss, which is
how a guard teaches people to type `--destructive` by reflex.

Both fixed in `4a82273`, and the classifier moved to `scripts/sqlRisk.cjs` so
it can be tested without credentials — the first version of those tests passed
here and failed in CI, which is no test at all for the rule that decides
whether a migration may drop a table.

---

# 2. Still open from the overnight security audit

Lettered as in `SECURITY-AUDIT-2026-08-29.md`.

### E. Every real name is readable by a stranger — MEDIUM, needs your decision

The cheap half is done: `is_admin` is revoked. The remaining half is that
`full_name` is readable **even for rows with `show_full_name = false`**, so the
grant ignores the preference the app means to honour.

Still needs you, not me: names appear on listings and reviews by design, so the
fix is a view that respects `show_full_name`, and getting it wrong breaks every
public byline.

### F. Any free account can upload unbounded files to public storage — MEDIUM

Unchanged. The `listings` bucket's INSERT policy is `bucket_id='listings'` — no
path scoping, no size limit, no MIME allowlist. Overwrite and delete are
refused, and content comes back as `text/plain` so it will not render as a
phishing page. The residual risk is your storage bill.

Fix: `file_size_limit`, an image MIME allowlist, owner-scoped path prefixes.

### G. Two unbounded public routes — LOW

`ical-import` is done. The other two are unchanged:

- **`errors/report`** — a stranger can flood the error log, which is the page
  you rely on to notice everything else here. `lib/rateLimit.ts` now exists;
  this is three lines with it.
- **`services/wanted`** — floods a table and fires an admin email per call with
  attacker-controlled text. Same three lines.

### Two smaller ones the audit recorded

- **`service_providers` exposes `commission_rate`, `settlement` and `owner_id`
  to anon** for `status='approved'` rows. Zero such rows today. Narrow before
  the services phase ships.
- **`payout_balance_owed`** can no longer be self-set, but nobody traced whether
  the payout run reads it as an instruction or recomputes it. Worth an hour
  before the next payout run.

### And one the write-side audit could not finish

The two database constraints were never dropped and re-added on test, so we
know the detector works but not that the constraint is what refuses. The pair
to run is in `SECURITY-WRITE-AUDIT.md`.

---

# 3. Failures that stay quiet

### `sendEmail` — **CLOSED**

Fixed in `691e67a`, inside `sendEmail` itself. Fifteen call sites still discard
the boolean and that no longer matters: the failure is reported from one place,
by subject and recipient, with the body deliberately excluded.

### 32 of 59 API routes never reach `/admin/errors`

Unchanged — re-counted today. Worst: `notify` (every notification funnels
through it, and its catch returns `{ok:false}` with **status 200**, so the
caller cannot tell either), `listings/save`, `stripe/balance-checkout`,
`stripe/connect`, `listing-access/*`.

`lib/adminAudit.ts` still swallows a failed audit write to `console.error`. For
actions that move money, an audit record that silently does not exist is worse
than one that loudly fails.

### The admin check is copied nine times

Re-verified: nine `/admin` pages each re-implement it inline, and there is still
no `requireAdmin` in `lib/`. Every copy is correct today; nothing makes the
tenth correct. Put it in `lib/access.ts` and add a test that every
`app/admin/**/page.tsx` calls it — the pattern is now well established, and
`tests/routes-verify-identity.test.ts` is the model.

---

# 4. SEO and performance

The canonical is done. The rest is unchanged.

| Item | Why it matters | Effort |
|---|---|---|
| **The home page has ~20 words of body text** | It cannot rank for its own title. Nothing else here comes close. Brief in `AREA-BRIEF.md`. | you |
| **Home page `h1` is "Galloway Getaways"** | The most valuable heading on the site, spent on a brand nobody searches. The title tag and the h1 disagree about what the page is. | 10 min + your say-so |
| **No `updated_at` on `listings`** | Re-verified absent. The sitemap's `lastmod` uses `approved_at`, so an edited listing tells Google it has not changed since approval. | 1 hr |
| **Three different review counts** | `rating_avg` (trigger, all reviews), `rating_count`, and `reviews.length` (published only). The listing page's JSON-LD mixes two. | 1 hr |
| **Hero image is 544KB on a retina desktop** | It is the LCP element. Capping `deviceSizes` at 2048 takes it to 325KB, invisibly. | 15 min |
| **`react-date-range` ships to every visitor** | ~25–30KB gzipped for a picker most never open. | 1 hr |
| **Listing page: 5 sequential queries + a live OpenStreetMap call** | 225ms TTFB before a byte moves, and a cache miss makes a guest wait on a third party. | 2 hrs |
| **Nothing is cacheable** | Not `force-dynamic` — `Navbar` calls `cookies()` in the root layout, which is what actually forces it. Proved by stubbing it: five pages went static. Path in `SITE-AUDIT.md`. | half a day for step 1 |
| **Four pages have no `h1`** | `/services/join`, `/services/join/apply`, `/auth/reset`, `/unsubscribe`. All noindexed, so accessibility rather than SEO. | 30 min |
| **The four hero photos have `alt=""`** | Google Images is a real channel for "Kirkcudbright harbour". I will not invent what the photos show — tell me and it is five minutes. | you + 5 min |

---

# 5. Blocked on you — content

- **Area page copy.** Nine pages built and gated; none reaches Google until
  `intro` is written. `AREA-BRIEF.md` has the brief. You said after the about
  page.
- **A real "list your property" landing page.** `/addhome` is a wizard and is
  noindexed, so your actual pitch appears on no indexable page. Less
  competition than the guest terms.
- **Want-based pages** (dog-friendly, hot tub, near the Dark Sky Park). Same
  machinery pointed at an amenity filter. After the towns.
- **Google Search Console.** Until it runs, every search term in `AREA-BRIEF.md`
  — mine and yours — is a guess.

---

# 6. Housekeeping

### Delete the two superseded count endpoints — **now due**

`app/api/messages/unread-count/route.ts` and
`app/api/bookings/pending-count/route.ts` are thin wrappers over
`lib/badgeCounts`; nothing in the repo calls them. They exist so a browser
holding the pre-`2fec366` bundle kept its badge working.

**Trigger: 30 August 2026** — one full day after that deploy. Delete the test
that pins them alive (`tests/badge-counts.test.ts`, "the superseded routes still
answer, for one deploy") in the same commit, deliberately, rather than letting
it fail and get patched.

### The stale audit branch

`audit/write-side-grants`, checked out in the other worktree, shows commits "not
on master". They are not missing — the same content arrived via PRs #12, #13 and
#15 as differently-authored commits. **Do not re-merge it.** PR #16 took its
branch-only parts. Deletable once that session is finished.

### Small stuff

- `config/countries.ts` refers to a global `CountriesType` from the root
  `types.ts`. Harmless to the Next build; it breaks the *test* build if anyone
  adds `config/**` to `tsconfig.test.json`.
- Demonstration runs left `stripe/webhook` and `import-listing` rows in the
  **test** project's `error_log`. Deliberate — they are the evidence in
  `WEBHOOK-FAILURE.md`. Clear them whenever.
- `.claude/launch.json` has two extra local server configs I added. Delete if
  unwanted.
- The 404 emits two robots tags. They now **agree** (`noindex` and `noindex,
  nofollow`) rather than contradicting, so this is tidiness, not a defect.

---

# What I would do next, in order

1. **The grant sweep (1A).** One migration, closes a landmine on `payments`,
   `payouts` and `bookings`, and it is the same shape as work already done.
2. **`errors/report` and `services/wanted` rate limits (2G).** `lib/rateLimit.ts`
   exists now; this is three lines each.
3. **`requireAdmin` in `lib/access.ts`**, with the test. The ninth copy is
   correct; the tenth is a coin flip.
4. **`adminAudit` reporting**, and the worst of the 32 silent routes —
   `notify` first, since everything funnels through it.
5. **`rate_limit_hits` retention (1C)**, on an existing cron.

Then the SEO list, which is mostly an afternoon each and none of it urgent, and
the content, which is yours.
