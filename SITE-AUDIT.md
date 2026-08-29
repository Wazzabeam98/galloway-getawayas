# Site audit — 29 August 2026

Branch: `audit/seo-and-site-audit`. Nothing merged, nothing deployed, no database
changes. Tests pass (729) and the build is green.

Everything below was measured against a real running copy of the site on this
machine, pointed at the test Supabase project, crawled signed out and signed in
as an ordinary guest account. Where I say "measured", there is a number and I
took it. Where I am guessing, I say so.

---

## The short version

**Three things were quietly broken and are now fixed.**

1. Your sitemap only updated when you deployed. A property published on a
   Tuesday stayed invisible to Google until some unrelated deploy happened to
   rebuild the file. The file looked perfect the whole time — it was just old.
2. Every "page not found" on the site answered **200 OK** instead of 404. Dead
   listing links, made-up addresses, all of it. Google reads that as "this page
   is fine, index it".
3. `robots.txt` had one line, `Disallow: /services`, that was hiding your entire
   public tradesman directory from Google — fifteen pages.

**One thing I want you to look at and possibly disagree with.** Fixing (2)
meant deleting `app/loading.tsx`, the full-screen "Finding your perfect
getaway…" splash. It still exists on the signed-in pages. Public pages no
longer show it. See "The change you might not want" below — it is one command
to undo.

**The biggest thing I did not fix, because it is your writing, not my code:**
your home page has about twenty words of body text on it. Google cannot rank a
page for "holiday cottages in Dumfries and Galloway" when the page barely says
those words outside the title. Everything else in this document is worth less
than fixing that.

**And yes — I agree about the area landing pages.** Strongly. Details in the
last section, including which towns and what each page needs to say.

---

# 1. The crawl

I walked every route in `app/`, signed out and signed in as an ordinary guest
(no listings, not an admin), and checked each one for: does it answer, does it
error, does it show something a stranger shouldn't see, and does it break at
375px.

### Nothing leaks

I checked this carefully because it is the one that matters. Signed out:

| Route | What a stranger gets |
|---|---|
| `/admin`, `/admin/*` (all 9) | The "page not found" page. It does not even admit an admin area exists. Correct. |
| `/account` | "Sign in to view your account" |
| `/trips`, `/messages`, `/edit-listing/<id>` | "Sign in to…" with a log-in box |
| `/dashboard/*` (all 7) | 307 redirect to the home page |
| `/passport` | Redirects to the home page |
| `/review/<id>` | "Sign in to leave your review" |
| `/e/<bad token>` | "That link has expired" |
| `/homes/<draft or pending listing>` | "This listing isn't published yet" |

Signed in as an ordinary guest with no properties, I could reach every
`/dashboard/*` page — but every one of them showed **my own empty data**:
"No listings yet", "0 bookings", "£0.00 earnings". No other host's information
appeared anywhere. The admin pages still returned "not found". That is correct
behaviour, not a hole: the dashboard is where you go to become a host.

The admin guard is fail-closed everywhere — `if (!profile || is_admin !== true)
notFound()`. If the database call fails it denies rather than allows. Good.

### Nothing 500s, nothing renders empty

Every route answered. The only empty-looking pages were slow first compiles in
the dev server, which went away once warm.

### 375px

I checked every public page for content spilling off the side of a phone
screen. **Zero horizontal overflow anywhere.** The mobile work on this site is
genuinely good — the hero search collapses properly, the listing page stacks
cleanly, the long legal pages read fine. I have nothing to report here, which
is unusual.

### What the crawl found that was wrong

Covered in section 3. In short: soft 404s, a duplicated title, missing titles
on four public pages, two `h1`s on every listing page.

---

# 2. The failure shapes you asked me to hunt

## 2a. The one I would fix first: the Stripe webhook swallows everything

`app/api/stripe/webhook/route.ts:511`

```js
} catch (err: any) {
    console.error('[stripe/webhook] handler failed:', event.type, err && err.message);
    // Still return 200 — the event is logged, and reporting a failure
    // just makes Stripe retry a broken handler forever.
}
return NextResponse.json({ ok: true });
```

The reasoning in that comment is right. Returning an error would make Stripe
retry a broken handler forever, and that is worse. **The problem is the word
"logged".** It goes to `console.error`, which on Vercel means a log line nobody
reads. It does **not** go to `logError()`, so it never reaches `/admin/errors`
and never reaches the error digest email.

