# Looking after Galloway Getaways

What has actually bitten, and the decisions worth not re-arguing. Read
`CLAUDE.md` first for the house rules and how to run it.

**This file was 1,326 lines on 1 September 2026 and is now about a third of
that.** It had grown into a record of everything anyone had ever noticed, which
meant nobody read it before doing the thing it warned about — and it had begun
contradicting itself: one section said the migration runner could not reach
production, another three hundred lines away corrected exactly that. What was
cut was migration bookkeeping now answered by tooling, archaeology of changes
since undone, and lists that rot. What was kept is traps that cost real time and
decisions somebody would otherwise re-litigate.

Every section carries the date its claims were last checked.
`tests/doc-claims.test.ts` fails on a missing date and warns on a stale one.

---

## A guard that throws is worse than no guard

checked: 2026-09-01

A guard is the one kind of code whose success path proves nothing. It looks
identical whether it is working or absent, right up to the moment it matters,
and then it fails in the direction of the thing it was there to prevent.

This shape has appeared five times:

- `assertTestEnvironment` threw `ReferenceError` instead of guarding — the
  seeders stopped, which was safe by luck rather than design.
- `migrate.mjs` refuses production — it had not since 27 August 2026, and this
  file still said it did.
- `VERCEL_TOKEN` is read-only — it never was; the restraint is in
  `check-deploy.mjs`.
- Scenario 29 checked that a second payout run does not pay twice, by running
  it twice. That passes because `paid_out_at` is set and the booking is not
  selected — the guard's happy path. The state that actually pays a host twice
  was outside the test until 1 September.
- The email suppression for reserved TLDs was at 5 of the 22 files that send
  mail, and the tests for it all used `.test` addresses, so they passed for the
  wrong reason the moment it was centralised.

**When you touch anything that exists to say no, run the thing it guards and
watch it say no.** `scripts/enquiry-rls.mjs` is written that way on purpose:
every check asserts a refusal, and it was run against the unfixed database first
to watch it fail.

## The migration goes to production BEFORE the code that needs it

checked: 2026-09-01

**A migration reaches production before the code that depends on it merges.
Never after.** No exceptions, including "it is only a widened constraint" and
"nothing writes it yet".

A schema ahead of its code costs nothing: an unused column, a widened check
nothing writes. A schema behind its code fails at the database, which on this
project has never been loud — the insert is refused, the browser reports
success, and the row simply is not there. Adding `hidden` to listings and
`pending_payment` to bookings both hit exactly that.

Two sessions work on this repo at once, and each can merge a branch the other
has not read.

**In practice:**

```
node scripts/new-migration.mjs "what it does"
node scripts/migrate.mjs --target prod supabase/migrations/<file>        # dry run
node scripts/migrate.mjs --target prod supabase/migrations/<file> --apply
node scripts/migrate.mjs --target test supabase/migrations/<file> --apply
node scripts/migrate.mjs --target prod --status
```

Production first, then test, then merge. If a migration is destructive its
pre-flight decides whether it runs at all — read the count before. A branch
carrying a migration should say so in its description.

**`--status` is how you check what is outstanding.**
`public.schema_migrations` records what has been applied to each database, and
the runner writes the row in the same transaction as the DDL. It also stores a
checksum of the file as it ran, which catches the thing no amount of reading
finds: a migration edited after it was applied.

Rows from before the ledger existed are marked `backfilled` and printed as
*assumed, not observed*. Nobody watched those run. The assumption rests on
production and test having been compared in full on 1 September 2026 and found
identical — `node scripts/schema-diff.mjs` is that comparison, kept.

## Name a migration with the actual clock

checked: 2026-09-01

`YYYYMMDDHHMMSS`, real clock, to the second. **Not a round hour.** There are 24
round hours in a day and 86,400 seconds; on 1 September two sessions collided on
the same round hour twice, hours apart, because both reached for the next tidy
number. `scripts/new-migration.mjs` does it for you and
`tests/migration-files.test.ts` refuses a round hour on anything dated from
2 September 2026.

## Which database am I on?

checked: 2026-09-01

| | project name | ref |
|---|---|---|
| Production | `supabase-pink-elephant` | `hviwjxigqivjfhmhpjiy` |
| Test | `galloway-getaways-test` | `yefoqcabuijcowoqewtc` |

