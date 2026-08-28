# The write side of the database

What INSERT and UPDATE on 156 columns actually permits, asked of production
with the two keys an attacker really has.

Audited 28 August 2026, on branch `audit/write-side-grants`. Nothing is fixed
here and nothing is deployed — this is the report you asked for, and the order
of the fixes is yours to decide.

---

## ANYBODY WHO CAN RECEIVE EMAIL CAN MAKE THEMSELVES AN ADMIN OF THE LIVE SITE, RIGHT NOW, AND SET THE COMMISSION ON EVERY COTTAGE TO ZERO

This is the one that meets your capitals rule, and it was proven end to end
against production tonight, not reasoned about.

The chain is three steps and needs nothing but the anon key that is already in
the front-end bundle:

1. **Sign up.** `POST /auth/v1/signup` with the public key. No invitation, no
   approval, no admin involvement. Production accepted it.
2. **Confirm the address.** Supabase withholds the session until the emailed
   link is clicked. The attacker clicks it — it is their own mailbox. This is
   the only step that costs them anything and it costs them about ten seconds.
3. **Ask for the admin bit.** `PATCH /rest/v1/profiles?id=eq.<their own id>`
   with `{"is_admin": true}`. **It goes through.**

`is_admin` is then the whole of what stands between them and:

- `app/api/admin/commission/route.ts` — sets `commission_rate` on **any**
  listing, to anything from 0 to 100. Your cut of every booking on the site.
- `app/admin/payouts`, `app/admin/earnings`, `app/admin/disputes` — every
  figure about money on the platform.
- `app/api/admin/listings/decide/route.ts` — approve or decline any listing.
- `app/api/admin/providers/route.ts`, `app/api/admin/skills/route.ts`.

Those routes are not the weakness. They are written correctly — the commission
route uses `getUser()` rather than `getSession()`, with a comment explaining
exactly why, and re-checks `is_admin` on the server every time. The weakness is
that **`is_admin` is a column an ordinary user may write to on their own row.**

There are two real admins on production right now. There is no rate limit on
signup and no approval step, so that number is two by convention.

**Nothing was left behind.** The probe reverted `is_admin` to `false`
immediately, deleted every account it made, and production was re-checked
afterwards: zero canary rows, zero canary users, admin count back to 2.

---

## The short answer to each question you asked

| | stranger (anon key) | ordinary signed-in user |
|---|---|---|
| insert a booking | refused | **allowed — confirmed, paid, £0, in someone else's cottage** |
| insert a listing | refused | own only |
| insert a profile | refused | own only |
| update someone else's listing price | refused | refused |
| mark someone else's booking paid | refused | refused |
| alter someone else's `commission_rate` | refused | refused |
| set someone else's `payout_balance_owed` | refused | refused |
| flip someone else's `is_admin` | refused | refused |
| set someone else's `payout_amount` | refused | refused |
| change status on someone else's booking | refused | refused |
| **flip `is_admin` on their OWN profile** | refused | **ALLOWED** |
| **set `payout_balance_owed` on their OWN profile** | refused | **ALLOWED** |
| **write a review for a stay that wasn't theirs** | refused | **ALLOWED** |

A stranger with only the anon key is refused everything. That part is genuinely
sound, and it is sound because of RLS rather than because of the grants — every
write policy on these tables is written as `auth.uid() = something`, and
`auth.uid()` is null for the anon key, so every one of them is false.

**The grants are as wide as you thought, and wider.** `anon` and
`authenticated` both hold INSERT and UPDATE on every column of `bookings` (37),
`listings` (77), `profiles` (22) and `reviews` (20) — 156 columns, not 134;
`reviews` is the table that was not in your count. They also hold table-level
`DELETE`, `TRUNCATE`, `REFERENCES` and `TRIGGER` on all four. This is the
untouched Supabase default `grant all on all tables in schema public to anon,
authenticated`, never narrowed.

---

## The four findings, in the order I would fix them

### 1. `profiles.is_admin` is writable by its owner — PRIVILEGE ESCALATION

```
"Users can update own profile."   UPDATE   {public}   USING (auth.uid() = id)
```

No `WITH CHECK`, and — the actual problem — **no column list**. Postgres reads
a policy as "which rows", never "which columns"; the columns come from the
grant, and the grant is every column. So "users can update own profile" means
every one of the 22 columns, including `is_admin`.