What that means in practice: a guest pays, Stripe takes the money, this handler
throws while writing the booking, Stripe is told "fine", and **nothing anywhere
tells you.** The booking sits unconfirmed. The guest emails you a week later.

This file already imports `logError` and uses it five times for disputes. The
fix is one line in the catch block:

```js
await logError('[stripe/webhook] handler failed on ' + event.type, err, {
    path: 'stripe/webhook',
});
```

Still return 200. Still don't make Stripe retry. But you find out.

I did not make this change because it is money-path code and your house rules
say a human reads that diff before it merges. It is one line and I would merge
it tomorrow.

The same file has a second, smaller one at line 217: it fails to read the
payment intent, logs to console, and carries on. That one is genuinely fine —
the comment explains the guest has already paid and only the automatic balance
charge needs the data. But the host never learns that this booking's balance
will need chasing by hand.

## 2b. `sendEmail` — the count is now 15 of 20, not 17 of 20

`lib/email.ts:172` returns `true`/`false` and never throws. Twenty call sites.
**Five now check the answer** — `admin/providers`, `admin/listings/decide`,
`cron/review-reminders`, `cron/needs-reply`, and `lib/serviceEnquiryAlert`. So
this has been getting better.

**Fifteen still throw the answer away.** These are the ones that matter:

| Where | What silently doesn't happen |
|---|---|
| `cron/balance-charges:180, 201, 413, 482` | The guest is never told their card failed — this is the 72/48/24-hour ladder. It runs, the email vanishes, and the booking gets cancelled by a guest who was never warned. |
| `cron/host-payouts:247` | The host is never told they've been paid. |
| `stripe/webhook:369` | The booking confirmation email. |
| `bookings/host-refund:138` | The guest is never told about their refund. |
| `listing-access:125, 233` and `accept:79` | Co-host invitations that were never received. |
| `booking-guests:120`, `cron/ical-sync:114`, `notify` ×3 | Notifications. |

**The efficient fix is not to change fifteen call sites.** It is to change
`sendEmail` itself, so that every failure reports once, from one place:

```js
if (!res.ok) {
    const detail = await res.text();
    console.error('[email] Resend rejected the message:', res.status, detail);
    await logError('[email] Resend rejected a message to ' + to, {
        status: res.status, subject, detail,
    }, { path: 'lib/email' });
    return false;
}
```

Same in the `catch` and in the two early-return guards (`!key`, `!to`). Keep
returning `false` — nothing about the calling code changes, no booking breaks.
But an email that didn't send shows up on `/admin/errors` instead of nowhere.

That single change covers all fifteen. It touches money-path notifications, so
same argument as above: it needs your eyes, not mine, at 3am.

## 2c. The sitemap's swallowed error — fixed

`app/sitemap.ts` had this:

```js
const { data: listings } = await supabase.from('listings')...
// ... catch (err) { console.error(...); return staticPages; }
```

**`supabase-js` does not throw on a failed query.** It hands the error back in
the result object. So the `catch` could never fire for the thing most likely to
go wrong. A failed query meant `listings` was `null`, `(listings || [])` was
`[]`, and a sitemap containing **none of your properties** was served as if it
were correct — no error, no warning, valid XML. Google reads that as "those
pages are gone."

This is the exact shape you described. Fixed: the error is now checked and
reported to `/admin/errors`.

## 2d. Thirty-one API routes never report to the error monitor

You built `/admin/errors` and an export endpoint, and then 31 of 62 API routes
never write to it. They all `console.error` and return a sensible message —
which is fine for the user and invisible to you.

The ones I would wire up first, because a silent failure there costs money or
trust:

- `app/api/notify/route.ts` — every notification on the site funnels through
  this, and its catch returns `{ok:false}` with **status 200**, so the caller
  can't tell either. Two layers of silence.
- `app/api/listings/save/route.ts` — a host's edit failing to save.
- `app/api/stripe/balance-checkout/route.ts` and `stripe/connect` — payment
  and payout setup.
- `app/api/listing-access/*` — co-host invitations.
- `app/api/errors/report/route.ts` — the error reporter's own failures are
  swallowed, which means the monitoring can be broken invisibly.

