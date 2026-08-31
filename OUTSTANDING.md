# What's left

31 August 2026, fourth pass. One list — everything still open from the
overnight security audit, everything flagged during the site audit, and
everything that has surfaced since.

**Every entry was re-checked against master and against production today.** Not
copied forward and not ticked off: a stale list is worse than no list. Where
the check changed my mind, the entry says so.

Live on production: `43c5158`. Tests **933** pass.

Two things moved while this pass was being written, both from the other
session: the home page copy, and area-page copy for ten towns. Both close
entries that had been sitting in "blocked on you" — see below.

---

## Closed since the third pass

Nine, each verified where it actually runs rather than assumed from a green
build. The database ones were read back off production today; the code ones
were read on master at `43c5158`.

| Fix | Live at | How it was checked |
|---|---|---|
| "Delete my home" removed — the button, the dialog and the dead call | `a7e0553` | file gone, no references left; production still has no DELETE policy on `listings`, so nothing was quietly granted to make it work |
| `errors/report` and `services/wanted` rate-limited | `c8a4a09` | both import `withinLimits` from `lib/rateLimit` |
| The admin check, nine copies down to one | `faf4ac6` | `requireAdmin` at `lib/access.ts:197`; all **9** admin pages call it; `tests/admin-pages-guarded.test.ts` holds it there |
| `adminAudit` no longer swallows a failed audit write | `0d0780b` | reports through `logError` |
| `notify` reports its failures | `0d0780b` | reports through `logError` |
| Storage size limit and MIME allowlist on the public bucket | `7a22fa8` | **production**: `listings` bucket is capped at 10MB and accepts six image types only |
| The home page has real body text and an `h1` that describes the product | `92e041f`, `26b1ada` | **live page**: 680 words; `h1` is now "Self-catering cottages across Dumfries & Galloway", and the title and meta description agree with it |
| Area-page copy written for ten towns, held | `1de9819`, `ab66c59` | all ten carry `hold: true`, are `noindex, nofollow`, and appear **0** times in the live sitemap |
| The earnings chart fits on a phone, with the numbers reachable | `4197a93` | measured at 375px and 1280px: twelve months, nothing hidden |

### Three where the check changed the answer

- **The storage fix is two-thirds done, not done.** The size limit and the MIME
  allowlist are live. The third part — owner-scoped path prefixes — is not: the
  bucket's INSERT policy on production is still bare `bucket_id = 'listings'`.
  What that leaves is smaller than it was, and it is written up under 2F rather
  than left inside a closed row.

- **I nearly reported eleven security holes that are not there.** Checking the
  grant sweep, production shows DELETE still granted to `authenticated` on
  eleven tables with — by my query — no DELETE policy. The query was wrong.
  Those tables are governed by `FOR ALL` policies, which cover DELETE and do
  not appear when you filter `pg_policies` on `cmd = 'DELETE'`. All eleven are
  owner-scoped and RLS is on for every one of them. **Anything checking this
  in future has to match `cmd IN ('DELETE','ALL')`**, or it invents holes.

- **The `rate_limit_hits` pruning is real, and not where I looked for it.** It
  is not a `pg_cron` job — it runs inside the daily `error-digest` Vercel cron,
  seven days' retention against a longest window of 24 hours. Production has
  0 rows. Looking only in `cron.job` says it was never done.

---

# 1. Needs a decision from you

Two, and you asked to take them together.

### `full_name` is readable even when the owner asked for it not to be

**Unchanged, and re-checked on production today.** `anon` has SELECT on
`profiles.full_name`, and `show_full_name` is not part of the grant — so the
column is readable for rows that set it to false. One person on production has
set it to false today, which is one person the site is not honouring.

Why it is still yours and not mine: names appear on listings and reviews by
design, so the fix is a view that respects the preference and a sweep of every
public byline through it. Get it wrong and every host name on the site
disappears at once.

### `services/apply` still lets a stranger squat somebody's email

**Unchanged.** The rate limit closed the outage risk — nobody can empty the
mail allowance now. Inside the limit, a stranger can still create a real
Supabase auth user on an address that is not theirs, so the real owner cannot
sign up later and gets a "confirm your signup" email they never asked for.

