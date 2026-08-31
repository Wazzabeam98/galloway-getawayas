# Area landing pages — what to write

29 August 2026. Branch `feat/area-pages`, off `audit/seo-and-site-audit` because
it needs the sitemap route handler from it. Nothing merged, nothing deployed.

**The pages are built and empty.** Nine of them, at
`/holiday-cottages/<town>`. Every technical thing is done: title, meta
description, Open Graph, Twitter card, structured data, canonical URL, one h1,
breadcrumbs, internal links, and sitemap inclusion that updates without a
deploy. What is missing is the writing, which is the part that is actually
worth anything and the part I should not do.

**Nothing can reach Google until you write it.** An area with no introduction
is `noindex` and is not in the sitemap, and there is a test that fails if that
gate is removed. This is deliberate: a cluster of near-identical thin pages is
read by Google as a quality signal about the *whole domain*, so an unwritten
page going live would cost you more than not having the page.

Look at one now — with `npm run dev`, go to
`/holiday-cottages/kirkcudbright`. Each empty section shows an amber box saying
what it wants. Those boxes never render in production.

---

## What was built

| | |
|---|---|
| **URL** | `/holiday-cottages/<slug>` — e.g. `/holiday-cottages/kirkcudbright` |
| **Where the copy lives** | `config/areas.ts`, one entry per area |
| **Title** | "Holiday cottages in Kirkcudbright \| Galloway Getaways" |
| **Meta description** | `metaDescription` in the config; falls back to a generated line while unwritten |
| **Open Graph / Twitter** | Full card with title, description and image |
| **Structured data** | `BreadcrumbList` + `ItemList` of the properties, and `FAQPage` once there are FAQs |
| **Canonical** | `https://gallowaygetaways.co.uk/holiday-cottages/<slug>` |
| **Headings** | Exactly one `h1`, which is the search phrase and not the brand. Test enforces it |
| **Properties** | Matched by `townKey()` — the same function the home page search already uses, so an area agrees with search about what counts as one town |
| **Sitemap** | Included when the page has copy **and** at least one published property there |
| **Internal links** | Home page → area, area → each property, area → neighbouring areas, and **property → its area**, which is new |

### The dead ends are gone

Before this, nothing linked to a listing except the home page grid, and a
listing linked to nothing at all. Every property was a cul-de-sac for a guest
and for a crawler. There is now a middle layer — home → area → property — and
every listing page carries a breadcrumb back up to its town, with matching
`BreadcrumbList` data. That link only appears once the area has been written,
so you never link to a `noindex` page.

### The sitemap updates without a deploy — proved, not assumed

The two gates behave differently on purpose:

- **"Has it been written"** lives in code, so it needs a deploy. Publishing a
  new page should be a decision somebody made.
- **"Is there anywhere to stay there"** is counted from the database on every
  request. Publish a cottage in Moffat and the Moffat page is in the sitemap
  minutes later, with no deploy.

Checked on the running site: with Kirkcudbright temporarily given copy, setting
its one property to `hidden` dropped the area page out of the sitemap, and
publishing it again brought it back — no rebuild in between. Both temporary
changes were reverted.

---

## What every area page needs, in order

The page renders these sections in this order. Each maps to a field in
`config/areas.ts`.

### 1. `intro` — the two or three paragraphs. 250–400 words.

**This is the entire point of the page.** Everything else on it could be
generated; this cannot, and this is the only reason a ten-property site beats
Sykes and Cottages.com for "holiday cottages in Kirkcudbright". They have one
thin generated page per town that nobody who has been there ever read. You have
been there.

Write it as somebody who knows the place, to somebody deciding whether to come.
Not brochure language. What the town is actually like, what it is *for*, what
you would do on a wet Tuesday, where you would eat, why you would pick this
town over the next one along.

**Structure needs from the text:** one string per paragraph in the array. Two
or three of them. Do not put headings inside them — the page supplies its own,
and a heading inside a paragraph would break the heading hierarchy the test
checks.

Use the town's name naturally, a few times. Do not repeat "holiday cottages in
Kirkcudbright" — the `h1`, the title and the description already say it, and
saying it five more times in prose reads as spam to a person and to Google.

### 2. `metaDescription` — one line, 150–160 characters.

What shows under the blue link in Google. It is not a summary, it is an
advert: give somebody a reason to click rather than a description of the page.
Include the town name. Under 160 characters or Google truncates it.

Leave it empty and the page falls back to a generated line, which is adequate
for a page that is `noindex` anyway and not good enough for one that is not.

### 3. `thingsToDo` — two or three paragraphs.

What there is to actually do in and around the town. One string per paragraph,
same as `intro`, and no headings inside them.

This is where naming things earns its keep — "Threave Garden", "the Grey Mare's
Tail", "the 7stanes trails" are what people search for, and a page that names
them is a page that can turn up for them. It is also the riskiest section for
exactly that reason.

**Check every named place is still trading before the town comes off `hold`.**
Opening hours, ownership and whole businesses change. A page recommending
somewhere that shut two years ago reads worse than a page recommending nothing,
and it is the kind of mistake a guest notices and remembers.