The full chain is the capitals section above.

### 2. `profiles.payout_balance_owed` is writable by its owner — MONEY

Same policy, same reason. An ordinary user set their own `payout_balance_owed`
to 5000 on production tonight (reverted immediately).

Whether that turns into a payment depends on whether the payout run reads this
column as an instruction or recomputes it. I have **not** traced that, and I am
not going to guess at it in a report about money — but it is the column named
in `scripts/payout-scenarios.mjs` and in the host-payout cron, and a
self-assigned balance is worth an hour of somebody's attention before the next
payout run.

### 3. A signed-in user can insert a booking that is already confirmed and paid

`bookings` INSERT policy is `guest_id = auth.uid()` and nothing else. Every
other column is the attacker's to choose. Tonight's probe inserted, on
production, a booking against another host's listing with:

```
status: 'confirmed'   payment_status: 'paid'   total_price: 0
```

A free confirmed stay, in somebody else's cottage, with no Stripe session and
no money. Deleted again immediately.

Two things soften it and neither closes it. The exclusion constraint still
stops the dates clashing with a real confirmed booking, so this cannot be used
to double-book. And the row is visibly wrong to anyone looking. But it is a
free stay, and the host's calendar shows the nights as taken.

### 4. A signed-in user can review a stay that was never theirs

Three INSERT policies on `reviews`, and **permissive policies are OR'd**:

```
Guests can review after their completed stay   ... AND booking_id IN (their own confirmed, finished bookings)
Hosts can review guests after a completed stay ... AND booking_id IN (their own ...)
reviews - write own                            (auth.uid() = reviewer_id)          <-- defeats both
```

The third one grants everything the first two carefully restrict. The
`reviews_check_window` trigger still enforces the calendar — the booking must
exist, the stay must have finished, and it must be within 14 days — but **it
never checks the reviewer was on the booking.** So any signed-in account can
one-star any stay that ended in the last fortnight, on any listing.

There is a second edge to this. `publish_paired_reviews` fires on insert and
publishes both sides as soon as a counterpart exists, so an attacker inserting
the opposite `review_type` on a booking can force a genuine review out of its
blind window early.

---

## Two things that are not findings, recorded so nobody has to re-derive them

**`TRUNCATE` is granted to `anon` on all four tables.** TRUNCATE bypasses RLS
entirely. It is not reachable through PostgREST, which speaks only
SELECT/INSERT/UPDATE/DELETE, and I found no anon-executable function that runs
dynamic SQL — so there is no route to it today. It is a grant that should not
exist rather than a hole. `DELETE` is granted too, but the only DELETE policy
on any of the four is "delete your own unpublished review", so RLS holds.

**Four SECURITY DEFINER functions are executable by `anon`:**
`expire_unpaid_bookings`, `publish_expired_reviews`, `publish_paired_reviews`,
`refresh_listing_ratings`. A stranger can call the first two — confirmed, HTTP
204 — but both carry their own time guard in the function body (one hour;
`check_out + 14`), so calling one does only what the scheduled job already
does. Worth taking the grant away on principle; not urgent.

---

## How to re-run it

```bash
node scripts/write-side-rls.mjs --target prod
```

Nothing real is ever the target. The script plants its own victim — a host, a
draft listing, a finished booking, a profile with £4242.42 on it — points every
probe at those, and removes them afterwards. A probe that gets through has
vandalised a fake cottage. Anything it does manage to change is put back
immediately and reported as a failure. `--keep` leaves the canary in place.

### The two false passes it printed before it was believed

Worth writing down, because both are the shape this repo keeps finding.

**Run one: 21 refused, 0 findings.** Every signed-in probe came back
`401 Invalid API key`. Supabase wants the *project* key in `apikey` and the
*user* in `Authorization`; I had put the user's JWT in both. The gateway was
turning the requests away before RLS was ever consulted, and a 401 reads
exactly like a refusal.

**Run two: still nothing on `profiles`.** `Prefer: return=representation` makes
PostgREST read the row back after writing it, so the write needs SELECT too —
and `20260828234003` revoked table-level SELECT on `profiles` last night. The
result was `42501 permission denied for table profiles`: the *read* grant
refusing, credited to the write policy.