`lib/adminAudit.ts:69` is worth a separate mention: when the audit trail fails
to record an admin action, it logs to console and carries on. For actions that
move money, an audit record that silently doesn't exist is worse than one that
loudly fails.

## 2e. A guard whose success path proves nothing

`app/homes/[id]/page.tsx:347`, the reviews query on the public listing page:

```js
const { data: reviews } = await supabase.from('reviews').select('*')
```

You have a test — `tests/no-star-select-on-listings.test.ts` — that fails the
build if a `select('*')` on **`listings`** reaches a stranger. The reasoning in
that file is excellent. It applies word for word to `reviews`, which is read on
the same page, by the same strangers, and is not covered.

`reviews` holds `reviewer_id`, `reviewee_id` and `booking_id` — internal ids
that tie a named person to a specific stay. A star select puts every column
into the page source, including any column added later.

I could not confirm what actually reaches the page today: there are no reviews
in the test database, and the `reviews` table is not in `supabase/migrations`
at all — it predates the migration files, so its real column list isn't in
version control. That is itself worth knowing.

Two things worth doing, neither of which I did because both touch the database
and you said no database changes:

1. Name the columns in that select, the way `listings` now does.
2. Extend the existing test to cover `reviews` as well as `listings`. The test
   is already written; it needs a second table in its list.

## 2f. Rules living somewhere untestable

**The admin check is copied out nine times.** `app/admin/page.tsx` has a proper
`requireOwner()` function. The other eight admin pages each reimplement the same
fifteen lines inline. Every copy is correct today. Nothing makes the tenth copy
correct.

The fix follows the pattern you already have: put `requireAdmin()` in
`lib/access.ts` next to `checkListing()`, and add a test in the style of
`no-star-select-on-listings.test.ts` that reads every `app/admin/**/page.tsx`
and fails the build if one doesn't call it. That turns "we remembered" into
"the build won't let us forget".

**Tailwind's scan paths — fixed, preventatively.** `tailwind.config.js` only
scanned `pages/`, `components/`, `app/` and `src/`. A class name written in
`lib/` or `config/` would generate no CSS and no error — the element just
renders unstyled. There are no Tailwind classes in `lib/` today; I checked.
I added `lib/` and `config/` to the scan list anyway, because nothing stops the
next shared helper from returning one. This site has already lost a hero
gradient to exactly this failure mode (see the comment in `Hero.tsx` about
`from-stone-950/45`).

**Conditions buried in pages.** `app/page.tsx` decides what counts as a valid
search — the date regex, `from < to`, what `searching` means, how a town slug
is matched against a listing's address. That is real logic, on your highest
value page, with no test. `whereLabel()` and the availability filtering would
sit naturally in `lib/` next to `townKey()`, which is already there and already
tested.

---

# 3. SEO — what was wrong and what I changed

## Fixed

**The sitemap never updated between deploys.** This is the big one.
`app/sitemap.ts` had `export const dynamic = 'force-dynamic'` at the top and a
comment saying it was therefore generated per request. **It was not.** Next
13.5 prerenders the metadata sitemap file at build time and ignores that
setting — `next build` listed it as `○ (Static)` and wrote a finished
`sitemap.xml.body` to disk. I tried adding `revalidate = 0` as well; it changed
nothing.

I moved it to `app/sitemap.xml/route.ts`, a route handler, which does honour
`force-dynamic`. The build now shows `λ /sitemap.xml`. A listing published now
is in the sitemap on the next request, cached five minutes at the CDN so a
crawl storm doesn't become a query storm.

**Every 404 answered 200.** `app/loading.tsx` at the root wrapped every page in
a Suspense boundary. That makes Next flush the HTML shell — and with it a 200
status — *before* the page has finished deciding whether it exists. A
`notFound()` after that point renders the not-found page under a 200.

I proved it rather than assuming it: with the root loading file in place,
`/homes/<missing-id>` answered **200**. With it removed, the same URL answered
**404** and nothing else changed.

**`robots.txt` was hiding your tradesman directory.** These are prefix rules.
`Disallow: /services` blocked `/services` and all fourteen `/services/<trade>`
pages, which are public shop fronts anyone can read. Now only the sign-up
funnel (`/services/join`, `/services/enquiry`) is disallowed.