- **Vercel Preview reads test; production reads production.** Every
  environment-sensitive variable is split per environment — the three Supabase
  ones, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`,
  `RESEND_API_KEY`. A preview cannot reach production data or live money.
- **`galloway-getawayas-git-master-….vercel.app` is production, not a preview.**
  master is the production branch, so that hostname is an alias on the live
  deployment.
- **The tell is what renders**: `SEED —` listings mean test.
- **The Supabase CLI in this checkout is linked to production** while
  `.env.local` points the app at test. `supabase db push` or `db reset` from
  here hits live data. Check `supabase/.temp/project-ref` before any CLI command
  that writes.

## How to work on this

checked: 2026-09-01

- **Run the build. A green test suite is not the same check.** `tsconfig.test.json`
  sets `"strict": false`, so it compiles code `next build` refuses. On
  28 August an interface gained four fields in one place and not the other; 546
  tests passed and `next build` failed naming the exact argument.

  It is narrower than it looks: `tsconfig.test.json` has a hand-written
  `include` list, so a route nobody added is invisible to `tsc` **and** to the
  tests. A test against an unlisted route fails with `MODULE_NOT_FOUND` rather
  than an assertion.
- **Read the surrounding code before changing it.** Naming collides — the
  Stripe webhook has a local variable called `logError`, unrelated to
  `lib/logError.ts`.
- **Say when you are unsure.** A flagged uncertainty is far cheaper than a
  confident wrong fix to a payment route.
- **Do not enter credentials into forms or CLI fields.** That is the owner's
  step, even when he has supplied the value.

---

## Things that bite

checked: 2026-09-01

### Looking at a page

- **Do not decide what a page rendered by grepping its HTML for text you expect
  to be absent.** Next ships the error and not-found boundary components inside
  the RSC flight payload, in `<script>` tags, on every page under that segment.
  `app/not-found.tsx`'s wording is present in the HTML of pages that rendered
  perfectly. A check of nine `/admin` pages once reported all nine as 404s; they
  were fine. Cost most of an afternoon.
- **A signed-in page check needs a session the SERVER accepts.** Most of the
  site behind the login is client-rendered, so `curl` sees a spinner —
  a crawl of `/dashboard` with no browser is measuring the loading state.
  `sessionCookieViaApp()` in `scripts/seed-lib.mjs` mints a real one. For what
  the page finally shows, drive a browser.
- **A stale `.next` makes hydrated code look dead.** Rebuilding underneath a
  running dev server leaves components un-hydrated, so no click handler exists
  and a working component tests as broken. Clear `.next` and restart before
  believing a UI bug.

### Building

- **This targets es5.** Some modern syntax fails the build — spreading a `Set`,
  iterating a `Map` directly.
- **Insert an import before the first one, not after the last.** Several files
  use multi-line `import { … }` blocks, and an import dropped into the middle of
  one is a syntax error. Happened three times.
- **A Tailwind class with an off-scale number generates nothing, fails silently,
  and looks plausible.** The single most expensive recurring bug here — three
  instances, each found by measuring rather than reading. Tailwind emits no rule
  and no warning, so the markup is the place that lies to you.

  Worst case seen: `from-stone-950/45` on the hero vignette. A gradient needs
  all its stops, so with `--tw-gradient-from` unset the whole `linear-gradient()`
  was invalid and the overlay **had never rendered on any screen since it was
  written** — while `via-*` and `to-*` beside it compiled fine, which is what
  makes the class list look healthy.

  **The check, always: read the computed value, not the class list.**
  `getComputedStyle(el).backgroundColor` returning `rgba(0, 0, 0, 0)` where you
  expected something is the tell. Prefer an arbitrary value — `bg-white/[0.85]`
  — whenever the number is not obviously on a scale.

  Related, different mechanism: `theme.container.screens` also decides which
  breakpoints `theme.container.padding` may use, so a `md` padding generates
  nothing. Per-breakpoint container padding lives in `app/globals.css` as a
  plain media query instead.

### The database

- **Check column and table names against the repo before writing a query.**
  Invented names have got as far as being sent more than once.
- **New status values need the check constraint widened first.** Adding
  `hidden` to listings and `pending_payment` to bookings both failed silently
  at the database until the constraint allowed them.
- **Some Supabase functions throw rather than returning an error.**
  `exchangeCodeForSession` and `signUp` both do for non-auth failures. A
  `{ error }` destructure alone leaves a 500, or a button stuck on
  "Processing…" with nothing shown. Wrap them.
- **A co-host is not the `host_id` on a booking.** Any query on their behalf
  needs the service key, or row-level security silently returns nothing.
- **Money columns are revoked from `authenticated`** — `commission_rate`,
  `payout_balance_owed` and the rest. Keep it that way.
- **A door code is never a column on `listings`.** Five places read that table
  with `select('*')`, the public listing page among them. Revoking does not help
  either: Postgres refuses `select *` outright when a column is revoked, which
  breaks five screens at once. Codes live in `listing_access_codes`, RLS on, no
  grants for `anon` or `authenticated`, reachable only through the service role.

### Money

- **Move money before changing a booking's status, never the other way round.**
- **`lib/pricing.ts` is the only place a total is calculated.** `lib/fees.ts`,
  `lib/hostDebt.ts` and `lib/refundSpread.ts` are the same rule for commission,
  debts and refunds. A host told £126 and paid £111 is how you lose a host.
- **An idempotency key must belong to the attempt, not to the booking.** Stripe
  forgets a key after 24 hours and binds it to the parameters it first saw, so a
  key built from a booking id alone is refused when the amount changes and
  forgotten by the time it would matter. Never put anything resettable in one.
- **A stay can have two charges.** A deposit booking is charged at checkout and
  again thirty days out, and a Stripe refund names one intent and may not exceed
  it. This broke every deposit refund until 1 September 2026.
- **Never compare a booking date against `new Date()`.** `check_in` and
  `check_out` are date-only strings, so `new Date(booking.check_in)` is
  midnight and a stay starting today reads as past. This put a same-day booking
  under Past bookings and took its Confirm button with it, so it could not be
  accepted at all. `lib/stayWindow.ts` is the one place that answers "has it
  started".
- **A host's debt is recorded twice and the two must agree.**
  `profiles.payout_balance_owed` is the running total the payout run reads; the
  `payouts` rows with status `owed` are the itemised version a host would be
  shown. Recovery is partial-aware and the original `amount` is never rewritten
  — that row is the evidence of what was charged and why.
- **An early fraud warning is not a chargeback** and the two must never be
  treated alike. One is a warning; the other has already taken the money.
- **Stripe's Adaptive Pricing is on by default and will offer euros** for a
  cottage priced in pounds. Off in the Dashboard *and* in
  `app/api/stripe/checkout/route.ts`, because the toggle is per account and per
  mode and travels less well than code does.

### Tests

- **A new test must be seen to fail before it is trusted.** Three times in one
  session, tests here asserted something other than what their name claimed —
  a stub handing back the wrong client; a check that looked at every update
  rather than the booking's; a `??` treating an explicit null as "not supplied",
  so a 403 test exercised the permitted path. `./scripts/mutate.sh` breaks a
  behaviour and reports whether anything noticed. It refuses to run on a file
  with uncommitted changes, because it ate the same fix twice before that guard
  existed.
- **Stubbing Supabase needs `clearModule('@/lib/supabaseAdmin')` too.** That
  module captures `createClient` when it loads and is then cached, so every test
  after the first in a file silently reuses the first one's fake database. 17 of
  63 tests were once failing on data they were never given. The same applies to
  any lib that captures a dependency at load — `lib/refundSpread.ts` cost an
  hour to the identical trap on 1 September.
- **Delete `.test-build` before a run that matters.** Compiled tests from
  another branch survive a branch switch.

---

## Email — two separate systems

checked: 2026-09-01

- **Auth email** (confirm signup, password reset, magic links) is sent by
  Supabase, configured per project.
- **App email** (bookings, payment reminders, payouts) goes through Resend with
  its own allowance. This is why decline emails kept arriving on a night when no
  confirmation would send, and why mail looked like it worked.

**Production has custom SMTP through Resend** — confirmed 1 September 2026 from
Resend's own send log. **Test does not**, so it falls back to Supabase's
built-in service, which is two emails an hour project-wide and delivers only to
pre-authorised team addresses. A brand-new address on test was refused
`429 over_email_send_rate_limit` on its first ever send. That is why no address
but Liam's has ever received auth mail there, and why the seeders create users
through the admin API rather than through the signup form.

Supabase also rejects reserved TLDs at signup, so `.test` addresses — the ones
this codebase reserves for automation — cannot go through the real form at all.
`.example` and `.invalid` are accepted.

Nothing is ever emailed to a reserved TLD: `sendEmail` refuses, centrally.

## CI, and the pre-push hook

checked: 2026-09-01

`test-and-build` runs on every push and must be green before master will take a
merge. Vercel refuses to promote a build that will not compile, but it never
runs `npm test` — which is why the check exists.

`git config core.hooksPath scripts/hooks` installs a pre-push hook that runs the
tests and the build, and warns if `migrate.mjs --status` shows anything
outstanding. `--no-verify` skips it for a work-in-progress branch and never for
master.

## The target guard is CommonJS, and has to be

checked: 2026-09-01

`scripts/target.cjs` is the only file allowed to contain a site URL, and every
runner asks it where to point. It is `.cjs` because Playwright compiles its
config to CommonJS and `require`s what it imports — requiring an ESM file dies
with "exports is not defined in ES module scope", which once stopped the whole
e2e suite from starting.

`tests/runner-targets.test.ts` fails the build if a runner names a URL itself or
reaches the site without the guard. It exists because `scripts/journeys.mjs` was
green for fifteen commits against a merged feature branch.

## Opening guest experiences — `GUEST_EXPERIENCES_OPEN`

checked: 2026-09-01

The guest-facing half of the services marketplace is built and gated behind that
flag. It is off on production. Turning it on is a business decision, not a
deploy: production has zero approved providers, and the first approval is also
what makes `service_providers.commission_rate` readable by `anon`.