So the script now opens by proving both keys work — the anon key reads a
published listing, the signed-in token writes its own `full_name` — and stops
dead if either cannot. And no verdict comes from the response any more: every
one is decided by reading the value back with the service role.

---

# 2. The guard checks

## `app/api/stripe/checkout/route.ts`

Added to `tsconfig.test.json`. It was not there, so the suite could not see the
file at all — the last thing between a guest and a charge, invisible to the
tests. Covered in `tests/checkout-refusals.test.ts`, 23 new tests.

**`totalsMatch` first, as you said.** It had no test anywhere. Five now, and
the ones that matter are the boundary (under half a penny is the same price,
over it is not), symmetry, and that `Number(null)` — what a null `total_price`
column arrives as — is a mismatch rather than agreement.

Then the route's refusals. It guards nine things, not five:

| refusal | status |
|---|---|
| price no longer matches | 409, and corrects the stored total |
| a night blocked on the calendar | 409 |
| a night blocked by an iCal feed | 409 |
| more guests than the listing allows | 400 |
| overlapping pending/confirmed booking | 409 |
| earlier guest holding the dates | 409 |
| not signed in | 401 |
| not your booking | 403 |
| already paid | 400 |
| dates that are not a stay | 400 |

Every one asserts `stripeCalls.length === 0` as well as the status. The status
is what the guest sees; the empty array is the thing that actually matters.

**Watched failing, with `scripts/mutate.sh`.** Each guard broken on purpose,
suite re-run:

```
price mismatch guard removed                 caught by 2
over-capacity guard removed                  caught by 2
blocked-dates guard removed                  caught by 2
overlap guard removed                        caught by 1
hold guard removed                           caught by 1
ownership guard removed                      caught by 1
already-paid guard removed                   caught by 1
signed-in guard removed                      caught by 1
valid-stay guard removed                     caught by 1
totalsMatch tolerance widened to a fiver     caught by 3
totalsMatch always agrees                    caught by 5
children no longer counted towards capacity  caught by 2
```

Nothing survived. The last three weaken rather than remove, which is the harder
failure to notice — a guard still standing there and no longer meaning
anything.

There are also three tests asserting the **permissive** side: a feed blocking
the checkout morning must *not* stop the charge (half-open dates, changeover
day), pets are not guests, and a listing with no `max_guests` refuses nobody.
Those failures turn paying guests away, which nobody reports as a bug.

## The two database constraints

`scripts/constraint-refusals.mjs`, 12 checks, all passing.

```
✓ an overlapping confirmed stay is refused        23P01
✓ a stay wholly inside another is refused         23P01
✓ publishing with a blank title is refused        23514
✓ publishing at a price of zero is refused        23514
```

With the service role, deliberately: a constraint the service role could step
over would not be a constraint. It asserts on the **SQLSTATE**, not the
message, so a Postgres upgrade rewording its prose cannot fail the suite.

Negative controls, because a constraint that refused everything would pass a
script that only ever asserts refusal:

```
✓ a stay starting the morning the last one ends is allowed   (changeover day)
✓ an overlapping PENDING stay is allowed                     (confirmed-only, on purpose)
✓ the same nights on another cottage are allowed             (the rule is per listing)
✓ a DRAFT with a blank title is allowed                      (Save & finish later)
✓ a complete listing publishes normally
```

It runs against test, because it inserts rows. That would normally prove
nothing about production — but **a constraint is not a grant**: it is in
`pg_constraint` or it is not, and that can be asked of production without
writing to it. The last two checks do exactly that, through the read-only path
in `migrate.mjs`. Both constraints are present on production. Behaviour proven
on test, presence proven on production, neither half assumed.

### One thing I could not do

**The constraints were not dropped and re-added on test.** That is the real way
to watch them fail, and applying a migration was blocked by the permission
classifier in this session — correctly, I think, given your "no migration
applied to production" rule and that it cannot easily tell the two projects
apart. I did not work around it.

What I did instead is `--prove-detector`:

```bash
node scripts/constraint-refusals.mjs --prove-detector
```

It points the two "must be refused" probes at rows that are perfectly legal — a
stay that does not overlap, a title that is not blank. Same insert path, same
parsing, same SQLSTATE comparison, same reporting; only the row changes. It
reports **exactly two failures**, the right two. That proves the detector can
tell a refusal from an acceptance. It does not prove the constraint is what is
doing the refusing.

