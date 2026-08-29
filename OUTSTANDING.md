# What's left

29 August 2026, third pass. One list — everything still open from the
overnight security audit, everything flagged during the site audit, and
everything that surfaced while fixing the first six.

**Every entry was re-checked against master and against production today.** Not
copied forward: a stale list is worse than no list, which is why this one has
been rewritten rather than ticked.

Live on production: `8a3815a`. Tests **894** pass.

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
| DELETE and TRUNCATE granted to both browser roles on every table, and on three auto-updatable views | `03d1c4f` |
| `rate_limit_hits` grew for ever; a bare `.select()` on a profiles write returned 403 | `7bbbcb9` |
| The two superseded count endpoints, deleted with the test that held them | `8a3815a` |

Two of those came out differently from how this list described them, and the
difference is the useful part:

- **`ical-import` did not get a token.** That route feeds the booking widget on
  every public listing page; a guest has to see the 12th is taken before they
  try to book it. A token would have stopped people booking, and the first
  symptom would have been a double booking. The dates were never the leak — the
  unpublished listings, the platform name and the feed id were.
- **`sendEmail` was fixed in one place, not fifteen.** No call site was touched.

---

# 1. Needs a decision from you

### "Delete my home" has never worked, and cannot simply be made to

`components/DeleteHomebtn.tsx` deletes from `listings` as the browser user,
discards the result, and calls `router.refresh()`. `listings` has no DELETE
policy, so RLS matches nothing: PostgREST answers **204**, the row stays, and
the dialog closes as though it worked.

The dialog says:

> This action cannot be undone. This will permanently delete your added home
> and remove your data from our servers.

None of that happens. Proven on the test project — created a listing, deleted
it as its owner, got 204, listing still there.

**Why it cannot just be granted.** `bookings.listing_id` is `ON DELETE
CASCADE`, and from `bookings` the chain runs:

| | |
|---|---|
| `messages`, `reviews`, `booking_guests`, `conversation_prefs` | **CASCADE** — the whole conversation and every review, gone |
| `payments`, `payouts` | **SET NULL** — the rows survive as orphans: money in the ledger that can no longer be tied to a stay |
| `disputes` | **NO ACTION** — a single chargeback anywhere on the listing blocks the delete entirely, with a foreign-key error the button would swallow |

On production today: **5 listings, 3 of them have bookings**, 15 payments, 1
payout. So for three of five, a working delete destroys booking history and
orphans money rows.

And it would breach your own privacy policy, which says: *"Booking and payment
records are kept for six years, as UK tax law requires."*

### The four options, and what each costs

**1. Remove the button.** `HideListingBtn` already sits next to it on the same
dashboard row and does the useful thing — off the home page, out of the
sitemap, noindexed, still opens for a guest holding a booking.
*Costs:* a host who makes a genuine mistake — a duplicate draft, the wrong
address — has no way to clear it themselves and has to ask you. At ten
properties that is an email. *Effort:* ten minutes. Nothing is lost, because
nothing currently works.

**2. Delete only when nothing is attached.** Allow it when the listing has no
bookings — which means no payments, messages or reviews either — and refuse
otherwise with "this has bookings against it; hide it instead". This covers the
case the button is almost certainly for: drafts and mistakes.
*Costs:* a server route, because the browser cannot be trusted to check and
`listings` should not get a DELETE policy. Half a day. The honest failure
message is most of the work.

**3. A `deleted` status.** Widen the check constraint, hide it from the host
too. *Costs:* a new status value, and the house rule is that every place
listing statuses has to learn it first — the publish gate, the sitemap, the
listing page's `PUBLICLY_VISIBLE`, the admin queue. A day, and it is `hidden`
with a different label and one more state for everything to get wrong.

**4. Hard delete with cascade.** *Costs:* booking history, conversations and
reviews destroyed; payments and payouts orphaned; blocked at random by
disputes; and in breach of both your privacy policy and UK tax record-keeping.
**Listed only so it is on the record as considered and refused.**

**What I would do:** option 1 today, because it takes ten minutes and stops the
site promising something it does not do; then option 2 when the mistake
actually happens to somebody. Option 2 alone is also fine if you would rather
do it once. But the dialog should stop lying either way, and that part is not a
decision.

---

# 1b. New, still open

Everything else that surfaced during the fixes was closed in the same pass —
the grant sweep, the view bypass, the `rate_limit_hits` retention, the
`.select()` 403 and the two `migrate.mjs` guard holes are all in the closed
table above. One thing was found and deliberately not fixed:

### `services/apply` still lets a stranger squat somebody's email — MEDIUM

The rate limit closed the outage risk, which was the urgent half: nobody can
empty the mail allowance now. Inside the limit — twenty an hour across the site
— a stranger can still create a real Supabase auth user on an address that is
not theirs, so the real owner cannot sign up later and gets a "confirm your
signup" email they did not ask for.

Fixing it properly means not creating the account until the address is proved,
which is a change to the join flow rather than a guard in front of it. **You
asked to decide that yourself rather than have it decided by a security fix**,
which is why it is here and not done. Worth settling before the services phase
launches; harmless while it has not.

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

### `sendEmail` — **done**

Fixed in `691e67a`, inside `sendEmail` itself. Fifteen call sites still discard
the boolean and that no longer matters — the failure is reported from one
place, by subject and recipient, with the body deliberately excluded. The
earlier "15 of 20" in this file was wrong on the denominator; it is 25 call
sites, and the count stopped being the thing that mattered once the reporting
moved inside.

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

### The count endpoints — **done**

Deleted in `8a3815a`, with the test that pinned them alive removed in the same
commit rather than left to fail later and be patched by somebody who did not
know why it was there.

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

1. **Decide about "Delete my home"** (section 1). Ten minutes for option 1, and
   until then the dialog promises something that does not happen.
2. **`errors/report` and `services/wanted` rate limits** (2G). `lib/rateLimit.ts`
   exists now; this is three lines each, and `errors/report` guards the page you
   rely on to notice everything else here.
3. **`requireAdmin` in `lib/access.ts`**, with the test. The ninth copy is
   correct; the tenth is a coin flip.
4. **`adminAudit` reporting**, then the worst of the 32 silent routes — `notify`
   first, since every notification funnels through it and its catch returns
   `{ok:false}` with status 200.
5. **Storage limits** (2F) before anyone else can upload to the public bucket.

Then the SEO list, which is mostly an afternoon each and none of it urgent, and
the content, which is yours.
