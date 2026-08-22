# Looking after Galloway Getaways

Notes for whoever is doing the maintenance — including Claude Code.

## What this is

A booking site for self-catering properties in Dumfries and Galloway. Guests
book and pay through the site; the platform takes a commission and passes the
rest to the property owner. Real money moves through it, so mistakes here cost
somebody something.

## Which database am I on?

There are two Supabase projects and three ways to end up on the wrong one.

| | project ref |
|---|---|
| Production | `hviwjxigqivjfhmhpjiy` |
| Test | `yefoqcabuijcowoqewtc` |

- **Vercel Preview deployments read the test project. Production reads
  production.** The three Supabase variables are split per environment; the
  Stripe keys, `CRON_SECRET` and `RESEND_API_KEY` are still shared.
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
- **run the build before proposing anything.** TypeScript has caught real bugs
  here, not just style issues.
- **say when you are unsure.** A flagged uncertainty is far cheaper than a
  confident wrong fix to a payment route.
- **do not enter credentials into forms or CLI fields.** Keys, tokens and
  passwords are the owner's step, even when he has supplied the value.

## Things that bite

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
  Production had to be done in the Supabase SQL editor: there is no production
  database password on the MacBook, only the test one, so a terminal here can
  reach test and not production.

  **Photos are deliberately not in it**, even though the wizard requires one.
  Every seed listing in the test project is created with an empty `images`
  array, so a photo condition would have refused to apply to test at all and
  would have broken the payment suite's reseed. Photos are a rule the forms
  enforce and the database does not. Worth knowing before anyone "completes"
  this constraint and wonders why the seed scripts stop working.

- **Running a migration by hand needs a direct Postgres connection**, and there
  is no `psql` on this machine. Colima is, so:

  ```
  docker run --rm -i postgres:16-alpine psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f - < supabase/migrations/<file>.sql
  ```

  Do **not** use `supabase db push` — the CLI is linked to production, see
  above.

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
- **Idempotency keys must not include anything resettable.** One included an
  attempt counter, a test reset it, and Stripe took a second payment.

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

They can be triggered by hand from Vercel → Cron Jobs → Run.

Note `CRON_SECRET` is still shared between Preview and Production, so a
preview deployment's cron routes are the live ones. Split it before live mode.

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