If you want the last mile, this is the pair to run yourself on test:

```bash
node scripts/migrate.mjs <drop-constraint.sql> --apply && node scripts/constraint-refusals.mjs
```

Expect it to fail, then re-add and expect it to pass.

---

# 3. The proxy-assertion sweep

Tests that name one member of a set the rule covers. **Listed only — nothing
changed.**

The good news first: this repo is mostly *not* doing this. `join-steps`,
`service-providers`, `service-pricing` and `cleaning-hourly` loop over `TRADES`
or `HOST_TRADES` in the places that matter, and several carry a comment saying
why. `cleaning-hourly` even loops the negative case — "no other trade is
offered it" — which is the version most people skip.

### Genuine instances

**`tests/service-registration.test.ts:191` — "a joiner is never blocked"**
```js
assert.deepEqual(registrationBlockers({ trade: 'joiner' }, []), []);
```
The rule is "a trade with no scheme requirement is never blocked", which covers
roughly twelve trades. Only `joiner` is named, and nothing else in the file
checks the unblocked case. Delete the roofer's exemption and this stays green.

**`tests/service-provider-decision.test.ts:810` — "a non-cleaning provider is unaffected by any of it"**
```js
const { route, updates } = load({ trade: 'plumber', kind: 'in_house' });
```
"Non-cleaning" is thirteen trades. One is named. This is the clearest example
of the shape in the repo — the test name states the general rule outright.

**`tests/service-provider-decision.test.ts:604` — "approving a commission trade starts no clock at all"**
Commission trades are six: `sponge`, `bin` and the four guest trades. Only
`sponge` is named. The test immediately below it *does* loop all six — but only
for `plan`, not for the `trial_ends_at` and `commission_rate` assertions, which
are the ones about money.

**`tests/service-pricing.test.ts:388` — "a quote-per-job trade needs no prices at all"**
```js
assert.deepEqual(pricingProblems({ trade: 'cake' }), []);
```
Covers the four guest trades; only `cake` named. Mild — the test above it loops
`roofer`, `joiner`, `painter`, so the host half is properly covered and the gap
is `chef`, `basket`, `paw`.

**`tests/service-extras.test.ts:105` — "the gate is worked out from the prices, never stored"**
`groupIsOffered` is a general rule about any group with a gate; the test drives
`laundry` with `sponge` only.

### Named-example-only — no gap, listed so you can see I checked

- `tests/join-steps.test.ts:57` "a plumber sees all five" — the loop at line 105
  covers all six maintenance trades. Fine.
- `tests/cleaning-hourly.test.ts:46` "every cleaner is offered the choice" —
  "every cleaner" means every *kind*, and both kinds are asserted. Fine.

### The same shape, outside the trade vocabulary

Two more worth your eye, because they are proxy assertions in the guards
themselves:

**`tests/runner-targets.test.ts:88`** decides whether a script "talks to the
site" by testing whether the file contains the string `/api/`. It flagged
`scripts/write-side-rls.mjs`, which talks only to Supabase — the match was a
route path quoted in a *comment*. A string is standing in for a behaviour. I
reworded my comment rather than touch the guard, but the next honest script
that mentions a route path in prose will hit the same thing.

**`scripts/data-privacy-rls.mjs` accepts `--target prod` and then reads
`.env.local`**, which points at the *test* project. The flag skips the safety
check and changes nothing else, so **that script has never actually run against
production** despite the flag existing and the header documenting it. Its
findings are true of test. Given that the whole reason for tonight's work is
that test and production have diverged on grants, this one is worth a look.
`scripts/write-side-rls.mjs` loads the env file that belongs to the target and
then verifies the URL really is that project, so the flag cannot lie.

---

## What is on the branch

```
audit/write-side-grants

scripts/write-side-rls.mjs          new   the production write probe
scripts/constraint-refusals.mjs     new   the two constraints, both sides
tests/checkout-refusals.test.ts     new   totalsMatch + 9 route refusals
tsconfig.test.json                  +1    the checkout route
SECURITY-WRITE-AUDIT.md             new   this
```

Suite: **749 passing, 0 failing.** Not merged, not deployed, no migration
applied anywhere. Production carries no canary rows and no audit accounts —
checked after the last run.