I also added the pages that were crawlable and shouldn't be: `/passport`,
`/booking-confirmed`, `/review/`, `/invite/`, `/trip-invite/`, `/e/`,
`/unsubscribe`, `/admin`. The token pages are unguessable rather than
protected, so nothing stopped a crawler that had seen one — usually because
the address was pasted somewhere — from indexing it.

**Every listing page had two `h1`s.** The property's name at the top, and
"About this place" further down. Two `h1`s tells Google the page is about two
things and it picks whichever it likes. "About this place" is now an `h2`.
Heading order on a listing page is now clean: `h1` property name → `h2` "Entire
place in Wigtown…" → `h2` About this place / Where you'll be / Reviews → `h3`
footer sections.

**Unpublished and hidden listings were indexable.** A hidden listing is
deliberately off the home page and out of the sitemap, but it still opens at
its own URL — which is exactly what Google finds and indexes anyway unless
told not to. `generateMetadata` now emits `noindex` for anything whose status
isn't `published`, so the page and the sitemap agree about what is public.

**A listing that doesn't exist now returns a real 404** rather than a 200 with
"This listing couldn't be found" on it.

**`/services/<anything>` was an unlimited soft-404 machine.** `tradeLabel()`
falls back to the word "Service", so `/services/cleaner` (not a real key — the
key is `sponge`) and `/services/literally-anything` both rendered a real-looking
page with a 200. The trade keys are a closed list, so the page now says no to
anything not on it: unknown trades 404.

**Every trade page shared the home page's title and description.** All fourteen.
Now each has its own — "Plumber for holiday lets in Dumfries & Galloway" — plus
a canonical URL. The page is a client component and can't export metadata, so
this lives in a new `app/services/[trade]/layout.tsx`.

**`/business` said "Galloway Getaways" twice in the tab.** The root layout
appends it automatically. This exact fix was made on `/services` and has a
comment explaining it; `/business` never got it — the sort of thing a
whole-file paste carries along.

**`/addhome` and `/services/join` had the home page's title** on every browser
tab and every shared link. Both are client components, so I gave each a
`layout.tsx` with proper metadata and an explicit `noindex` that matches
`robots.txt`. (`robots.txt` stops a page being *crawled*; only the meta tag
stops it being *indexed* from a link somewhere else. They should always agree.)

**Canonicals** added to `/business` and `/services`. Every public page now has
one: home and listings already did, and the legal pages already did.

**One missing alt** on the provider logo on trade pages — now the business name.

## Checked and correct — no change needed

**JSON-LD.** Two blocks: `LodgingBusiness` from the root layout, `VacationRental`
per listing. Both valid. The listing block carries name, description, images,
address, approximate geo, room count, occupancy, amenities and a GBP offer.

**The `aggregateRating` gating holds.** It is emitted only when
`hasPublicScore(reviewCount)` is true, which needs `MIN_PUBLIC_REVIEWS` (3).
Below that there is no `aggregateRating` key at all — not a zero, not an empty
object. That is exactly right, and it is the thing Google penalises sites for
getting wrong.

One inconsistency worth knowing about, though not a rich-result failure:
`ratingValue` comes from `home.rating_avg` (a database trigger, counting **all**
reviews) while `reviewCount` comes from `reviews.length` (counting only
**published** ones). If a review is ever unpublished the two disagree. The home
page cards use a third source, `rating_count`. Three counts for one number.
Worth picking one.

**Open Graph and Twitter cards.** Both set at the root and overridden
per-listing with the property's own photo, title and price. A shared listing
link will look right. Untestable from here — worth pasting one into WhatsApp
after you deploy.

**Alt text.** 30 images across the site. **None missing.** Ten have `alt=""`,
and eight of those are correctly decorative or on signed-in pages.

**`metadataBase`** is set, so the www and vercel.app copies of the site won't
compete with the real one.

## Not fixed — needs a decision from you

**The home page `h1` is "Galloway Getaways".** Your single most valuable
heading, on your single most valuable page, is a brand name that nobody
searches for. It should say what the site is. I did not change it because it is
the visible headline of your hero photo and that is a design decision, not a
bug. The `<title>` and description are already good; the `h1` is out of step
with them.

**Four pages still have no `h1`:** `/services/join`, `/services/join/apply`,
`/auth/reset`, `/unsubscribe`. All are noindexed now, so this is accessibility
rather than SEO. Low priority.

