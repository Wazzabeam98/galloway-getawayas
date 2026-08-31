# Looking after Galloway Getaways

Notes for whoever is doing the maintenance — including Claude Code.

## What this is

A booking site for self-catering properties in Dumfries and Galloway. Guests
book and pay through the site; the platform takes a commission and passes the
rest to the property owner. Real money moves through it, so mistakes here cost
somebody something.

## A guard that throws is worse than no guard, and this shape recurs

On 28 August 2026 `scripts/seed-lib.mjs` contained:

```js
export { TEST_PROJECT_REF } from './target.cjs';
```

That forwards the name to importers and creates **no local binding**. Every use
of `TEST_PROJECT_REF` *inside that file* was a reference to something
undefined, so two functions threw `ReferenceError` at the moment they were
relied on:

- `assertTestEnvironment` — the guard the payment seeders run **before**
  touching anything, to prove they are not pointed at production.
- `signIn` — called by four scenario runners.

It arrived when the constant moved to `target.cjs` so Playwright could
`require` it. Nothing was wrong with that move; the re-export was.

**Why nothing caught it.** No unit test imports `seed-lib.mjs`, and none can
usefully — everything in it needs a database or a session, which is why the
scripts exist in the first place. So the file sits in a gap: too
infrastructural for the suite, too rarely run to notice. It was found by a new
script happening to call `signIn`, not by anything watching.

**Why the shape recurs.** The dangerous property is not the typo, it is that
the broken thing is a *guard*. A guard that throws looks identical to a guard
that is absent right up to the moment it matters, and then it fails in the
direction of the thing it was there to prevent — `assertTestEnvironment`
throwing means the seeder stops, which is safe by luck rather than by design.
The same shape has now appeared three times in two days:

- `migrate.mjs` refuses production — it had not since 27 August, and
  MAINTENANCE.md still said it did.
- `VERCEL_TOKEN` is read-only — it never was; the restraint is in
  `check-deploy.mjs`.
- `assertTestEnvironment` protects the seeders — it threw instead.

**What to do about it.** When you touch anything that exists to say *no*, run
the thing it guards and watch it say no. A guard is the one kind of code whose
success path proves nothing, so exercising the failure path is the only test
that means anything. `scripts/enquiry-rls.mjs` is written that way on purpose:
every check asserts a refusal, and it was run against the unfixed database
first to watch it fail.

## The migration goes to production BEFORE the code that needs it

**A migration reaches production before the code that depends on it merges.
Never after.** No exceptions, including "it is only a widened constraint" and
"nothing writes it yet".

This is a standing rule as of 28 August 2026, and it exists because two
sessions now work on this repo at once. Each can merge a branch the other has
not read, and a migration that lives on a branch is invisible to whoever
merges next — the code arrives on production and the schema does not follow,
because the person who would have run it is not the person who pressed merge.

**Why the ordering and not the reverse.** A schema that is ahead of its code
costs nothing: an unused column, a widened check nothing writes, a table with
no rows. A schema that is behind its code fails at the database, which on this
project has never been loud. The insert is refused, the browser reports
success, and the row simply is not there. Adding `hidden` to listings and
`pending_payment` to bookings both hit exactly that.

**In practice:**

- Run it with `node scripts/migrate.mjs --target prod <file> --apply`, after a
  dry run. Read the pre-flight at the top of the file first; run the read-back
  after.
- Do it before the pull request merges, not after — the merge is what makes it
  urgent, so it should already be done by then.
- If a migration is destructive, its pre-flight decides whether it runs at all.
  Read the count *before*.
- A branch carrying a migration should say so in its description, so whoever
  merges knows there is a database step they did not write.

**How to check what is outstanding**, in a checkout of the branch:

```
node scripts/migrate.mjs --target prod --sql "select table_name from information_schema.tables where table_schema='public' order by table_name"
```

and compare against `supabase/migrations`. There is no ledger table — the
migrations are applied by hand and nothing records that they ran, which is the
weakness this rule works around rather than fixes. A `schema_migrations` table
would make it checkable instead of remembered, and is worth building the next
time this bites.

## Which database am I on?

There are two Supabase projects and three ways to end up on the wrong one.

| | project name | project ref |
|---|---|---|
| Production | `supabase-pink-elephant` | `hviwjxigqivjfhmhpjiy` |
| Test | `galloway-getaways-test` | `yefoqcabuijcowoqewtc` |