Fixing it properly means not creating the account until the address is proved,
which changes the join flow rather than putting a guard in front of it. You
said you would rather decide that than have a security fix decide it for you.

**This got more urgent this week, and not because of anything in it.** The
guest-experiences work shipped behind `GUEST_EXPERIENCES_OPEN` (#38) and eight
new `services/*` routes came with it. The join flow this touches is the one
that phase opens with.

---

# 2. Still open from the overnight security audit

Lettered as in `SECURITY-AUDIT-2026-08-29.md`.

### F. Uploads are capped and image-only, but not scoped to their owner — LOW

Down from MEDIUM. The bill risk is now bounded: 10MB a file, images only, no
overwrite and no delete. What remains is that any signed-in account can write
to **any path** in the `listings` bucket, because the INSERT policy never looks
at who is uploading. Nobody can replace another host's photo — only add
alongside it.

Fix: an owner-scoped path prefix in the INSERT policy. Half a day, because the
upload paths in the app have to move with it.

### `service_providers` exposes `commission_rate`, `settlement` and `owner_id`

**Zero approved rows on production today, so nothing is leaking yet.** The
reason it moves up this list rather than down: the experiences phase is now
built and sitting behind a flag. The first approved provider is what arms this,
and that is a business decision away rather than a development one.

### `payout_balance_owed` — nobody has traced how the payout run reads it

Unchanged. It can no longer be self-set. Whether the payout run treats it as an
instruction or recomputes it is still untraced, and the payout engine is the
largest untested thing in the project. Worth an hour **before** the first live
payout, not after.

### The write-side audit's unfinished pair

Unchanged. The two database constraints were never dropped and re-added on
test, so we know the detector works but not that the constraint is what
refuses. The pair to run is in `SECURITY-WRITE-AUDIT.md`.

---

# 3. Failures that stay quiet

### 24 of 63 API routes never reach `/admin/errors`

Down from 34. The ten money- and access-path routes named in the last pass now
report, and a test holds them there —
`tests/money-routes-report-failures.test.ts`, which fails if any of them goes
back to a catch that only writes to the console.

Proved end to end rather than by reading the code: a host's Stripe account id
was pointed at an account that does not exist, `/api/stripe/connect` was called
with a real session, and the failure arrived in `error_log` with its path,
message and the host's id. Before the change the same call returned the same
500 and recorded nothing.

Two of the ten were worse than "no reporting":

- **`listings/save`** had an inner catch for a photo it could not move out of
  the public bucket, with a comment saying it was *"the one thing the owner
  most needs to know about"* — going to `console.error` only.
- **`my-listings`** had no `try`/`catch` at all. Both of its callers treat a
  failed response as "no properties", so a co-host whose access lookup broke
  saw an empty calendar that looked exactly like having none. The status is
  still 500; what changed is that somebody is told.

What is left is the 24 that are not on the money or access path — admin
reads, cron endpoints, and lookups whose failure a person sees immediately.
Worth doing, not urgent.

---

# 4. SEO and performance

The home page came off this list this week — it had ~20 words of body text and
an `h1` spent on the brand; it now has 680 words and an `h1` that says what the
site is. That was the biggest single item here.

| Item | Why it matters | Effort |
|---|---|---|
| **No `updated_at` on `listings`** | Re-checked on production: still absent. The sitemap's `lastmod` uses `approved_at`, so an edited listing tells Google nothing changed since approval. | 1 hr |
| **Three different review counts** | `rating_avg` (trigger, all reviews), `rating_count`, and `reviews.length` (published only). The listing page's JSON-LD mixes two. | 1 hr |
| **Hero image is 544KB on a retina desktop** | It is the LCP element. Capping `deviceSizes` at 2048 takes it to 325KB, invisibly. | 15 min |
| **`react-date-range` ships to every visitor** | Still in `package.json`. ~25–30KB gzipped for a picker most never open. | 1 hr |
| **Listing page: 5 sequential queries + a live OpenStreetMap call** | 225ms TTFB before a byte moves, and a cache miss makes a guest wait on a third party. | 2 hrs |
| **Nothing is cacheable** | Not `force-dynamic` — `Navbar` calls `cookies()` in the root layout, which is what actually forces it. Proved by stubbing it: five pages went static. Path in `SITE-AUDIT.md`. | half a day for step 1 |
| **Two pages still have no `h1`** | `/services/join` and `/services/join/apply`. `/auth/reset` and `/unsubscribe` have picked one up since the last pass. All noindexed, so accessibility rather than SEO. | 15 min |
| **The hero photo has `alt=""`** | One place now, `components/base/Hero.tsx:551`. Google Images is a real channel for "Kirkcudbright harbour". I will not invent what the photo shows — tell me and it is five minutes. | you + 5 min |

---

# 5. Blocked on you — content

**The first entry has changed shape.** It was "nine pages built and gated, none
reaches Google until you write the copy". The copy is now written for ten
towns, by the other session, and every one is deliberately held.

- **Release the area pages.** Ten towns, copy written, all `hold: true` and
  `noindex, nofollow`, none in the sitemap. They need you to read them and drop
  the hold — that is a review, not a writing job. They also need a published
  listing in the town before they publish themselves, which is the second
  condition in `isPublishable`.
- **A note on the towns carousel.** The home page now links to all ten. Guests
  can reach them and they read fine; Google is told not to index them. Nothing
  to fix — worth knowing the links are live before you decide the hold.
- **A real "list your property" landing page.** `/addhome` is a wizard and is
  noindexed, so your actual pitch appears on no indexable page. Less
  competition than the guest terms.
- **Want-based pages** (dog-friendly, hot tub, near the Dark Sky Park). Same
  machinery pointed at an amenity filter. After the towns.
- **Google Search Console.** Until it runs, every search term in `AREA-BRIEF.md`
  — mine and yours — is a guess.

---

# 6. Housekeeping

- `config/countries.ts` refers to a global `CountriesType` from the root
  `types.ts`. Harmless to the Next build; it breaks the *test* build if anyone
  adds `config/**` to `tsconfig.test.json`.
- The **test** project's `error_log` holds 55 demonstration rows — 19 from
  `stripe/webhook`, 12 from `lib/clawback`, 21 with no path. Deliberate: they
  are the evidence in `WEBHOOK-FAILURE.md`. Clear them whenever.
- `.claude/launch.json` has three local server configs; two are mine
  (`galloway-audit`, `galloway-prod`). Delete if unwanted.
- `origin/audit/write-side-grants-onto-master` is still on the remote. Its
  content arrived via PRs #12, #13 and #15 as differently-authored commits.
  **Do not re-merge it.** Deletable.
- The 404 emits two robots tags. They **agree** (`noindex` and `noindex,
  nofollow`), so this is tidiness, not a defect.

---

# Two traps worth knowing, both of which cost time this week

Neither is a defect. Both made working things look broken.

- **`cmd = 'DELETE'` is not how you find a missing delete policy.** A `FOR ALL`
  policy covers DELETE and does not match that filter. It produced eleven
  imaginary holes on production this morning.
- **A stale `.next` makes hydrated code look dead.** Rebuilding underneath a
  running dev server left the earnings chart un-hydrated, so no click handler
  existed and a working component tested as broken. Clear `.next`, restart,
  re-test before believing a UI bug. This is the sibling of the RSC-payload
  trap now written up in `MAINTENANCE.md`.

---

# What I would do next, in order

1. **Read the ten area pages and drop the hold** (section 5). The work is done
   and earning nothing while it sits.
2. **Take the two decisions together** (section 1) — `full_name` and
   `services/apply`. The second one gates the phase that is now built.
3. **Trace `payout_balance_owed`** (section 2). One hour, before the first live
   payout rather than after it.
4. **The remaining 24 silent routes** (section 3) — none on the money or
   access path now, so this is tidying rather than risk.
5. **Owner-scoped upload paths** (2F), whenever the upload paths are being
   touched anyway.

Then the SEO list, which is an afternoon each and none of it urgent, and the
content, which is yours.