**The four hero photos have `alt=""`.** Defensible — they are decorative
background. But these are your best images of the area, and Google Images is a
real channel for "Kirkcudbright harbour" style searches. Giving them real alt
text costs nothing. I did not write it because I don't know what each photo
shows and I'm not inventing it. Tell me what hero-1 to hero-4 are and it's a
five-minute change.

**Internal linking is thin.** The home page links to every listing. The footer
links to the legal pages. And that is the whole link graph. A listing page
links to **nothing** — no other properties, no area, no way back except the
logo. Every listing is a dead end. This is what the area pages fix; see
section 5.

**`lastmod` in the sitemap is `approved_at`, falling back to `created_at`.**
There is no `updated_at` column on `listings`. So an edited listing keeps
telling Google it hasn't changed since the day it was approved. Adding
`updated_at` with a trigger is a migration, which you said not to make. It is
worth making.

---

# 4. Performance

All numbers below are from the **production build** (`next build` + `next
start`) on this machine, against the test Supabase project in eu-west-2. Vercel
will differ, but the shape holds.

### Time to first byte, signed out

| Page | TTFB (median of 5) |
|---|---|
| `/contact`, `/terms` | **12 ms** |
| `/` (home) | **55 ms** |
| `/homes/<id>` | **225 ms** |

Signed in, the same pages cost **225 ms** and **280 ms**. The difference is the
navbar: for a signed-in visitor it runs four Supabase queries on **every page** —
session, profile, "do you have any listings", "have you completed a stay".

### What blocks the largest paint

**Home page.** The LCP element is the hero photo. `priority` and `placeholder="blur"`
are both set correctly and Next emits a preload link — that part is done right.
WebP is being served. The weights:

| Screen | Hero photo delivered |
|---|---|
| Phone (375px) | **41 KB** — fine |
| Laptop (1920px) | **217 KB** |
| Retina laptop (3840px) | **544 KB** |

Everything else on the page is small: 17 KB HTML, 17 KB CSS, ~110 KB JS, all
gzipped. So on a phone the home page is genuinely quick. On a retina desktop,
**a single 544 KB image is your LCP** and it is roughly three quarters of the
page weight.

The lever is `images.deviceSizes` in `next.config.js`. Dropping `3840` caps the
hero at 2048px — 325 KB instead of 544 KB — and on a photo used as a
full-bleed background behind text, nobody will see the difference. There is
already a comment in `Hero.tsx` working around this by hand for hero-3 by
pre-resizing the source file; a config change would make that unnecessary.

Second lever: the whole `react-date-range` picker and `date-fns` ship in the
hero's client bundle for every visitor, and most never open it. Lazy-loading it
on first interaction saves roughly 25–30 KB gzipped of the initial JS.

**Listing page.** 225 ms of server time before a single byte moves, and the LCP
is the first gallery photo, which cannot start downloading until that 225 ms is
over. The page does five sequential round trips: the listing, the host profile,
the host's payout flag (a second query through the service role), the reviews,
and the reviewer names. Several of them don't depend on each other and could run
in parallel with `Promise.all`, which would take a meaningful bite out of that
225 ms.

There is also a **live call out to `nominatim.openstreetmap.org`** in the render
path for any listing without stored coordinates. It is cached for 30 days, but
the first visitor after a cache miss waits for a third-party server, and if
OpenStreetMap is slow that visitor waits with it.

### The `force-dynamic` question — the answer is not what you'd expect

I tested this rather than guessing.

**Removing `export const dynamic = 'force-dynamic'` from the root layout changes
nothing at all.** I removed it and rebuilt: every page was still dynamic. Not
one became static.

The reason is `components/base/Navbar.tsx`. It calls `cookies()`, it is in the
root layout, and **any page that reads cookies is dynamic by definition** —
Next cannot cache a page whose HTML depends on who is asking. The `force-dynamic`
line is describing a decision the navbar had already made.

I proved it: I temporarily replaced the navbar with a static one and rebuilt.
Five pages went static immediately — `/contact`, `/terms`, `/privacy`,
`/cancellation-policy`, `/business`. Restored afterwards; nothing shipped.

**So: what would it actually take?**

The work is not "delete a line". It is **getting the signed-in part of the
navbar out of the server-rendered layout**, in this order:

1. **Split the navbar.** A static shell — logo, "Become a host", the menu
   button — rendered on the server with no cookie read. Plus a small client
   component that fetches the session in the browser and fills in "Welcome,
   Liam", the avatar and the host/travel switch. This is the whole job; steps
   2–4 are consequences of it.

2. **The five content pages then become genuinely static**, built once and
   served from the CDN with no origin hit. 12 ms becomes 0 ms. Small win in
   absolute terms, but it is free after step 1.

3. **The home page becomes cacheable** with `export const revalidate = 300`,
   *provided* the two per-user server components on it — `UpcomingTrip` and
   `HostReservations` — also become client islands. Then a signed-out visitor
   gets a fully cached home page. A search with query parameters stays dynamic,
   which is correct.

4. **The listing page becomes cacheable** the same way. This is the one worth
   the most: it drops 225 ms of server time to nothing for the majority of
   visitors, and it is the page you want to rank. It needs `revalidatePath('/homes/' + id)`
   called wherever a listing is saved, published, hidden or has its
   availability changed, so an edit shows up immediately instead of within five
   minutes.

Honest assessment: step 1 is half a day and touches something on every page of
the site. Steps 3 and 4 are where the actual speed is, and they carry a real
risk — a caching bug on a listing page means showing stale availability or
stale prices, which on this site means taking a booking for a date that is
already gone. I would do step 1 and step 2 now, and I would not do steps 3 and
4 until the payment scenarios in `PAYMENT-SCENARIOS.md` are scripted and
passing, because you'd want to be able to prove availability is still right.

For a soft launch of ten properties, 225 ms TTFB is not what is keeping you off
page one. The content is.

---

# 5. What I'd build that doesn't exist

## You are right about the area pages. Do them first.

Your reasoning is exactly right and I'd put it more strongly. Someone typing
"holiday cottages in Kirkcudbright" has already decided to come to Dumfries and
Galloway — they are choosing *where*, not *whether*. That is the cheapest
traffic you will ever get, and it is the only search term where a ten-property
site can realistically outrank Sykes and Cottages.com, because those sites have
one thin auto-generated page per town and nobody who has ever been to
Kirkcudbright wrote a word of it. You can beat that on substance.

There is a second reason, which is structural rather than about traffic: **right
now every listing page is a dead end.** Nothing links to a listing except the
home page grid, and a listing links to nothing at all. Area pages give you a
middle layer — home → area → listing, with listings linking back up to their
area and sideways to nearby ones. That is a site shape Google can understand.
At the moment you have a shape it can't.

### Which pages, in order

I'd build them at `/holiday-cottages/[area]`. Start with towns where you
actually have a property, because a page promising cottages in a town with none
is worse than no page:

1. **Kirkcudbright** — your own base, the strongest name, an artists' town with
   genuine search volume
2. **Castle Douglas** — the food town, and close enough to share a visitor
3. **Gatehouse of Fleet**
4. **Dalbeattie**
5. **Newton Stewart** — gateway to Galloway Forest Park and the Dark Sky Park
6. **Wigtown** — the National Book Town, a very specific and very winnable term
7. **Moffat**, **Stranraer**, **Dumfries** — when you have stock there

Then, once those work, a second layer of pages that are about a *want* rather
than a place — these convert better than town pages because the person is
further along:

- Dog-friendly cottages in Dumfries & Galloway
- Cottages with a hot tub in Dumfries & Galloway
- Cottages near Galloway Forest Park / the Dark Sky Park
- Coastal cottages on the Solway Firth

Every one of those maps onto data you already hold — `amenities` contains
"Pets allowed" and "Hot tub", `location` contains the town. The filtering
already exists on the home page.

### What each page needs to say

I am deliberately not writing this. It is about your area and your properties
and invented copy would be worse than none. But here is the structure, and what
only you can fill in:

1. **An `h1` that is the search term.** "Self-catering holiday cottages in
   Kirkcudbright". Not "Kirkcudbright".
2. **Two or three paragraphs about the town — written by someone who has been
   there.** This is the whole page. This is what beats Sykes. What the harbour
   is like, why the artists came, what the High Street is actually for, where
   you'd eat. 250–400 words. **Nobody but you can write this.**
3. **The properties you have there**, using the card component that already
   exists on the home page.
4. **What's nearby** — a short list of things to do within half an hour, with
   distances. You already collect a `nearby` field per listing; some of it will
   be reusable.