### 4. `gettingThere` — a few bullet lines.

Driving times from **Glasgow, Carlisle and Edinburgh** at minimum; add Newcastle
and Belfast (via Cairnryan) where they make sense. One string per line.

Boring to write and one of the first things people actually search. "How far is
Kirkcudbright from Glasgow" is a real query with real volume, and answering it
plainly on the page is how you turn up for it.

### 5. `faqs` — three or four questions.

Real questions people ask about that town. These become `FAQPage` structured
data, which is what wins the expandable answer box in Google results — the
cheapest visibility on the page.

Keep answers to two or three sentences. Answer the question in the first
sentence; the rest is detail.

Good shapes: "Are there dog-friendly cottages in X?", "When is the best time to
visit X?", "Is there parking in X?", "What is there to do in X with children?",
"Can you get to X without a car?"

**Only ask questions you actually answer.** A FAQ that dodges is worse than no
FAQ, and Google penalises marked-up answers that do not answer.

### 6. `nearby` — already filled in.

Neighbouring area slugs, so the pages support each other rather than competing.
Already set for all nine; change them if the geography is wrong. A test fails if
one points at an area that does not exist.

---

## The nine pages, in the order I would write them

Order is by how winnable the search is against how likely you are to have
stock. **Do not write one for a town where you have no property** — the page
will not be published anyway, and writing it is wasted effort until you do.

| # | Page | Search terms it answers | Notes for you |
|---|---|---|---|
| 1 | **Kirkcudbright** | "holiday cottages kirkcudbright", "self catering kirkcudbright", "places to stay kirkcudbright" | Your base and the strongest name. The artists' town angle is genuinely distinctive and no aggregator page will have it. You have one property here now. Write this one first and see what it does. |
| 2 | **Castle Douglas** | "holiday cottages castle douglas", "self catering castle douglas", "castle douglas food town" | The food town. A close, distinct angle from Kirkcudbright, and near enough to share a visitor — so these two pages should link to each other and mean it. |
| 3 | **Wigtown** | "holiday cottages wigtown", "wigtown book festival accommodation", "self catering wigtown" | The National Book Town. Very specific, very winnable, and the festival is a dated search spike you can be ready for. You have one property here. |
| 4 | **Gatehouse of Fleet** | "holiday cottages gatehouse of fleet", "self catering gatehouse of fleet" | Small, low competition. Cheap to rank for once written. |
| 5 | **Newton Stewart** | "holiday cottages newton stewart", "galloway forest park accommodation", "dark sky park accommodation" | The gateway to Galloway Forest Park and the Dark Sky Park. The Dark Sky angle is the single most distinctive search term in the whole region — worth a page of its own later (see below). |
| 6 | **Dalbeattie** | "holiday cottages dalbeattie", "self catering dalbeattie" | Granite town, forest trails, mountain biking. |
| 7 | **Dumfries** | "holiday cottages dumfries", "self catering dumfries" | The biggest town and the hardest search — most competition, least distinctiveness. Worth having, not worth writing first. |
| 8 | **Moffat** | "holiday cottages moffat", "self catering moffat" | Geographically apart from the rest and closest to the M74, so it attracts a different visitor — the stop-off on the way north. Say that. |
| 9 | **Stranraer** | "holiday cottages stranraer", "accommodation near cairnryan ferry" | The ferry port. The Cairnryan angle — a night before an early sailing to Belfast — is a specific, low-competition, high-intent search almost nobody writes for. |

---

## The home page — you asked what it needs

I flagged in the audit that this matters more than everything else, so here it
is properly.

**Measured:** the home page has **254 words** of text, and that counts the
navigation, the footer, the search box labels and eleven property titles. The
actual body copy is about twenty words:

> Book direct for our best rate guarantee & no booking fees
> Our Properties — Handpicked holiday rentals in Dumfries & Galloway

That is the whole page, as far as a search engine reading it is concerned. It
cannot rank for "holiday cottages in Dumfries and Galloway" because the page
does not say anything about holiday cottages in Dumfries and Galloway. The
`<title>` says it. The description says it. The page does not.

### What it needs, in priority order

**1. The `h1` should say what the site is, not what it is called.**

It currently reads **"Galloway Getaways"** — your most valuable heading on your
most valuable page, spent on a brand name nobody searches for. It should be the
thing people type: self-catering holiday cottages in Dumfries & Galloway.

I did not change it because it is the visible headline over your hero photo and
that is a design decision. But the title tag and the `h1` currently disagree
about what the page is for, and the `h1` is the one that is wrong. If you want
the brand visible, it can sit above the heading as a smaller line, or stay in
the logo where it already is.

**2. Two or three paragraphs below the property grid. 200–300 words.**

Not above it — nobody scrolling for a cottage wants to read first. Below the
grid, where the "Where to stay in Dumfries & Galloway" links now sit.