- **Vercel Preview deployments read the test project. Production reads
  production.** Every environment-sensitive variable is now split per
  environment: the three Supabase variables, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET` and `RESEND_API_KEY`. Separated in
  Vercel on 22 August 2026, before the first live booking. A preview
  deployment therefore talks to the test project with test Stripe keys
  throughout, and cannot reach production data or live money by any of these
  routes.
- **`galloway-getawayas-git-master-…vercel.app` is production, not a preview.**
  master is the production branch, so that hostname is one of five aliases on
  the same deployment as the real domain. Any vercel.app URL with a random
  slug is a frozen snapshot of one build.
- **The reliable tell is what renders**: `SEED —` listings mean the test
  project; the four real listings mean production.
- **The Supabase CLI in this checkout is linked to production**, while
  `.env.local` points the app at test. So `supabase db push`, `db reset` or a
  migration run from here hits **live data** even though everything else in the
  session is on test. Check `cat supabase/.temp/project-ref` before any CLI
  command that writes, and re-link with
  `supabase link --project-ref yefoqcabuijcowoqewtc` if you mean test.

## Checking what's broken

Errors are recorded in the `error_log` table and shown at `/admin/errors`.

For a machine-readable summary, grouped so one fault reads as one issue:

```
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://gallowaygetaways.co.uk/api/errors/export?hours=24"
```

Optional: `hours` up to 720, and `resolved=true` to include ones already ticked
off.

Each issue comes with how many times it happened, which pages, how many people
it affected, and a sample stack.

## What to do with them

Worth acting on:

- anything with `"source": "server"` — a route or a scheduled job failed
- anything affecting several people
- anything touching payments, payouts, refunds or bookings

Usually not worth chasing:

- one-off browser errors from a single person, often an extension or a flaky
  connection
- anything from a bot or a crawler

## How to work on this

Please:

- **branch for money-touching code — payments, payouts, refunds — and let a
  human merge it.** Several bugs here have had non-obvious causes where the
  first plausible fix was wrong. Everything else goes straight to master while
  the site is private and pre-launch. See the house rules in `CLAUDE.md`.
- **read the surrounding code before changing it.** Naming collides in places —
  the Stripe webhook has a local variable called `logError`, unrelated to
  `lib/logError.ts`.
- **run the build before proposing anything, and do not let a green test suite
  stand in for it.** `npm test` and `npm run build` are not the same check, and
  the suite is the weaker of the two: `tsconfig.test.json` sets
  `"strict": false`, so it compiles code that `next build` refuses.

  This is not hypothetical. On 28 August 2026 an interface gained four fields
  in one place and not in the other, and `submitProblems` was handed a draft it
  had no declaration for. 546 tests passed. `next build` failed with a type
  error naming the exact argument.

  It is also narrower than it looks: `tsconfig.test.json` has a hand-written
  `include` list, so `lib/**` and `tests/**` are checked and app routes are
  checked only if somebody remembered to add them. A route nobody listed is
  invisible to `tsc` as well as to the tests.

  So: **a green suite means the logic you wrote tests for is right. It does not
  mean it compiles.** Run both. TypeScript has caught real bugs here, not just
  style issues.
- **say when you are unsure.** A flagged uncertainty is far cheaper than a
  confident wrong fix to a payment route.
- **do not enter credentials into forms or CLI fields.** Keys, tokens and
  passwords are the owner's step, even when he has supplied the value.

## Things that bite

- **Do not decide what a page rendered by grepping its HTML for text you
  expect to be absent.** Next ships the components for a route's error and
  not-found boundaries inside the RSC flight payload, in `<script>` tags, on
  EVERY page under that segment. So `app/not-found.tsx`'s wording — "We
  couldn't find that page" — is present in the HTML of pages that rendered
  perfectly well.

  This cost most of an afternoon. A check of the nine `/admin` pages grepped
  the raw HTML for that string and reported all nine as 404s. They were fine;
  every one of them was rendering "Owner tools" and the full list. The chase
  went as far as suspecting a just-merged refactor of the admin auth guard, and
  then the session harness, before anyone looked at what the page actually
  said.

  Two rules that between them make it not happen again:

      strip <script> before reading anything out of a page
      assert on what a page SAYS, not on what it does not say

  The same trap has a sibling. `Welcome, {firstName}` renders as
  `Welcome, <!-- -->Seed` — React puts a comment between static text and an
  expression — so `/Welcome,\s*(\w+)/` does not match a page that is
  displaying exactly that. Match the literal, or read `innerText` from a real
  browser.

  `scripts/signed-in-crawl.mjs` does it properly and its header records all of
  this; copy that rather than starting again.

- **A signed-in page check needs a session the SERVER accepts.** Most of the
  site behind the login is client-rendered, so `curl` sees a spinner and
  nothing else — a crawl of `/dashboard` with no browser is measuring the
  loading state. `sessionCookieViaApp()` in `scripts/seed-lib.mjs` mints a real
  one by walking a magic link through the app's own `/auth/callback`, which is
  what a person clicking the link in their email does. For what the page
  finally shows, drive a browser; for status codes and server-rendered
  chrome, the cookie is enough.

- **This targets es5.** Some modern syntax fails the build — spreading a `Set`,
  for example.
- **Adding an import**: insert it before the first import, not after the last
  one. Several files use multi-line `import { ... }` blocks and an import
  dropped into the middle of one is a syntax error. This has happened three
  times.
- **Never put Tailwind class names in `lib/`.** `tailwind.config.js` scans
  pages, components, app and src only, so no CSS is generated and elements
  render invisible — white text on no background. Use hex values via inline
  style, or `currentColor`.
- **A Tailwind class with an off-scale number generates nothing, fails
  silently, and looks plausible. Check the computed value, not the class
  name.** This is the single most expensive recurring bug in this repo — three
  instances so far, each one found by measuring rather than by reading.

  Tailwind only emits a class when the number in it is on a scale it knows
  about. Give it one that is not and it does not warn, does not error, and
  writes no rule. The markup still reads exactly as intended, so the place you
  would naturally look to check is the place that lies to you. The result is
  never an obviously broken page — it is a page that is slightly wrong in a way
  you can argue about in a screenshot.

  The default opacity scale is 0, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80,
  90, 95, 100. Anything off it needs an arbitrary value.

  **The check, always:** read the computed value in the browser, not the class
  list. `getComputedStyle(el).backgroundColor`, `.backgroundImage`,
  `.paddingLeft`. A missing class shows up as the initial value — `none`,
  `rgba(0, 0, 0, 0)`, `0px` — where you expected something. Grepping the built
  CSS for the class name works too, and is faster when you already suspect it.

  The three, and what each needs:

  - `bg-white/85` on the frosted search card. 85 is off the opacity scale, so
    no class. What made it nasty: `backdrop-blur-md` alongside it is real, and
    a 12px backdrop blur over a *fully transparent* background still visibly
    blurs the photo behind it. The card looked frosted. It was a blur with no
    white in it. Caught by `getComputedStyle(el).backgroundColor` returning
    `rgba(0, 0, 0, 0)`. Fix: `bg-white/[0.85]`.

  - `from-stone-950/45` on the hero's bottom vignette. Same cause, worse blast
    radius: a gradient needs all of its stops. With `--tw-gradient-from` unset
    the whole `linear-gradient()` was invalid, so the element computed to
    `background-image: none` and *the entire overlay had never rendered on any
    screen since it was written* — while `via-*` and `to-*` beside it compiled
    fine, which is what makes the class list look healthy. Fix:
    `from-[rgba(12,10,9,0.45)]`.

  - Breakpoint-keyed `theme.container.padding`. Different mechanism, same
    failure. `theme.container.screens` is `{ "2xl": "1400px" }`, and that list
    also decides which breakpoints `padding` may use, so
    `padding: { DEFAULT: "1rem", md: "2rem" }` generates the `1rem` and no `md`
    rule anywhere. Every screen got the phone padding and desktop quietly lost
    its margin. Cost a round of measuring at 1280px, having been called done
    once already. Fix: put per-breakpoint container padding in
    `app/globals.css` as a plain media query after `@tailwind utilities`, with
    a comment saying why — there is one there now capped at
    `max-width: 767px`.

  Prefer an arbitrary value any time the number is not obviously on a scale.
  It costs nothing when it was on the scale anyway, and it cannot be silently
  swallowed.
- **Check column and table names against the repo before writing a query.**
  Invented names have got as far as being sent more than once.
- **New status values need the check constraint widening first.** Adding
  `'hidden'` to listings, or `'pending_payment'` to bookings, fails silently at
  the database until the constraint allows it.
- **Some Supabase functions throw rather than returning an error.**
  `exchangeCodeForSession` and `signUp` both do, for non-auth failures. A
  `{ error }` destructure alone leaves a 500 or a button stuck on
  "Processing.." with nothing shown to the person. Wrap them.
- **Two confirmed stays cannot overlap — the database enforces it.**
  `bookings_no_overlapping_confirmed` is an exclusion constraint on
  `(listing_id, daterange(check_in, check_out))` for rows where
  `status = 'confirmed'`. The checkout route still refuses clashing dates and
  holds them while a guest pays, but those are checks made before the money
  moves; this is the only thing that makes it impossible. When it fires the
  Stripe webhook refunds the guest in full and emails an apology, so a booking
  that trips it is not a crash — look for it at `/admin/errors`.

  **It is live on both projects — nothing needs running.** Test and production
  both have it; on production it is visible under Database → Indexes. The
  pre-flight query in the migration file was run against production on
  21 August 2026 and returned no rows, so no existing pair of confirmed stays
  was ever standing in its way.

  Keep the pre-flight in mind for the *next* exclusion constraint rather than
  this one: a constraint of this kind refuses to be created if the data
  already violates it, so the query goes first and any overlapping pairs get
  sorted out before the `alter table`.

- **A published listing must have a name and a price the database agrees to.**
  `listings_published_are_complete` is a check constraint on `listings`: a row
  at `status = 'published'` must have a title that is not blank once trimmed
  and a `price_per_night` above zero. Drafts are exempt on purpose — a
  half-finished draft is the point of Save & finish later — and `hidden` rows
  were published before they were taken down, so they already pass.

  It exists because both places that publish are browser code writing straight
  to the table: the wizard in `app/addhome/page.tsx` and
  `app/edit-listing/[id]/page.tsx`. Both refuse now, but a form can only refuse
  politely. Two ways past them had already been found — the wizard stored
  `title || 'Untitled listing'` on a draft, which then loaded back in and
  published as the name, and the edit screen tested `!price`, which the string
  `"0"` passes.

  **Live on both projects as of 22 August 2026 — nothing needs running.** The
  pre-flight was run against both first and returned no rows either side.
  Production had to be done in the Supabase SQL editor. The reason given at the
  time was that only the test database password was on the MacBook — as of
  22 August 2026 neither is, and both projects have to go through the SQL
  editor. See the migration bullet further down.

  **Photos are deliberately not in it**, even though the wizard requires one.
  Every seed listing in the test project is created with an empty `images`
  array, so a photo condition would have refused to apply to test at all and
  would have broken the payment suite's reseed. Photos are a rule the forms
  enforce and the database does not. Worth knowing before anyone "completes"
  this constraint and wonders why the seed scripts stop working.

- **Starring and archiving a conversation are per person, not per thread.**
  `conversation_prefs` is keyed on `(user_id, booking_id)` — one row per person
  per conversation. A host and a guest share one thread, so a flag on the
  booking would have meant one of them archiving it emptying the other's
  inbox. A conversation is not always two people either: `booking_guests` lets
  a companion message the host, so keying on the person is what makes that
  work without a special case.

  **Archived is worked out, not stored.** A conversation counts as archived
  only while `archived_at` is set *and* nothing has been sent to that person
  since. So a guest's message un-archives it by existing — there is no trigger
  on message insert to miss, and no state to get stuck. Archiving means "done
  for now", not "stop telling me", which matters because a guest asking about
  next week's stay must never sit in a folder nobody looks at. The rule lives
  in one place, `lib/conversations.ts`, and both the inbox and the menu badge
  read it from there.

  **`archived_at` is stamped by the database, not the browser.** A trigger,
  `conversation_prefs_stamp_trigger`, replaces whatever the client sends with
  `now()`. It has to: that stamp is compared against `created_at` values the
  database wrote, so a laptop running a few seconds slow would archive
  something and watch it bounce straight back, looking exactly like Archive
  being broken. This machine was one second behind Supabase and that was
  enough to catch it. **Any future column compared against a database
  timestamp needs the same treatment.**

  The trigger only restamps a value that has actually just been set. An upsert
  fires the BEFORE INSERT trigger before it notices the conflict, so stamping
  unconditionally handed the update a value that always looked new — and
  starring a conversation silently re-archived it. Hence the existence check
  in the insert branch.

  **Both migrations are live on both projects as of 22 August 2026 — nothing
  needs running.** `20260822014817_conversation_prefs.sql` and
  `20260822014818_conversation_prefs_server_clock.sql`. Both are new objects with no
  constraint on existing data, so both are safe to run again.

  `node scripts/inbox-scenarios.mjs` covers all of it against test — 28 checks,
  including a host and a guest archiving the same thread independently, a
  message bringing an archived thread back, and the menu dot agreeing with the
  list. It needs `npm run dev`.

- **There is no database connection on this machine for either project, so
  migrations are pasted into the Supabase SQL editor by hand.** Checked on
  22 August 2026: no `DATABASE_URL` in any `.env` file, no password in
  `supabase/.temp/pooler-url` (which is production's anyway), and no Supabase
  access token in `~/.supabase`. An earlier note here said a terminal could
  reach test but not production. That is no longer true of either.

  In practice that means **write migrations to be pasted**: idempotent, safe to
  run twice, with any pre-flight query in a comment at the top, because they
  get run by hand on two projects and nobody is watching an exit code.

  If a connection string ever does turn up, there is no `psql` on this machine
  but Colima is, so:

  ```
  docker run --rm -i postgres:16-alpine psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f - < supabase/migrations/<file>.sql
  ```

  Do **not** use `supabase db push` — the CLI is linked to production, see
  above.

  A migration can still be **rehearsed** without either project, which is worth
  doing before handing one over. Start a throwaway Postgres, create stubs for
  whatever the file references, and run it — twice, to prove it is safe to
  re-run:

  ```
  docker run --rm -e POSTGRES_PASSWORD=x --name sqlcheck -d postgres:16-alpine
  ```

- **Checking a migration landed, without a database connection.** Two things
  can be done over the REST API with the keys in `.env.local` and
  `.env.production.local`:

  - **the table and its columns** — `GET /rest/v1/<table>?select=col,col&limit=1`
    with the service key. A 200 means every column named exists.
  - **that row-level security is really on** — POST a row as **anon** using a
    made-up uuid for the foreign keys. RLS on gives `42501 permission denied`;
    RLS off gives a foreign-key violation instead. The foreign keys make it
    impossible to actually write anything, so this is safe to run against
    production.

  What this cannot check is **triggers and functions**. PostgREST leaves
  functions returning `trigger` out of its schema cache, so calling one over
  RPC reports it missing whether or not it exists — do not read that as an
  answer. Either test the behaviour, or run this in the SQL editor:

  ```
  select tgname from pg_trigger
  where tgrelid = 'public.<table>'::regclass and not tgisinternal;
  ```

- **Never compare a booking date against `new Date()`.** `check_in` and
  `check_out` are date-only strings, so `new Date(booking.check_in)` is
  *midnight*, and comparing that against the current time makes a stay
  starting today read as already past. This put a booking made for that
  evening under Past bookings, taking its Confirm button with it — the only
  place a host could accept, so a same-day booking could not be accepted at
  all. `lib/stayWindow.ts` is the one place that answers "has it started" and
  "has it ended"; use it rather than writing the comparison again. The same
  care applies to any new date-only column.

- **Accepting, declining, cancelling and refunding are the owner's alone.**
  `/api/stripe/refund` and `/api/bookings/host-refund` check `host_id`
  directly and answer 403 to everybody else, whatever `can_bookings` says —
  see the note on `accessibleListings`. Any screen offering those buttons has
  to gate them on `isOwner`, or a co-host gets a button that can only fail.

- **A host's debt is recorded twice, and the two must always agree.**
  `profiles.payout_balance_owed` is the running total the payout run reads;
  the `payouts` rows with status `owed` are the itemised version a host or a
  dispute would be shown. They are the same money counted two ways. The run
  used to move only the total and leave the rows saying `owed` for ever, so
  anything listing what a host owed kept listing debts already taken.

  Recovery is partial-aware: `settled_amount` records how much has come back,
  `status` becomes `settled` only when it covers the whole thing, and the
  original `amount` is never rewritten — that row is the evidence of what was
  charged and why. The allocation lives in `lib/hostDebt.ts` and is shared by
  the run, the earnings page and the booking screen, because a host told £126
  and paid £111 is how you lose a host. Owner tools warns in red if the rows
  and the totals ever disagree.

  `20260822203006_cancellation_record_and_debt_settlement.sql` — **live on both
  projects as of 22 August 2026, nothing needs running.** It also adds
  `cancelled_at`, `cancelled_by_user` and `cancelled_by_role` to `bookings`:
  until then the only trace of who cancelled was `initiated_by` in the
  metadata on the Stripe refund, and the 5% host fee turns on exactly that
  distinction. Existing cancellations are deliberately **not** backfilled — a
  `penalty` row is evidence a cancellation was the host's, not a record, and
  this column will be quoted at somebody one day.

- **A new test must be seen to fail before it is trusted.** A passing suite
  says nothing about whether the tests would catch a regression. Three times in
  one session tests here turned out to be asserting something other than what
  their name claimed — each one a default quietly standing in for the case
  under test, each one passing for a long time:

  - a payout test whose stub handed back the wrong client, so it asserted on
    data it was never given
  - `"one failed attempt must not change the booking status"`, which checked
    *every* update rather than the booking's, and only passed because payments
    happened to be inserted rather than updated
  - a 403 test written with `opts.access ?? default`, where `??` treats an
    explicit null as "not supplied" — so it exercised the permitted path while
    claiming to test the refusal

  `./scripts/mutate.sh <file> <from> <to> <label>` is how you tell: it breaks a
  behaviour, runs the suite, and reports whether anything noticed. Four real
  gaps came out of it in one evening — the payout idempotency key,
  `lib/stayWindow.ts` and `lib/access.ts` with no tests at all, and the
  cancellation attribution that decides whether a host is charged 5%.

  It reverts with `git checkout --`, so it **refuses to run on a file with
  uncommitted changes**. That guard exists because it silently ate the same fix
  twice in one evening before it was there.

- **The unit tests were unreliable until 22 August 2026, and the same trap is
  still there for any new test file.** Routes reach the database through
  `lib/supabaseAdmin`, which captures `createClient` when it loads and is then
  cached like any module. Stubbing `@supabase/supabase-js` for a *second* test
  in a file therefore changed nothing: every test after the first silently
  reused the first one's fake database. 17 of 63 tests were failing on data
  they were never given, in `host-payouts`, `balance-charges` and `webhook` —
  and the passes meant no more than the failures did. Any loader that stubs
  Supabase must `clearModule('@/lib/supabaseAdmin')` as well as the route.

- **Delete `.test-build` before any run that matters — compiled tests from
  another branch survive a branch switch.** `npm test` is
  `tsc -p tsconfig.test.json && node --test .test-build/tests`. `tsc` writes
  into that directory but never cleans it, so a test file that exists on one
  branch and not another stays compiled and keeps running after you switch
  away. The count goes up, everything passes, and the extra tests are exercising
  source that is no longer checked out.

  Seen on 24 August 2026: a branch with 20 test files reported **214 passing**,
  the exact figure from the branch it was cut from, which has 24. The honest
  number was 210. Nothing failed, so nothing drew attention to it — a suite
  reporting *more* than it has is invisible in a way a failure never is.

  `rm -rf .test-build && npm test` before trusting a count, and always after
  `git checkout`. This is the third time this suite has claimed more than it
  tested; the other two are directly above and the fourth is directly below.

- **Coverage of the API routes is opt-in, and the suite is silent about what
  it leaves out.** `tsconfig.test.json` has an `include` array that names route
  files **one at a time**, alongside `tests/**` and `lib/**`. As of 24 August
  2026 that list holds **7 of the 43 route files under `app/api`** — 36 routes
  are never compiled into `.test-build` at all, so no test can require one. A
  test written against a route that is not on the list fails with
  `MODULE_NOT_FOUND` rather than a real assertion, which reads like a broken
  test rather than a missing one.

  Among the 36 left out are `stripe/checkout`, `stripe/balance-checkout`,
  `stripe/refund`, `stripe/connect`, `stripe/payout-schedule`,
  `bookings/cancel`, `bookings/host-refund` and `admin/commission` — every one
  of them money-touching.

  Found on 24 August 2026: 227 tests passed over a services approval route that
  wrote the row, told the admin "Approved." in green and emailed nobody. The
  route was not in the build, and the `lib/` tests beside it — the distance
  maths, the validation — passed happily.

  **Add the route to `include` in the same commit that adds the route**, and
  make the new test fail once before trusting it to pass. A green suite says
  nothing whatever about a route it does not compile.

- **Stripe's Adaptive Pricing is on by default and will offer euros.** It
  converts a GBP price into whatever currency it decides the guest's country
  wants, which is why a checkout with `currency: 'gbp'` hard-coded still
  showed euros in live mode. It is off in two places on purpose:
  `adaptive_pricing: { enabled: false }` on both Checkout Sessions, and the
  Dashboard toggle at Settings → Payments → Adaptive Pricing, which is **per
  account and per mode** — switching it off in a sandbox does nothing to live.
  Verified against `Stripe-Version: 2024-06-20` on 22 August 2026: the
  parameter is accepted on that version, and a session created without it
  comes back `adaptive_pricing: { enabled: true }`.

  It never affected the money. The session and payment intent always reported
  the integration currency and amount, so commission, payouts and refunds were
  correct throughout — it changed what the guest saw, and charged them a 2-4%
  conversion fee for it.

- **A co-host is not the `host_id` on a booking.** Any query on their behalf
  needs the service key, or row-level security returns nothing and the page
  looks empty rather than broken.
- **Money columns are revoked from `authenticated`.** `commission_rate`,
  `payout_*`, `payout_balance_owed`. Anything writing to those goes through a
  server route.
- **`is_admin` is NOT revoked, whatever this file used to say.** An anonymous
  select returns it, so anyone can work out who the owners are. That discloses
  something; it grants nothing, because every owner page checks the flag on the
  server against the signed-in user's own row.

  It is left as it is on purpose. Every admin page and route reads it with the
  **session** client — `app/admin/*`, `/api/admin/*`, the moderation branch in
  `/api/listings/save` — so revoking it breaks all of them at once, silently,
  with a `notFound()` rather than an error. If you do revoke it, every one of
  those has to move to the service role **in the same commit**.
- **Refund or transfer money before changing a booking's status**, and don't
  notify anyone until it has succeeded. Doing it the other way round is how a
  guest gets told their booking is cancelled while their money is still here.
- **A host can have several messages of one kind, one per property — and the
  database is what stops two of them naming the same one.** `message_templates`
  used to be unique on `(user_id, template_type)`. Scope now lives in
  `message_template_listings`, because a `uuid[]` column cannot be constrained:
  Postgres has no built-in way to say "no two templates of this type may name
  the same listing", and that rule is the only thing between a misconfiguration
  and a guest being sent another property's door code.

  The join rows carry `user_id` and `template_type` purely so that unique index
  can be written. **They are filled by a trigger from the parent, never by the
  caller** — a forged `user_id` is overwritten, so a caller cannot defeat the
  constraint by lying about which template a row belongs to. Same reasoning as
  the `conversation_prefs` stamp trigger. Verified against both live projects
  on 23 August 2026: a second template of a kind naming the same listing is
  refused with `23505`, and the forged-`user_id` route is refused the same way
  because the trigger has already replaced the value the caller sent.

  **Most specific wins, exactly one message.** A template naming the listing
  beats one left open to everything; a listing with no specific template falls
  back to the catch-all; a disabled specific one falls back rather than sending
  nothing. The rule lives in `lib/messageTemplates.ts` because two places ask —
  the scheduled sender and the welcome posted on accept — and two
  implementations would eventually disagree about which message a guest gets.
  The tie-break (oldest) should be unreachable; it exists because "should
  never" is not "cannot" — the unique index is live on both projects, so the
  only rows that can reach it are ones predating it. The coverage grid in
  `components/account/TemplateCoverage.tsx` reports the clash rather than
  quietly picking a winner, for the same reason.

  The sender walks **bookings and then types**, not templates. Walking
  templates gives each a turn and sends whichever the query returned first,
  which is what it used to do.

  `20260823012922_templates_per_listing.sql` — **live on both projects as of 23
  August 2026, nothing needs running.** `message_templates.listing_ids` is
  vestigial but deliberately still written by the editor, because the migration
  ran before the deploy. Drop it in its own migration once the new code has
  been live for a day or two, and remove the write in
  `components/account/MessageTemplates.tsx`.

- **A door code is never a column on `listings`.** Five places read that table
  with `select('*')` — the public listing page among them — so a column there
  ends up in the page source. Revoking it does not help either: Postgres
  refuses `select *` outright when a column has been revoked, which breaks the
  public page, the wizard, the edit screen, the save route and account settings
  at once. Codes live in `listing_access_codes`, RLS on, **no grants for `anon`
  or `authenticated`**, reachable only through the service role and
  `/api/listings/access-code`, which checks `can_listing`.

  `20260823002843_listing_access_codes.sql` — **live on both projects as of 23 August
  2026, nothing needs running.** Anonymous read and write are refused with
  `42501` on both.

  The `{lockbox_code}` placeholder resolves from **the booking's own listing**,
  never from the template. That matters because `message_templates` is unique
  on `(user_id, template_type)` — one template per type per host, so a host
  with three properties *cannot* write one per property. The placeholder is the
  only way one message can carry the right code to each. `listing_ids` narrows
  which listings a template applies to and does not interact with the code
  lookup.

  A message asking for a code the listing has not got is **held back and
  logged, never sent with a gap** — and held back *before* the send is claimed,
  so it goes out on a later run once somebody fills the code in. Claiming first
  would mark it done for ever and the guest would never get it.

  Worth knowing operationally: once sent, the code stays in that guest's
  message thread and they can look it up months later. Change codes between
  guests; the feature assumes you do.

- **An early fraud warning is not a chargeback, and the two must never be
  totalled together.** Stripe's `warning_*` dispute statuses are an inquiry:
  the card network has flagged a charge and **no money has been taken**. A real
  dispute withdraws the amount from the balance immediately. Both arrive as
  `charge.dispute.*` events, both have an evidence deadline, and they look
  nearly identical in the payload — the tell is that a warning cannot be closed
  the way a dispute can.

  `isInquiry()` in `lib/disputes.ts` is the check, and `isMoneyAtRisk()`
  excludes warnings, won disputes and anything reinstated. Owner tools shows
  warnings in amber and real losses in red on purpose. This was caught by
  raising one of each against test Stripe and reading the total: it said
  "£46.00 at risk" when £45 had gone and £1 had not. A liability figure that
  overstates itself is one nobody checks twice.

  A warning still wants answering — a good response is what stops it becoming a
  chargeback — so it is shown, just not counted.

  The platform carries full chargeback liability, so `charge.dispute.created`
  reaching nobody meant the first sign was money missing. Both directors are
  emailed on open and on resolution, not through the 8am digest: Stripe's
  window is 7 to 21 days and a summary the next morning can burn a fifth of it.

  **Nothing submits evidence to Stripe.** A submission is final and cannot be
  revised, so a half-assembled one is worse than a late one. It is a person's
  job, in Stripe.

  `20260822231427_disputes.sql` — **live on both projects as of 22 August 2026,
  nothing needs running.** RLS is on with no policy for `authenticated`: a
  dispute names a guest who has accused somebody of taking their money, and the
  host it concerns must not read it out of the browser.

- **An idempotency key must belong to the attempt, not to the booking's
  current state.** "Nothing resettable in the key" is the symptom; this is the
  rule. Two keys have got this wrong now. One included an attempt counter, a
  test reset it, and Stripe took a second payment. The next was
  `balance-<booking>-<balance_due_date>`, under a comment calling those
  "things that don't move" — the due date is an ordinary column, and moving it
  is exactly how a balance is made chargeable today for testing.

  The balance charge now claims a `payments` row before charging and uses that
  row's uuid as the key. The record that an attempt happened and the thing
  stopping it happening twice are one object, so they cannot disagree — and a
  run that dies between claiming and hearing back from Stripe is covered,
  because the next run finds the dangling `attempting` row and reuses its id.
  `payout-<booking>` in the payout run is the other shape that works: one
  payout per booking, ever, so the booking id alone *is* the attempt.

  Two things about Stripe's behaviour that make this matter more than it
  looks. Results are saved **whether the request succeeded or failed**, so a
  reused key after a decline replays that decline without the bank seeing
  anything. And keys are pruned after **24 hours**, while the balance job's
  one-attempt-per-day guard admits an attempt after **20** — so a key built
  from anything stable across attempts left a four-hour window in which a
  manual re-run recorded a refusal that never happened.

## Two things noticed about the real listings, neither fixed

Found on 28 August 2026 while checking whether the services shop could work
out where a property is without asking. Both are recorded rather than fixed,
deliberately — neither is urgent and both want a decision rather than a patch.

**Two listings share one set of coordinates.** Read off the public site:

| Listing | Coordinates |
|---|---|
| 4 bedroom Townhouse, Kirkcudbright | 54.83804, −4.04878 |
| Modern 3 Bedroom, Kirkcudbright | 54.8352482, −4.0543927 |
| Modern Cottage, with Hot Tub | 54.8352482, −4.0543927 |

The second and third are identical to seven decimal places, which is not two
buildings a few doors apart — it is one geocode being inherited. Harmless for
the services shop, which only asks whether a point falls inside a coverage
circle and gets the same answer either way. It would stop being harmless the
day anything uses the coordinates to tell the two apart: a distance sort, a
map with two pins, a "nearest tradesman" that quietly measures from the wrong
house.

**`location` is hand-typed and already spelled two ways.** "Kirkcudbright,
Dumfries and Galloway" on two of them, "Kirkcudbright, Dumfries & Galloway"
on the third. Nothing is broken by it today: `townForLocation` reads the town
from its own comma-separated part and never looks at the region, and
`lib/places.ts` normalises to letters only. But a free-text field holding the
same place two ways will eventually be grouped, counted or matched by
something that compares it whole, and that is the day it costs an afternoon.
`buildLocation` in `lib/places.ts` is the one place it is assembled, so the
fix has somewhere to live when it is wanted.

## The service tables were briefly split, and are not any more

`service_providers` was split into a business and its trade listings for a few
hours on 26 Aug 2026, so somebody holding two trades would type their name
once. That was the wrong shape — a cleaning round and a window round are two
businesses under two names — so the migrations are back to carrying the name on
the listing, with `unique(owner_id, trade)` giving one business per trade per
person.

Step one of the old catch-up ran on test. **Step two never did**, which is why
undoing it cost nothing: step two was the half that dropped `owner_id`,
`business_name` and `contact_email`, and they were still there and still
populated the whole time. `scripts/test-catch-up/undo-the-split.sql` puts test
back and is the only thing in that folder now.

The lesson worth keeping: the two-step order — add, deploy, then drop — is what
made a change of mind cheap rather than a reconstruction job. It was written to
survive a bad deploy and it ended up surviving a bad decision.

**There IS a free trial, and this paragraph used to say the opposite.** Read
the correction before the rule, because the wrong version was here for four
days and may well have been pasted somewhere else in the meantime.

What it said: "There is no free trial", and that `TRIAL_DAYS`, `trialEndsAt()`
and `trial_ends_at` were "all gone rather than left dormant". That was true when
it was written and was reversed on 27 August 2026 by
`20260827135718_provider_trial_and_plan.sql`, which argues the case at length and
is worth reading before touching any of it.

The rule as it stands:

- Cleaning (`sponge`) and waste (`bin`) and the four guest trades pay **10% a
  job**, at `commission_rate` on the provider row. No trial, nothing to start.
- The other eight host trades pay **£20 a month after 90 free days**, with no
  commission at all. `TRIAL_DAYS`, `trialEndsAt()` and `trial_ends_at` are all
  live again.
- **The 90 days start when the first enquiry is sent to him**, not at approval —
  see `20260831140000_trial_starts_at_first_enquiry.sql`. The only place that may
  start a clock is `app/api/services/enquiries/route.ts`, and it stamps only
  when the email actually went.
- Nothing bills anybody yet. There is no Stripe subscription behind any of it.
  `SUBSCRIPTION-SCOPE.md` is the lifecycle this is being built towards.

The original warning is still the right warning, and it is why the stamp lives
where somebody is told rather than where a form was filled in: the words "Free
for 90 days" came off the sign-up in commit `ccbc10c` while the machinery behind
them lived on for several commits, which is how a promise nobody meant to make
gets made again. A dormant clock and a stale paragraph are the same bug in two
media — this one nearly deleted the feature it was describing.

## SMS — one way, emergencies only

A tradesman gets a text as well as an email when an owner has an **emergency**,
and only then. Everything else is email. Texting every enquiry is how a channel
stops being read, and emergencies are where minutes decide it.

**Nothing can ever be accepted by replying to a text.** The sender is an
alphanumeric ID (`GallowayGG`), which cannot receive a reply at all — that is
the feature, not a limitation worked around. He accepts through the link in the
text or through his email, and that accept is the only thing that reveals a
name, a number or an address. There is no inbound webhook and no long number.

The reason is what a wrong guess costs: matching an inbound "yes" back to an
enquiry means hoping he has exactly one open, and with two, accepting the wrong
one sends a tradesman to the wrong house and hands a stranger's address to
somebody who never asked for it. If replying by text ever looks tempting, it is
a conversation to have before it is a thing to build.

The message is built to fit **one GSM-7 segment** — 160 characters. Over that
it splits and costs double; a single character outside GSM-7, such as a curly
apostrophe, drops the whole message to 70 characters a segment. Neither fails
loudly. `emergencySms` in `lib/sms.ts` builds it to fit and there are tests on
both the length and the alphabet.

`/e/<token>` is the short link the text uses. It is a redirect to
`/services/enquiry/<token>` and nothing else — the path length is worth 44
characters of message, which is the trade and the town.

A provider can turn texts off and keep email (`service_providers.sms_opt_out`),
and the sign-up says beside the phone field that emergencies are texted.
Without an opt-out a tradesman who does not want texts removes his number
instead, and then nothing can reach him when it is urgent.

`node scripts/check-sms.mjs` answers "did he see it" — see scripts/README.md.

## Email — two separate systems

- **Auth email** (confirm signup, password reset, magic links) is sent by
  **Supabase**, using SMTP configured inside each Supabase project. Production
  uses Resend SMTP. The `RESEND_API_KEY` in Vercel has nothing to do with it.
- **App email** (booking confirmations, payment reminders, payout breakdowns)
  is sent by the app through `lib/email.ts` using the Vercel Resend key.
- **The test project has no SMTP configured**, so it falls back to Supabase's
  built-in service — a handful of emails per hour for the whole project. A
  signup whose email cannot be sent fails whole and creates no account.
- Auth templates must link to
  `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=…`, not
  `{{ .ConfirmationURL }}`, or the link lands on the home page signed out.
  `{{ .RedirectTo }}` means one template body works for every environment.

## Auth

`app/auth/callback/route.ts` handles `?code=` (PKCE — the verifier lives in a
cookie belonging to the browser that asked, so request-on-laptop /
open-on-phone can never work through this path) and `?token_hash=&type=` (via
`verifyOtp`, no verifier needed, works cross-device). It checks its own result
and surfaces failures; an earlier version reported `?success=loggedin`
regardless. `signUp` sets `emailRedirectTo`. `/auth/reset` is the new-password
page. `<Toast />` is mounted in the layout — it used to be on `/dashboard`
only, so every error these redirects carried vanished unseen.

`middleware.ts` protects `/dashboard/:path*` using `createMiddlewareClient`,
which can write refreshed cookies. `createServerComponentClient` cannot, and
would bounce a genuinely signed-in person whose token refreshed on read.
`/addhome` is deliberately excluded — it handles signed-out visitors better
itself.

## Running the payment suite

27 scripted scenarios across four runners, all passing as of 21 Aug. Reseed
between runners as `scripts/README.md` requires.

- **The Stripe webhook signing secret changes every time `stripe listen`
  starts** and must be written back into `.env.local` by hand:

  ```
  stripe listen --forward-to localhost:3000/api/stripe/webhook
  ```

  Forgetting this is the classic one — every webhook fails its signature check,
  so payments succeed at Stripe while the site still shows the booking as
  unconfirmed. It looks like a bug in the webhook and is not.

- The Stripe CLI is not logged in. Point the listener at the `sk_test_` key
  already in `.env.local` rather than running `stripe login`, which needs a
  browser. Pass it as an env var, not a flag, to keep it out of the process
  list.
- **Colima has to be started after a reboot** (`colima start`). `colima`,
  `docker` and `stripe` live in `~/homebrew/bin`, which is not on the default
  PATH.
- The suite's reset only touches `@gallowayseed.test`. The passport seed data
  lives on a different domain deliberately, so it survives a reseed.

## Scheduled jobs

All at `/api/cron/*`, all behind `CRON_SECRET`, all listed in `vercel.json`:

| Job | When | Does |
|---|---|---|
| `balance-charges` | 9am | Takes the balance 30 days before check-in, then the 72-hour failure ladder |
| `host-payouts` | 11am | Pays hosts the day after their guest checks in |
| `ical-sync` | every 3 hours | Refreshes imported calendars |
| `review-reminders` | 10am | Nudges guests and hosts to review |
| `error-digest` | 8am | Emails the owners, only when something has broken |
| `service-enquiries` | every hour, :15 | Expires an enquiry nobody answered and tells the host to try somebody else |

They can be triggered by hand from Vercel → Cron Jobs → Run.

`CRON_SECRET` is split per environment as of 22 August 2026, so a preview
deployment's cron routes run against the test project with test Stripe keys.
They were shared until then, which meant a preview build could fire a real
balance charge — worth knowing when reading anything that ran before that
date.

## Where things live

- `lib/pricing.ts` — the only place a booking total is worked out. The widget
  and the server both use it, so they can't disagree.
- `lib/cancellation.ts` — cancellation tiers and refund fractions.
- `lib/access.ts` — who may do what to which listing.
- `lib/fees.ts` — commission.
- `lib/clawback.ts` — recovering a payout after a refund.
- `lib/logError.ts` — recording a server-side failure. Never throws.
- `lib/supabaseAdmin.ts` — the shared `adminClient()`. Never build a
  service-role client inline; all 20 callers use this one, and a missing
  `SUPABASE_SERVICE_ROLE_KEY` now throws by name rather than failing later as
  an opaque auth error.
- `lib/places.ts` — the only place a free-text location is parsed
  (`publicArea` / `townOf` / `townKey`).
- `lib/serviceProviders.ts` — the trade vocabulary and every rule about a
  provider. `canBeBooked` and `canBeEnquiredAbout` are two different questions
  and deliberately disagree about maintenance: a plumber can be asked to come
  and look, and cannot be booked and charged, because quoting and completion
  do not exist. `SHOP_TRADES` is the list a host can enquire about.
  `canBeBooked` was `canBeRequested` until phase two; the rule never moved,
  the name had simply started asserting the opposite of what the site does.
- `lib/serviceEnquiries.ts` — what an enquiry is, its states, and the words
  each side reads. No money anywhere in it, on purpose: every trade that
  reaches the flow is on the subscription, so there is no total, no
  commission and nothing to refund. A commission trade pointed at this file
  wants a booking instead.
- `lib/serviceEnquiryAlert.ts` — the four emails an enquiry produces. Accepting
  sends the host's details to the provider's REGISTERED address, never to
  whoever pressed the button in the email; that one line is what makes a
  forwarded reply link a nuisance rather than a way to harvest phone numbers.

## Launch blockers

Not a wish list. These stop the site working properly for real people, and each
one has been observed rather than imagined.

0. ~~The phase-two migrations have not been run on production.~~ **Done on
   28 August 2026.** All five applied to production in order, each dry-run
   first and read back after:

   | File | What it did |
   |---|---|
   | `20260828104048_service_enquiries` | created the table: 7 indexes, 4 policies |
   | `20260828111354_enquiry_emergency_and_dates` | `expires_at` NOT NULL, added the date and window columns |
   | `20260828113521_one_open_per_job` | reshaped the one-open index onto urgency and property |
   | `20260828123016_no_automatic_release` | dropped `released_at`, six statuses in the check |
   | `20260828124759_provider_sms_opt_out` | added `sms_opt_out` and its two column grants |

   The column list on production now hashes identically to test.

   `20260828145609_service_wanted` followed on the same day, along with the
   other session's `20260828143000_listing_pending_review`, which had merged
   without being run. **Nothing phase-two is outstanding on production.** The
   `service_enquiries` and `service_wanted` column lists both hash identically
   to test.

   **A correction worth keeping**, because this note had it wrong: this file
   used to say `scripts/migrate.mjs` refuses production and that these must be
   pasted by hand. That was true until 27 August 2026 and is not now — the rule
   was lifted deliberately, and production is reachable with `--target prod`
   against `SUPABASE_PROD_DB_URL`, which is a separate variable so a production
   string can never sit in a slot named TEST. A stale safety note is worse than
   none: it invites somebody to route around a guard that is not there, by hand,
   in an editor with no dry run and no destructive flag.

1. **Auth email needs its own SMTP. VERIFIED ON TEST; UNVERIFIED ON
   PRODUCTION.**

   Read this before acting on it. What follows about the built-in service is
   documented fact, and it is *observed* on the test project. Whether
   **production** is on the built-in service was never checked — it was
   inferred from test's behaviour and written here as though it applied to
   both. It may well already have custom SMTP: there is a note claiming Resend,
   port 465, sender `bookings@`. Nothing in this repo can confirm or refute
   that, because SMTP configuration is not exposed by any API reachable without
   a production access token.

   **How to settle it in a minute**, in the production project:
   - Authentication → SMTP Settings. Custom SMTP enabled, with a host, tells
     you outright.
   - Or look at the From address on any auth email production has ever sent.
     The built-in service sends from `noreply@mail.app.supabase.io`; custom
     SMTP sends from whatever sender is configured.
   - Or Authentication → Rate Limits. The email limit cannot be raised above
     the built-in 2/hour without custom SMTP, so a higher value is proof.

   DNS says only that Resend *can* send for the domain — `resend._domainkey`
   carries a DKIM key and `send.gallowaygetaways.co.uk` has an SES SPF record,
   which is Resend's standard setup. That is equally true whether or not
   Supabase Auth uses it, since app mail already goes through Resend, so it
   settles nothing on its own.

   **If production does have custom SMTP, this is a test-only problem** and far
   less urgent than the rest of this entry implies — though test still wants
   SMTP of its own before delivery can be tested there at all.

   What is not in doubt is the built-in service itself. Two things about it,
   both from Supabase's own documentation and both worse than "it is rate
   limited":

   - **Two emails an hour, project-wide.** Not per address — verified 27 Aug
     2026 by a brand-new address being refused `429
     over_email_send_rate_limit` on its first ever send while the allowance was
     spent. The limit cannot be raised without custom SMTP.
   - **It only delivers to pre-authorized team member addresses.** It is
     documented as being for exploration and testing, with no delivery or
     uptime guarantee. **A real customer's address never receives anything.**
     That matches everything seen on test: the only addresses that have ever
     received auth mail here are Liam's own.

   So this is not a throughput problem to tune later. On the built-in service a
   member of the public **cannot confirm an address or reset a password at
   all** — which is certainly true of test, and is the reason no address but
   Liam's own has ever received auth mail there. Whether it is true of
   production depends entirely on the check above.

   The fix is custom SMTP on the project (SendGrid, AWS SES, Resend — anything
   with credentials): Authentication settings → SMTP, needing host, port,
   username, password, sender address and sender name. Prefer a sender on
   `gallowaygetaways.co.uk`, which already sends app mail through Resend, so
   auth mail comes from the same domain people recognise.

   Configuring it also unlocks the rate limits: the default becomes 30 an hour,
   adjustable under Authentication → Rate Limits. Worth raising deliberately
   before any announcement rather than discovering it during one.

   App email is unaffected and always has been — it goes through Resend with
   its own allowance, which is why decline emails kept arriving on a night when
   no confirmation would send. That difference is what made mail look like it
   worked.

2. **Nothing automated had ever pressed the button.** Partly closed on 28 Aug
   2026: `npm run test:e2e` drives the real form in a real browser through
   Playwright and asserts both the panel the applicant reads and the row in the
   database. What it does NOT yet do is type through all five steps — it
   restores a draft and drives the finish step, which is where both shipped
   faults were. The trade picker has its own small test. Driving the coverage
   control and the earlier steps' own inputs is the next increment.

3. **An applicant whose confirmation email was refused cannot ask for another.**
   They have an account they cannot confirm and no control that offers a resend.
   Scoped but not built; the abuse surface is the reason it needs designing
   rather than adding.

## Before launch: nothing automated has ever pressed the button

A manual walk through the provider sign-up has now caught the same class of
fault twice, both times while the automated checks were green and correct about
what they tested:

1. **27 Aug 2026** — the confirmation link carried the wrong trade, so the draft
   was looked for under a key nothing had written, and the form opened on step
   two looking empty.
2. **27 Aug 2026, later** — a *successful* application put the applicant on step
   two with no confirmation, because clearing the restore banner released the
   rule that decides which step to open on. A sent application and a refused one
   ended on the same screen.

Both are the same shape: **the round trip ends somewhere the work is not, and
success is indistinguishable from failure.** Neither was a server fault, and
`scripts/journeys.mjs` was green through both — it posts to `/api/services/apply`
directly and never assembles a payload or presses a button.

The rule from the second one now lives in `lib/joinSteps.ts` as `openingStep`
and is unit-tested, so that specific fault cannot come back. The gap it came
from is still open: **no automated check drives the real form.**

Closing it needs a headless browser — Playwright as a devDependency, and the
browser download that comes with it. The test worth writing is small: plant a
draft in local storage, load `/services/join?trade=…`, tick the box, type a
password, press the button, and assert the confirmation panel appears and the
row exists. That is exactly the walk that found both faults.

**Do this before launch.** Until then, a manual walk is the only thing covering
the client half of the sign-up, and it should be repeated after any change to
`ProviderSignUp.tsx`.

## Auth email on test is rate limited, and it is not silent

The test project has no SMTP of its own, so auth email — sign-up confirmation,
password reset — goes through Supabase's built-in service, which allows a
handful an hour **for the whole project**. A day of testing exhausts it:

```
429 over_email_send_rate_limit   "email rate limit exceeded"
```

Two things follow, both observed on 27 Aug 2026:

- **Addresses on reserved TLDs are refused outright.** `@gallowayauto.test` and
  anything else under `.test` comes back as `Email address "..." is invalid`.
  The automation accounts therefore never receive mail, by design and not by
  accident — `scripts/journeys.mjs` does not depend on any arriving.
- **A failed send no longer costs the applicant anything.** `/api/services/apply`
  writes the row first and asks for the email afterwards, so the application is
  lodged whether or not the mail is accepted. The route reports
  `verificationEmailed` and the sign-up says which happened, rather than
  claiming a link is on its way regardless.

Every failure is written to `error_log` under
`service-apply-verification-email`, so "no email arrived" is answerable without
guessing:

```
select created_at, detail from error_log
 where label = 'service-apply-verification-email'
 order by created_at desc limit 10;
```

**Still open, and needed before launch:** an applicant whose confirmation email
was refused has an account they cannot confirm and no way to ask for another.
That wants a resend control on the sign-up, and it wants real SMTP configured on
production rather than the shared built-in service.

## Driving the real form

```
npm run test:e2e
```

Playwright, headless Chromium, pointed at the **preview** by default —
`playwright.config.ts` — because this signs somebody up, and an invented
tradesman belongs in the test project rather than the real queue. Override with
`PLAYWRIGHT_BASE_URL`, and think before pointing it anywhere backed by
production.

It cleans up after itself: the applicant and everything they own are removed
before and after each test, through `e2e/helpers.ts`, which refuses to run
unless `.env.local` names the test project.

**Two things about the locators**, because both cost time:

- The step counter (`Step 2 of 5`) is rendered twice — once for narrow screens
  carrying the number, once wider without — so matching its text finds a
  `sm:hidden` element on a desktop viewport and fails for a reason that has
  nothing to do with the application. Which step is on screen is told from the
  controls it has instead.
- **The form's inputs carry no `id`, `name` or `aria-label`**, so `getByLabel`
  finds nothing even though the labels are visible. Two have placeholders; the
  contact email and phone have neither and are found by layout — the first
  input below their label. Adding `aria-label`s would fix this properly and
  would help anybody using a screen reader more than it helps the test. Worth
  doing.


## CI: the two checks run on every push

`.github/workflows/checks.yml` runs `npm test` and `npm run build` on every
push and every pull request. Both were already the rule; neither ran unless
somebody remembered, and half the commits here arrive by pasting whole files
into GitHub's web editor, where there is no local build at all.

**Where to look.** On github.com, the **Actions** tab lists every run. Each
commit in the file list and on the commits page carries a tick, a cross or an
amber dot beside it — click that for the log. A failure also emails the
address on the GitHub account.

**What a red cross means.** The tests failed, or the build did. Open the run,
open the failed step, and read the last twenty lines; both tools name the file
and the line. A failing build does not break the live site — Vercel refuses to
promote a build that does not compile, so production simply stays on the
previous version. That is also why a red cross is easy to miss and worth
watching for.

**It holds no secrets on purpose.** The build needs the Supabase variables only
to prerender a handful of pages; without them those pages log an error and the
build still exits 0 — verified, 28 August 2026 — which is enough to catch the
type and syntax faults this is for. A job that never holds a key cannot leak
one. The real deploy build on Vercel has the variables and does the rest.

**It does not run the payment scripts, the journey checks or Playwright.**
Those need a database, Stripe and a deployed preview. They stay manual.

## The pre-push hook

`scripts/hooks/pre-push` runs `npm test` and `npm run build` before anything
leaves this machine, and refuses the push if either fails, naming the file and
the line. Install it once per clone:

```
git config core.hooksPath scripts/hooks
```

It lives in the repo rather than in `.git/hooks` so it survives a fresh clone
and so the reasoning is readable by whoever wonders what refused their push.
`git push --no-verify` skips it for a single push — for a work-in-progress
branch you want a Vercel preview of, never for master.

It deletes `.test-build` first, for the reason given above: compiled tests from
another branch survive a branch switch and a suite reporting more than it has
is invisible in a way a failure never is.

**It cannot cover the work done by pasting into GitHub's web editor**, which
never touches this machine. That path is covered by branch protection on
master instead. The two are halves of the same idea.

## The target guard is CommonJS, and has to be

`scripts/target.cjs` has two kinds of caller and they load modules differently.
The runners in that folder are ESM. **Playwright compiles
`playwright.config.ts` and `e2e/global-setup.ts` to CommonJS and `require`s
whatever they import**, and requiring an ESM file dies with:

```
ReferenceError: exports is not defined in ES module scope
```

That is not hypothetical. The guard was added on 28 August 2026 as
`target.mjs`, the config imported it, and **the entire e2e suite stopped being
able to start** — on master, on a clean checkout, for everybody. `npm test` and
`npm run build` were green throughout, because neither touches Playwright.

CommonJS is the one format both can load: Node's ESM imports a `.cjs` and picks
up its named exports, and Playwright's CJS requires it directly.

Two consequences worth knowing:

- **`TEST_PROJECT_REF` lives in `target.cjs`**, not in `seed-lib.mjs`. On Node 20
  a CommonJS file cannot require an ESM one, so the dependency runs that way
  round now. `seed-lib.mjs` and `e2e/helpers.ts` both re-export it rather than
  keeping their own copies, which they used to.
- **`e2e/helpers.ts` reads `.env.local` on first use, not on import.** It used
  to throw at module scope, which made the spec file unloadable without a local
  env file. The refusal still happens before any request.

`tests/e2e-suite-loads.test.ts` runs `playwright test --list` on every `npm
test`. It needs no browsers, network, database or `.env.local`, and it is the
only check in the repo that notices the suite cannot start.

**A trivial ESM import from the config will not reproduce this.** Playwright
only transpiles a file it thinks needs it, and the failure comes from that
transpile emitting `exports.foo = ...` into a file Node then loads as ESM. A
one-line `.mjs` imports perfectly well and the same import breaks once the file
grows — which is exactly how a false-negative mutation test was written while
proving the above.

---

## Opening guest experiences to guests — `GUEST_EXPERIENCES_OPEN`

Guest experiences ship closed. A guest cannot book one — no matter that a chef
is approved, connected and covering the cottage — until this is on. It is a
deliberate launch gate, held so the first bookable state arrives when the owner
says, not when a provider happens to finish onboarding.

**It is one environment variable and NOT a code deploy.**

```
GUEST_EXPERIENCES_OPEN = true      # open. Any other value, or absent, = closed.
```

Set it in Vercel (Production) and **redeploy** — an env var only binds to a new
deployment, so changing it in the dashboard does nothing until the next deploy
is promoted. That is the one catch: flip the variable, then trigger a redeploy.
(The Vercel dashboard does both from a phone.)

The value must be exactly the string `true`. `TRUE`, `1`, `yes` all read as
closed — see `tests/service-orders.test.ts`. This is on purpose: a fuzzy truthy
check is how a half-typed value opens a shop nobody meant to open.

What it gates, and what it does not:

- **Gated (the lock):** `app/api/services/order` refuses to create a booking,
  and `app/api/services/experiences` returns nothing bookable, while it is
  closed — so a direct API call is refused the same as a hidden button.
  `lib/serviceOrders.ts guestExperiencesOpen()` is the single reader.
- **Visible, but not usable:** the trip page shows a "coming soon" panel in
  place of the bookable cards, and the host's per-property panel says the same.
- **NOT gated (on purpose):** the provider side. A chef can sign up, be
  approved and connect Stripe while this is closed — that is how you get one
  ready before you open. The moment you flip it, any connected chef appears.