5. **Getting there** — driving times from Glasgow, Carlisle, Edinburgh. Factual,
   quick to write, and genuinely one of the first things people search.
6. **A short FAQ** — "Are there dog-friendly cottages in Kirkcudbright?", "When
   is the best time to visit?". These win the answer box in Google and take
   five minutes each.
7. **Links out** to the neighbouring area pages, so the pages support each other.

The engineering underneath is small: one dynamic route, a config file listing
the areas with their copy, filtering listings by `townKey()` — which already
exists in `lib/places.ts` and is already tested — plus `ItemList` and
`BreadcrumbList` JSON-LD, the areas in the sitemap, and a breadcrumb on each
listing page pointing back at its area. **A day's work, and it is blocked
entirely on the writing, not the code.**

## The other things I'd add

**A real "list your property" landing page**, separate from the wizard. Right
now `/addhome` is a nine-step form, it's noindexed, and there is nothing between
"someone searching *holiday let management Dumfries and Galloway*" and a form.
Your actual pitch — hosts keep more than Airbnb or Booking.com leave them —
does not appear on any indexable page on the site. That is a whole side of the
business with no front door. This one you might get more from than the area
pages, because there is far less competition for it.

**A blog or guides section.** Not for its own sake — specifically for the
searches that happen *before* someone has decided where to stay. "Things to do
in Dumfries and Galloway when it rains", "the Galloway Dark Sky Park", "walking
the Southern Upland Way". Those people are three months from booking, which is
exactly when you want to be in front of them, and it is the traffic that makes
the area pages rank.

**A `/reviews` page** once you have enough of them. Social proof for a site
nobody has heard of, and it feeds the structured data.

**Google Business Profile and Google Search Console.** Neither is code. Search
Console is the only way you will ever find out what people actually type before
they land on you, and right now you are guessing — including in this document.
Set it up before you write a word of the area pages, and again after they go
live.

**One thing not to do:** don't add a page per town where you have no property.
Empty area pages are worse than no area pages — Google treats a set of thin,
near-identical pages as a quality signal against the whole site.

---

# The change you might not want

Deleting `app/loading.tsx` is the only change in this branch that alters what a
visitor sees. Public pages no longer show the full-screen "Finding your perfect
getaway…" splash — they show nothing until the server responds, which for the
home page is 55 milliseconds. The signed-in areas keep their loading states; I
added the lighter in-app one to `/account`, `/admin`, `/edit-listing`,
`/passport` and `/booking-confirmed`, matching the one `/dashboard`, `/messages`
and `/trips` already had.

I did this because it is the only way to get real 404 status codes, and soft
404s across the whole site is squarely the SEO bug you asked me to fix. But it
is a visible change and it is your site.

To put the splash back on every page and accept the soft 404s:

```bash
git revert --no-commit $(git log --format=%H -1 --grep="404")
```

Or just tell me and I'll do it properly.

---

# Every file I changed

| File | What |
|---|---|
| `app/sitemap.ts` → `app/sitemap.xml/route.ts` | Now actually regenerates per request. Adds `/services` and `/business`. Reports a failed query instead of silently shipping an empty sitemap. |
| `app/robots.ts` | Stops blocking the public tradesman directory. Blocks the token and private pages that were crawlable. |
| `app/loading.tsx` → per-route loading files | The soft-404 fix. |
| `app/homes/[id]/page.tsx` | Second `h1` → `h2`. Real 404 for a missing listing. `noindex` for anything not published. |
| `app/services/[trade]/layout.tsx` *(new)* | Per-trade titles and canonicals. 404s an unknown trade. |
| `app/services/[trade]/page.tsx` | Provider logo alt text. |
| `app/addhome/layout.tsx`, `app/services/join/layout.tsx` *(new)* | Real titles instead of the home page's; `noindex` matching robots.txt. |
| `app/business/page.tsx` | Title said "Galloway Getaways" twice. Canonical added. |
| `app/services/page.tsx` | Canonical added. |
| `tailwind.config.js` | Scans `lib/` and `config/` so a class name written there can't silently generate no CSS. |
| `.claude/launch.json` | Two extra local server configs I used for the audit. Delete if you don't want them. |

Nothing in `lib/`, nothing touching payments, payouts or refunds, no migrations.