It should cover: what the region is (most people searching have only a vague
idea), what kind of properties you have, and **why book direct** — the argument
that hosts keep more than Airbnb or Booking.com leave them and guests pay no
platform fee. That argument is the reason this business exists and it currently
appears nowhere on the site that Google can read.

**3. The "no booking fees" claim needs a sentence, not a slogan.**

"Book direct for our best rate guarantee & no booking fees" is a good line and
it is doing no work for search, because it is nine words with no explanation.
One short paragraph saying what the guarantee actually is would answer a real
query ("is it cheaper to book direct") and give a reason to trust a site nobody
has heard of.

**4. Alt text for the four hero photos.**

They are `alt=""` — treated as decorative. They are your best pictures of the
area and Google Images is a genuine way in for "Kirkcudbright harbour" style
searches. I did not write them because I do not know what each photo shows.
Tell me what hero-1 to hero-4 are and it is a five-minute change.

**5. A word about what the "Where to stay" links are.**

The new area links appear below the grid with the heading "Where to stay in
Dumfries & Galloway" and the line "Pick a town and see what we have there."
That is placeholder-grade and I wrote it only because the section needs
*something* to be usable. Replace it.

---

## Two more pages that do not exist and should

Not built — I did not want to build pages nobody had agreed to.

**A real "list your property" landing page.** `/addhome` is a nine-step wizard,
it is `noindex`, and there is nothing between somebody searching "holiday let
management Dumfries and Galloway" and a form. Your actual pitch — hosts keep
more than the big platforms leave them — appears on no indexable page on the
site. That is a whole side of the business with no front door, and the
competition for those terms is far thinner than for guest terms. This might
return more than the area pages.

**Want-based pages, once the town pages work.** "Dog-friendly cottages in
Dumfries & Galloway", "cottages with a hot tub", "cottages near Galloway Forest
Park / the Dark Sky Park", "coastal cottages on the Solway Firth". Every one
maps onto data you already hold — `amenities` contains "Pets allowed" and "Hot
tub" — so they are the same machinery pointed at a different filter. Somebody
searching those is further along than somebody searching a town name, so they
convert better. Do them second, because a town page is easier to write well.

---

## Before you write a word: Search Console

Set up Google Search Console and submit the sitemap. It is the only way to find
out what people actually type before they land on you, and until it is running
every search term in this document — mine and yours — is a guess. Do it now, so
that by the time the first area page has been live a month you can see whether
it worked.

---

## What this job does to the tests

**Before:** 729 passing.
**After:** 745 passing, 0 failing. Sixteen added, none changed, none removed.

The new file is `tests/area-pages.test.ts`. What it holds:

- **The two publishing gates.** An area with no copy is not publishable however
  many properties it has; a written area with no properties is not publishable
  either; whitespace does not count as copy.
- **That every area shipped today is unwritten.** This one is deliberately
  awkward: *it will fail the moment you write your first area page.* That is
  the design. It fails with a message telling you to update it and naming the
  area, so publishing a page becomes a decision somebody made rather than
  something that happened. Do not delete it — edit it to list the ones you have
  checked.
- **The wiring.** Unique slugs, no town claimed by two areas, no `nearby` link
  pointing at an area that does not exist, no area listing itself, and every
  `townKeys` entry actually being in the form `townKey()` produces — that last
  one catches a key written `castle-douglas` instead of `castledouglas`, which
  would match nothing and look like an empty page rather than a bug.
- **That the two gates agree.** The sitemap and the page's own robots tag both
  have to check `hasCopy`, because leaving a page out of a sitemap does not stop
  it being indexed from a link. Asserted by reading both files — crude, and it
  catches the thing that actually goes wrong, which is one being changed alone.
- **One `h1`, and a canonical.** The listing page shipped with two `h1`s for
  months. Cheap to check on a page built to rank.

One unrelated change to `tsconfig.test.json`: `config/areas.ts` is added to the
test build so the tests can import it. I first added all of `config/**` and it
broke the build — `config/countries.ts` refers to a global `CountriesType` from
the root `types.ts`, which the test tsconfig does not include. Not a real bug,
the Next build is fine with it, but worth knowing it is there.

---

## Every file this job touched

| File | What |
|---|---|
| `config/areas.ts` *(new)* | The nine areas, their town keys, their neighbours, and the empty copy slots. |
| `app/holiday-cottages/[area]/page.tsx` *(new)* | The page. Metadata, OG, JSON-LD, canonical, one h1, 404 for an unknown area. |
| `components/ListingCard.tsx` *(new)* | The property card, lifted out of the home page so the two grids cannot drift — the thing that would have drifted is the rule about not showing a rating below three reviews. |
| `app/page.tsx` | Uses the shared card; gains the "Where to stay" area links below the grid. |
| `app/homes/[id]/page.tsx` | Breadcrumb up to the property's area, plus `BreadcrumbList` data. |
| `app/sitemap.xml/route.ts` | Area pages included, gated on copy and on live property counts. |
| `tests/area-pages.test.ts` *(new)* | The sixteen tests above. |
| `tsconfig.test.json` | One line, so the tests can import the area config. |
