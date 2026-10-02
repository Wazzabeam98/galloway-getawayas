# Site audit — 19 September 2026

Re-verification of `SITE-AUDIT.md` (29 August 2026) against current master.

**Read-only. Nothing was changed, committed, pushed or deployed.** No database
was written to. The only file this session created is this one.

## How this was measured

- Against `origin/master` at `24a6a13` (PR #148). The local tree at `7540b59`
  is content-identical to it — `git diff HEAD origin/master` is empty — so what
  is described here is what is on master, not a stale checkout.
- `npm run build` (green) + `next start -p 3100`, pointed at
  `.env.local`, which is the **test** Supabase project `yefoqcabuijcowoqewtc`.
  Production was never contacted.
- Status codes and headers from `curl`. Rendered DOM, heading counts, alt text
  and performance from Playwright at **375×812, DPR 2, iPhone user-agent**.
- Every number below was taken, not estimated. Where I did not measure
  something, I say so.

### Three measurement caveats, because they change how you read the numbers

1. **JS/CSS/HTML byte figures below are uncompressed.** `next start` on
   localhost reports `content-length` before compression. Over the wire with
   gzip/brotli they are roughly a third of what is printed. **Image figures are
   real wire bytes** — JPEG and PNG are already compressed — so the image
   findings, which are the important ones, stand as measured.
2. **The test database holds production storage URLs.** Listing photos on test
   are served from `hviwjxigqivjfhmhpjiy.supabase.co`, which is the production
   project. That is why the image weights are meaningful rather than seed
   noise: they are your real photographs. It also means test rows point at
   production storage, which you may or may not have intended.
3. **This is localhost, not Vercel.** Absolute timings will differ. The
   relative shape — which page is slow and what makes it slow — holds.

---

# The short version

The 29 August audit has held up well. **Every SEO fix it claims to have made is
still in place**, and four items it listed as "not fixed, needs a decision from
you" have since been fixed. Nothing in it was found to have silently reverted.

Two of its claims are now **out of date rather than wrong** — the site changed
underneath them.

What matters more is what has appeared *since*. The three findings worth your
time are all new, and all three are performance rather than SEO:

1. **A 2.1 MB host avatar on every listing page**, rendered into a 44-pixel
   circle. It is 99% of the image weight of the page on a phone.
2. **962 KB of town photographs on the home page** that bypass Next's image
   optimiser entirely.
3. **All ten area landing pages are built, written, linked — and `noindex,
   nofollow`.** They are deliberately held, and the thing holding them is a
   factual check only you can do.

---

# 1. The findings, one by one

Marked **CONFIRMED** (the 29 August finding is still true of master today),
**ALREADY FIXED** (it was fixed and the fix is still in place), or **NEVER
TRUE / NO LONGER TRUE**.

## The five things you asked me to check specifically

### 1.1 Duplicate `h1` on listing pages — **ALREADY FIXED**

One `h1` in the source (`app/homes/[id]/page.tsx:459`, the property title) and
one in the rendered DOM. "About this place" is an `h2` at line 659. Six `h2`s
on the page, heading order clean.

I checked this across all 18 public routes, not just listings: **every one has
exactly one `h1`.** The fix held and then some.

### 1.2 Are hidden listings indexable? — **ALREADY FIXED**

`generateMetadata` emits `robots: { index: false, follow: false }` for anything
whose `status` is not `published` (`app/homes/[id]/page.tsx:212-218`), and the
sitemap filters on `.eq('status','published')`. The page and the sitemap agree.

Measured: a published listing returns `index, follow`; a non-existent id
returns **404**, not a 200 with an apology on it.

### 1.3 Does `/services/<anything>` still return 200? — **ALREADY FIXED, but a new gap has opened**

The original finding is fixed. `app/services/[trade]/layout.tsx` calls
`notFound()` for any key not in `TRADES`, server-side. Measured:

| URL | Status |
|---|---|
| `/services/literally-anything` | **404** |
| `/services/cleaner` (the audit's own example) | **404** |
| `/services/plumber` | 200 |

**But a new class of soft-404 has appeared that the August audit predates.**
`TRADES` has eleven keys; only seven are in `SHOP_TRADES` and can actually be
enquired about. The other four pass the layout's check — they are real keys —
and then render a 200 with no content:

| URL | Status | What renders | Indexable? |
|---|---|---|---|
| `/services/sponge` | **200** | "Not this one yet" | **`index, follow`** |
| `/services/bin` | **200** | "Not this one yet" | **`index, follow`** |
| `/services/trees` | **200** | "Not this one yet" | **`index, follow`** |
| `/services/guest` | **200** | "Taking you there…" then a JS redirect | **`index, follow`** |

Each of these carries a real title and a self-referencing canonical from the
layout — `/services/sponge` is titled "Cleaning for holiday lets in Dumfries &
Galloway" and invites Google to index a page that says there are no cleaners.
That is four thin pages actively offered to search.

**And `/services/guest` redirects to a URL that does not exist.**
`app/services/[trade]/page.tsx:124` sets `let target = '/homes'` for a visitor
with no upcoming stay. There is no `/homes` route — only `/homes/[id]`.
Measured: `/homes` returns **404**. So a signed-out visitor who lands on
`/services/guest` is sent to a 404. This is the only reference to `/homes` in
the codebase, so the blast radius is that one redirect, but it is a real dead
end and it is reachable from search.

### 1.4 Title tags on `/addhome` and the trade pages — **ALREADY FIXED (and it is eleven pages now, not fourteen)**

Measured from the rendered `<head>`:

| URL | Title | Robots |
|---|---|---|
| `/addhome` | `List your property \| Galloway Getaways` | `noindex, nofollow` |
| `/services/plumber` | `Plumber for holiday lets in Dumfries & Galloway \| …` | `index, follow` |
| `/services/roofer` | `Roofer for holiday lets in Dumfries & Galloway \| …` | `index, follow` |
| `/services/join` | `Join as a trade \| Galloway Getaways` | `noindex, nofollow` |
| `/business` | `Start hosting \| Galloway Getaways` | `index, follow` |

All correct, all distinct, and `/business` says the brand once rather than
twice. Canonicals present on every indexable page.

**"The fourteen trade pages" is NO LONGER TRUE as a count.** `TRADES` in
`lib/serviceProviders.ts` now holds **eleven** keys — ten host trades plus a
single `guest` key. The four separate guest trades the August audit counted
(`chef`, `cake`, `basket`, `other`) were consolidated into one. The audit was
right when written; the list shrank underneath it. Of the eleven, seven are
real shop pages, four are the soft-404s in 1.3 above.

### 1.5 What structured data exists — **CONFIRMED, and richer than August**

Three JSON-LD blocks on a listing page, all parsing cleanly:

| Block | Source | Notes |
|---|---|---|
| `LodgingBusiness` | root layout | name, url, logo, image, address, areaServed, priceRange |
| `BreadcrumbList` | listing page | **new since August** — Home → area page → listing |
| `VacationRental` | listing page | name, description, url, 6 images, address, numberOfRooms, occupancy, 19 × amenityFeature, GBP offer |

**The `aggregateRating` gating still holds.** Checked all four published
listings: none emits an `aggregateRating` key at all, which is correct — none
has reached `MIN_PUBLIC_REVIEWS`. Not a zero, not an empty object. This is the
thing Google penalises sites for getting wrong and it is right.

Three things worth knowing:

- **`geo` is conditional and missing on half your listings.** It is emitted
  only when `approx_latitude` and `approx_longitude` are stored. Of the four
  published listings on test, **two have it and two do not**. The August audit
  described geo as present without noting the condition.
- **The breadcrumb points at a `noindex, nofollow` page.** Every listing's
  `BreadcrumbList` names `/holiday-cottages/<area>` as position 2, and every
  area page is currently noindexed (see 2.1). You are handing Google a
  breadcrumb trail through a page you have told it to ignore.
- **The `ratingValue` / `reviewCount` mismatch is CONFIRMED and unchanged.**
  `avgRating` comes from `home.rating_avg` (a database trigger counting *all*
  reviews, `app/homes/[id]/page.tsx:395`) while `reviewCount` is
  `reviews.length` (published only, line 404). Still three sources for one
  number. It cannot bite until a listing passes three reviews, so it is not
  urgent — but it will bite silently when it does.

## The rest of the August SEO list

| Finding | Status | Evidence |
|---|---|---|
| Sitemap only updated on deploy | **ALREADY FIXED** | `app/sitemap.ts` gone; `app/sitemap.xml/route.ts` exists; build output shows `λ /sitemap.xml`, not `○` |
| Every 404 answered 200 | **ALREADY FIXED** | `app/loading.tsx` absent; `/nonsense-page`, `/homes/<missing>`, `/holiday-cottages/not-a-town` all measured **404** |
| `robots.txt` hid the trade directory | **ALREADY FIXED** | `app/robots.ts` disallows only `/services/join` and `/services/enquiry` |
| Listing that doesn't exist returned 200 | **ALREADY FIXED** | `notFound()` at line 322; measured 404 |
| `/business` said the brand twice | **ALREADY FIXED** | measured `Start hosting \| Galloway Getaways` |
| Missing alt on provider logo | **ALREADY FIXED** | swept all 18 public routes: **zero** images missing `alt` |
| `metadataBase` set | **CONFIRMED** | canonicals resolve to `https://gallowaygetaways.co.uk` |
| **Home page `h1` was the brand name** | **ALREADY FIXED — since August** | now "Self-catering cottages across Dumfries & Galloway" (`components/base/Hero.tsx:647`) |
| **Four pages had no `h1`** | **ALREADY FIXED — since August** | `/services/join`, `/services/join/apply`, `/auth/reset`, `/unsubscribe` all measured `h1=1` |
| **Hero photos had `alt=""`** | **ALREADY FIXED — since August** | zero empty-alt images on the home page; town photos carry descriptive alt |
| **Listing pages were dead ends** | **ALREADY FIXED — since August** | listing pages now link to their area page (`app/homes/[id]/page.tsx:452`) |
| `lastmod` is `approved_at`, no `updated_at` | **CONFIRMED** | `app/sitemap.xml/route.ts` comment says so; no `updated_at` on `listings` |
| Nominatim called in the render path | **CONFIRMED** | `app/homes/[id]/page.tsx:131`, still in the server render path |
| Listing page does sequential round trips | **CONFIRMED** | four sequential `await`s in the server body, no `Promise.all` |

**Nothing in the August audit was found to be "never true."** Its two
inaccuracies are both drift: the trade-page count, and `geo` being described
without its condition.

---

# 2. Internal linking, as it actually is

Mapped from `href` attributes in the rendered public pages, not from intent.

## What links to what

| Page type | Links IN (from public pages) | Links OUT (public) |
|---|---|---|
| **Home** `/` | footer (every page), navbar logo (every page) | every published listing (`ListingCard`), every area page with a photo + blurb, footer set |
| **Listing** `/homes/<id>` | **home page**, **its own area page** | `/` and its area page — and nothing else |
| **Area** `/holiday-cottages/<slug>` | **home page** (town carousel), **listing pages**, other area pages (`nearby`) | its listings, `/`, neighbouring area pages |
| **Trade** `/services/<trade>` | `/services/property` only | `/services/property` |
| `/services` | footer, `/services/property` | `/business`, `/services/property`, `/trips` |
| `/services/property` | footer | `/services`, each trade page, `/trips`, `/dashboard/enquiries` |
| `/business` | footer, `/services` | (none outbound) |
| Legal pages | footer | footer set |

## Where a listing page is reachable from, other than the home page

**The area pages, and nothing else public.**

`components/ListingCard.tsx:50` is the only public component that links to
`/homes/<id>`, and it is rendered in exactly two places:

- `app/page.tsx:275` — the home page
- `app/holiday-cottages/[area]/page.tsx:237` — the area pages

Every other link to a listing is behind a login (`/dashboard`, `/trips`,
`/messages`, admin screens, the provider dashboards) and is invisible to a
crawler and to a signed-out guest.

**So the August finding "every listing is a dead end" is fixed in shape but not
yet in effect**, for one reason:

### 2.1 All ten area pages are `noindex, nofollow`

Every entry in `config/areas.ts` carries `hold: true` — Kirkcudbright, Castle
Douglas, Gatehouse of Fleet, Dalbeattie, Newton Stewart, Wigtown, Dumfries,
Moffat, Stranraer, Portpatrick. Measured on
`/holiday-cottages/kirkcudbright`: `<meta name="robots" content="noindex,
nofollow">`. The live sitemap contains **no area pages at all** — only the home
page, five legal/marketing pages, `/services`, and the four published listings.

This is deliberate and documented. `hold` is described in `config/areas.ts:87`
as a staging switch so a written page can be checked before Google sees it, and
the copy is genuinely written — three or four real paragraphs per town, naming
specific businesses and attractions.

The consequence is precise and worth stating plainly: **the second route to
your listings currently passes no authority and creates no discoverability.**
`nofollow` on the area page means Google will not follow area → listing. So
today, for search purposes, a listing is still reachable only from the home
page. The link graph you built is real for humans and inert for crawlers until
`hold` comes off.

### 2.2 Smaller linking gaps

- **The footer does not link to the area pages.** They are the thing you most
  want crawled once published, and they have no site-wide link — only the home
  page carousel and the listing breadcrumb.
- **The trade pages are not in the sitemap.** August made them crawlable in
  `robots.txt` and gave them unique titles; the sitemap lists `/services` but
  none of the seven real trade pages, nor `/services/property`.
- **`/business` links out to nothing.** It is a leaf.
- **`/register-interest` is in neither the sitemap nor any public link** that I
  could find.

---

# 3. Page speed at mobile widths

375×812, DPR 2, iPhone user-agent, production build, localhost, test database,
production image storage. **Image bytes are real; JS/CSS/HTML bytes are
uncompressed — see the caveats at the top.**

## Server response time (median of 7, signed out)

| Page | TTFB | August | Change |
|---|---|---|---|
| `/business` | **11 ms** | 12 ms | — |
| `/terms` | **13 ms** | 12 ms | — |
| `/services/plumber` | **13 ms** | not measured | — |
| `/contact` | **14 ms** | 12 ms | — |
| `/holiday-cottages/kirkcudbright` | **61 ms** | did not exist | new |
| `/` (home) | **116 ms** | 55 ms | **2.1× slower** |
| `/homes/<id>` | **269 ms** | 225 ms | 1.2× slower |

The home page has roughly doubled its server time since August. The town
carousel now resolves a photo file on disk per area during the server render
(`app/page.tsx:205-215`), which is the most likely cause, though I did not
isolate it.

## In the browser

| Page | TTFB | FCP | LCP | Images fetched | Requests |
|---|---|---|---|---|---|
| `/` home | 1132 ms* | 1244 ms | **1244 ms** | **1,413 KB** | 37 |
| `/homes/<id>` | 304 ms | 360 ms | **868 ms** | **2,195 KB** | 31 |
| `/holiday-cottages/<area>` | 68 ms | 112 ms | 112 ms | 105 KB | 23 |
| `/services/plumber` | 15 ms | 52 ms | 248 ms | 0 KB | 30 |

\* first navigation of a cold browser context, so it includes warm-up; the
curl median of 116 ms is the truer server number.

## What the bytes actually are

### The listing page: a 2.1 MB avatar

| Bytes | Optimised? | What |
|---|---|---|
| **2,173 KB** | **RAW** | `…/avatars/7738220e-…-1786791390700.png` |
| 21 KB | `next/image` w=750 | the gallery photo |

**One PNG is 99% of the listing page's image weight on a phone.** It is the
host avatar at `app/homes/[id]/page.tsx:561-566`, rendered with a plain `<img>`
into a `w-11 h-11` container — **a 44×44 pixel circle**. The browser downloads
2.1 MB and throws essentially all of it away.

This is the single biggest performance defect on the site and it is on the page
you most want to rank. It is also the cheapest fix in this document: the `<img>`
is not going through `next/image`, so nothing resizes it.

Worth checking whether other avatars elsewhere use the same plain `<img>`
pattern — I did not sweep for it.

### The home page: 962 KB of unoptimised town photos

| Bytes | Optimised? | What |
|---|---|---|
| 292 KB | **RAW** | `/images/towns/dalbeattie.jpg` |
| 265 KB | **RAW** | `/images/towns/kirkcudbright.jpg` |
| 234 KB | **RAW** | `/images/towns/gatehouse-of-fleet.jpg` |
| 171 KB | **RAW** | `/images/towns/castle-douglas.jpg` |
| 83 / 78 / 63 / 51 KB | `next/image` w=750 | hero-3, hero-4, hero-2, hero-1 |
| 71 / 54 / 29 / 21 KB | `next/image` w=750 | four listing card photos |

Two separate things here.

**The town photos bypass the optimiser.** `components/TownsCarousel.tsx:40`
uses a plain `<img>` with an `eslint-disable` for `@next/next/no-img-element`,
so the full-size file on disk goes to the phone — 962 KB of it, **68% of the
home page's image weight**. They are `loading="lazy"`, and they were still all
four fetched on a normal mobile load. The raw files are 174–299 KB each and
are served at whatever size they happen to be.

The `<img>` is there for the `onError` → grey-placeholder fallback, so this was
a deliberate trade rather than an oversight. It is a costly one.

**The hero is doing the right thing, and doing it four times.** Each hero photo
is correctly requested at **w=750** for a 375px DPR-2 screen — so the August
finding "Phone (375px) 41 KB — fine" still holds per image, at 51 KB today. But
**all four rotating hero photos are fetched on load**, totalling 275 KB, when
only the first is ever visible above the fold.

(I initially misread this as the hero being fetched at `w=3840`. That was the
fallback `src` attribute Next emits alongside the `srcset`; the browser fetched
w=750. Worth knowing if you ever check this yourself — reading the `src`
attribute will lie to you here.)

### The `force-dynamic` question — **CONFIRMED, and you are right about the cause**

The build output shows **every single route as `λ` (server-rendered at
runtime)**. The only two `○` (static) entries in the whole build are
`/robots.txt` and `/icon.svg`.

Your framing is correct and the August audit agrees with it:
`components/base/Navbar.tsx` calls `cookies()` in the root layout, and any page
reading cookies is dynamic by definition. `force-dynamic` in the root layout is
describing a decision the navbar has already made — removing that line would
change nothing. The five pages August identified as able to go static
(`/contact`, `/terms`, `/privacy`, `/cancellation-policy`, `/business`) are all
still `λ` today.

I did not re-run August's experiment of swapping in a static navbar, because
that means editing code and this was a read-only pass.

### Titles are too long for a search result

All four published listings emit titles of **79–87 characters**. Google
truncates around 60. Two of them say the town twice:

> `Modern 3 Bedroom, Kirkcudbright | Self Catering in Kirkcudbright | Galloway Getaways` — 84 chars

The template at `app/homes/[id]/page.tsx:188` appends `| Self Catering in
<town>`, and the root layout appends `| Galloway Getaways` on top. When the
host's own title already ends in the town name, it lands three times in one
tag. Nothing is broken; it just wastes the part of the result a person reads.

---

# 4. What needs YOUR factual verification

These cannot be settled from the code. They need you, the real world, or a
browser logged in to something.

1. **Clearing `hold` on the area pages.** This is the biggest single SEO lever
   available and it is blocked on a fact-check, by design. `config/areas.ts:70`
   says everything named in the copy "needs checking against the real world
   before the area comes off `hold`". The copy names specific businesses and
   attractions — Broughton House, the Tolbooth Art Centre, Cream o' Galloway,
   The Bookshop on North Main Street, Bladnoch distillery, the ferryman's bell
   at Threave Castle, Kirkcudbright's floodlit tattoo. **Are they all still
   open and still true?** Clearing `hold` per town publishes that town. Only
   Kirkcudbright and Castle Douglas have stock today, so those two are the only
   ones that would enter the sitemap immediately anyway.
2. **Whether the test database should hold production storage URLs.** Listing
   images on the test project are served from the production Supabase project.
   Harmless for a public bucket, but it means test is not as isolated as it
   looks, and it is not something I can judge for you.
3. **`supabase/.temp/project-ref` does not exist.** You asked what `cat`
   returns: `No such file or directory`. See section 6 — this one has a safety
   consequence.
4. **Whether `/services/sponge`, `/bin` and `/trees` should be indexable at
   all.** The code is doing what it was told; whether Google should see three
   "not this one yet" pages is a business call, not a bug.
5. **Whether `/addhome` should stay `noindex`.** The August audit flagged this
   as worth revisiting and the comment in `app/addhome/layout.tsx` still says
   so: the wizard should stay out of search, but a real "list your property"
   landing page in front of it should not. Still unresolved.
6. **Open Graph rendering.** Still untestable from here. Paste a listing link
   into WhatsApp after a deploy and look at it.

# 5. What is purely code

No factual judgement needed. Ordered by value for effort.

1. **The 2.1 MB avatar** (`app/homes/[id]/page.tsx:561`). A plain `<img>` into
   a 44px circle. Biggest win on the site, smallest change.
2. **`/services/guest` redirects to `/homes`, which 404s**
   (`app/services/[trade]/page.tsx:124`). One-word fix; `/` is presumably meant.
3. **The four soft-404 trade pages are `index, follow`.** `/services/sponge`,
   `/bin`, `/trees`, `/guest` should be `noindex` while they have nothing to
   show — the layout already knows the trade key, so it is the same shape of
   change as the existing unknown-key branch.
4. **962 KB of town photos bypassing `next/image`**
   (`components/TownsCarousel.tsx:40`). Either move to `next/image` (it does
   support `onError`) or pre-resize the four files on disk.
5. **All four hero photos load on first paint.** Only the first is visible;
   the other three could wait for the rotation.
6. **The breadcrumb names a `noindex, nofollow` URL.** Either gate the
   breadcrumb on the area being publishable, or accept it as harmless until
   `hold` clears — but the two should not disagree.
7. **Listing titles run 79–87 characters** with the town repeated. Trim the
   template.
8. **Add the seven real trade pages to the sitemap**, and the area pages will
   add themselves once `hold` clears.
9. **Footer link to the area pages**, once they are published.
10. **The `ratingValue` / `reviewCount` mismatch.** Pick one source. Harmless
    until a listing reaches three reviews.
11. **Four sequential `await`s on the listing page** — several are independent
    and could be a `Promise.all`. This is most of the 269 ms.
12. **The Nominatim call in the render path** (`app/homes/[id]/page.tsx:131`).
    A listing without stored coordinates makes the first visitor after a cache
    miss wait on a third-party server. Two of four published listings have no
    stored coordinates, so this is live, not theoretical.
13. **No `updated_at` on `listings`**, so `lastmod` is `approved_at`. Still a
    migration, still worth making.

---

# 6. MAINTENANCE.md — claims checked against the code

You asked me to read it and verify rather than trust it. Almost all of it held.
One thing did not.

### `supabase/.temp/project-ref` does not exist — and the doc tells you to check it

`MAINTENANCE.md` says, under "Which database am I on?":

> **The Supabase CLI in this checkout is linked to production** while
> `.env.local` points the app at test. `supabase db push` or `db reset` from
> here hits live data. Check `supabase/.temp/project-ref` before any CLI
> command that writes.

**`cat supabase/.temp/project-ref` returns `No such file or directory`.** The
`.temp` directory exists and holds six other files (`cli-latest`,
`gotrue-version`, `postgres-version`, `rest-version`, `storage-migration`,
`storage-version`), all dated 20 August except `cli-latest`. `project-ref` is
not among them, and it is absent from the `galloway-getawayas-listings`
worktree too.

This matters in the way `MAINTENANCE.md`'s own first section warns about — *"a
guard that throws is worse than no guard"*. The safety check the document
prescribes is a `cat` that returns nothing. Someone following the instruction
sees no output and has to decide what that means, and "no output" reads much
more like "not linked, safe" than like "unknown, check another way".

Two possibilities, and I cannot tell them apart from here: either the CLI link
was removed at some point (in which case the checkout is no longer linked to
production, and the warning is stale but harmless), or the file is
gitignored/cleaned and the link lives elsewhere (in which case the warning is
live and the check no longer performs it). **Either way the instruction as
written does not work.** Worth resolving, because the sentence it supports is
about not writing to production by accident.

I did not run any `supabase` CLI command to find out, since that is one of the
four things Claude Code does not do here.

### Claims that checked out

| Claim | Verdict |
|---|---|
| `app/sitemap.ts` prerenders despite `force-dynamic`; route handler needed | Confirmed — build shows `λ /sitemap.xml` |
| Navbar's `cookies()` makes every page dynamic | Confirmed — every route is `λ`; only `/robots.txt` and `/icon.svg` are `○` |
| A door code is never a column on `listings` | Confirmed — the listing page's `select` names 40 columns, none of them a code |
| Build is the real check, not the test suite | Confirmed — `npm run build` green on master |
| `node` not on the tool-session PATH | Confirmed — needed `export PATH="$HOME/.local/node/bin:$PATH"` |
| Production = `hviwjxigqivjfhmhpjiy`, test = `yefoqcabuijcowoqewtc` | Consistent with `.env.local` and the storage URLs observed |

---

# 7. The two side questions

## `~/Projects/galloway-getawayas-listings`

**It is not a separate clone. It is a git worktree of this same repository.**

- Its `.git` is a *file*, not a directory, containing
  `gitdir: /Users/liamworrall/Projects/galloway-getawayas/.git/worktrees/galloway-getawayas-listings`
- `git worktree list` from the main repo confirms it, alongside a third,
  prunable worktree under a Desktop scratchpad on `feat/slot-per-item-duration`.
- **Remote:** the same one — `https://github.com/Wazzabeam98/galloway-getawayas`
- **Branch:** `docs/how-money-moves-live-v2`
- **Last commit:** `db4f4e4`, **17 September 2026 17:29**, *"Money doc: fee
  answer (we bear Stripe's fee, provider keeps 90%), 5p identified + clearable,
  and an experience-margin table"*
- **Working tree:** clean except three untracked files —
  `AUDIT-GUEST-EXPERIENCES-PAYMENTS-2026-09-10.md`,
  `AUDIT-OVERNIGHT-2026-09-05.md`, `TERMS-DRAFT-FOR-REVIEW.md`
- **Files last touched:** 17 September 17:29

Because it shares this repo's `.git`, commits made there are commits in this
repository. It also has its own `.env.local` (dated 13 September) and its own
`.next`, `.next-verify` and `.test-build` directories.

## `cat supabase/.temp/project-ref`

```
cat: supabase/.temp/project-ref: No such file or directory
```

Covered in section 6 — this is the one `MAINTENANCE.md` claim that no longer
works as written.

---

# Appendix: measured status codes

| URL | Status |
|---|---|
| `/` | 200 |
| `/sitemap.xml` | 200 |
| `/robots.txt` | 200 |
| `/contact`, `/terms`, `/business`, `/services`, `/services/property`, `/addhome` | 200 |
| `/services/plumber`, `/services/electrician` | 200 |
| `/services/sponge`, `/services/bin`, `/services/trees`, `/services/guest` | 200 — soft 404 |
| `/services/literally-anything` | **404** |
| `/services/cleaner` | **404** |
| `/holiday-cottages/kirkcudbright` | 200 (noindex) |
| `/holiday-cottages/not-a-town` | **404** |
| `/homes/00000000-0000-0000-0000-000000000000` | **404** |
| `/homes` | **404** — no such route, and `/services/guest` redirects here |
| `/nonsense-page` | **404** |

Live sitemap contents: `/`, `/services`, `/business`, `/contact`, `/terms`,
`/privacy`, `/cancellation-policy`, and four `/homes/<id>` entries. No area
pages (all held), no trade pages.
