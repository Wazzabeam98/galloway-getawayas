# Experience presentation — what Airbnb shows, and where ours is thin — scope

Scoping doc (GitHub issues are disabled on this repo). A logged-out browse of
Airbnb Experiences (UK — Glasgow/Edinburgh, the nearest markets to Dumfries &
Galloway) across a cultural tour, a tasting, an outdoors hike and a one-to-one,
compared against our experience listing page and provider byline. The point is to
find what a guest gets on Airbnb that ours withholds, what reads worse, and — just
as important — **what not to copy**, because our model differs on purpose.

**Status: researched, NOT started.** No code. Captured by browsing as an ordinary
visitor; the standalone host profile is login-gated, so the host material below is
what a logged-out guest actually sees on the listing itself.

## The short version

Airbnb's experience page and ours are the **same skeleton** — gallery, title,
price, availability, a bit about the host, cancellation. The difference is almost
entirely **surfacing data we already hold**. Three of the biggest gaps are things
our wizard already collects and our page simply doesn't render:

- **Duration.** Airbnb shows it everywhere — "Around 1 hr 30 min" as a top-line
  highlight, and "· 1.5 hours" on every card. Ours captures `duration_minutes`
  per item and shows it to the guest **nowhere** (see
  `GUEST-EXPERIENCES-MASSAGE-DURATION-SCOPE.md`).
- **The person's credentials.** For an individual host, Airbnb's "About me" leads
  with a professional title ("Hiking guide and landscape photographer") and a
  first-person bio carrying the credentials ("fully qualified hiking guide… over
  30 years experience"). Ours **captures** `professional_title`, `qualifications`,
  `years_experience` and `recognition` at sign-up — some required — and renders
  **none** of them. `professional_title` is even loaded into the guest data shape
  with a comment saying it's shown, but no JSX renders it. The whole credibility
  layer is dark data.
- **What you'll do, and what to know.** Airbnb gives a step-by-step itinerary and
  a "Things to know" block (age/capacity, activity level, what to bring). Ours has
  a single optional "What happens" paragraph and no things-to-know.

None of the top gaps needs new capture or a new booking mechanic. They are render
gaps. Below is the anatomy, the comparison, and the parts of Airbnb that would be
**wrong** for us to copy.

---

## 1. The Airbnb listing page, section by section

Templated across every type; content varies, structure doesn't.

| Region | What it shows |
|--------|---------------|
| **Above the fold** | Photo mosaic (hero + 3 tiles, one is the host's face), share + save. Title, one-line tagline. **★rating · N reviews · area · category.** Three icon "highlights": **host** (avatar + "Local … host"), **meeting point** (name + city), **duration** ("Around 1 hr 30 min · Hosted in English"). |
| **Booking box** (sticky) | **"From £14 / guest"**, **"Free cancellation · Up to 1 day before start time"**, one **"Show dates"** button. |
| **What you'll do** | A numbered **itinerary** — "Meet your guide → … → Finish at the GoMA", each step a sub-head + a concrete sentence, first person ("I'll point out…"). |
| **Reviews** | ★avg + count, individual reviews: reviewer **first name + city + "5 days ago"** + prose, "Show more"/"Show all". Central, heavy. |
| **Where we'll meet** | Meeting-point name + **full public address** + map. |
| **More experiences in {city}** | A carousel of **other** experiences by area (category · duration · From £X · ★) — discovery/cross-sell. |
| **About me** | Host name/handle, one line ("Local … host" or a **professional title**), **"Message {host}"**, a payment-safety note, and a **first-person bio** that (for individuals) carries the credentials. |
| **Availability** | Dated sessions: **"Today, 15 September / 14:00–15:30 / 16 spots available"**, several per day, grouped by day, "Show all dates". Capacity is visible. |
| **Things to know** | **Guest requirements** (e.g. "aged 18 and over, up to 10 guests"), **Activity level** (moderate/beginner), **What to bring** (a real list), **Cancellation policy** ("Cancel at least 1 day before for a full refund"), and a business/host-responsibility disclosure. |

Price is always **per guest** with a **"From"** prefix (tiers/discounts, e.g.
"~~£25~~ £20"). Duration is always present. Category is a first-class label
(Cultural tours, Tastings, Outdoors, Wellness, Landmarks) and cards tag **"Individual
host"** vs **"Business host"**.

## 2. The host, as a guest sees it

The **standalone profile is login-gated** — a logged-out visitor gets a sign-up
wall. So the guest's whole view of the person is the **embedded "About me"** on the
listing: name (full name or a brand like "Fiona McLean — Scotland Hikes"), a title
line, a first-person bio, a "Message host" button, and the safety note. It leans
**offering-first**, but the person is real: full/known name, stated credentials,
and reviews that name them repeatedly ("Fiona was…"). Cross-navigation to their
other work is **by area** ("More experiences in Edinburgh"), not a "see all by this
host" link on the public page.

---

## 3. Ours, the same way — and the gaps

Our listing (`app/experiences/[bookingId]/[providerId]/page.tsx`) vs Airbnb:

| Element | Airbnb | Ours | Gap |
|---------|--------|------|-----|
| Above-fold identity | Title + tagline + ★ + area + category | Title (`business_name`) + category eyebrow + shape pill | No tagline line; **no rating** (we have none) |
| **Duration** | Top-line highlight + every card | **Not shown at all** (`duration_minutes` is dark) | **Missing — highest-value, data already exists** |
| Price | "From £14 / guest" | `itemPriceLabel` → "£30 pp" / "£45" / "from £18" | Comparable; ours is good |
| Availability | Dated sessions + **spots left** + grouped by day | "Pick a day" → "Pick a time" chips, greyed reasons, "{n} left" | Comparable; ours is arguably cleaner |
| Host / person | Name + **professional title** + **credentials bio** + Message | **First name + headshot + based line only** | **Credentials captured but hidden** (`professional_title`, `qualifications`, `years_experience`, `recognition`) |
| "What you'll do" | Numbered itinerary | Single optional "What happens" paragraph | Thinner; no step structure |
| Things to know | Age/capacity, activity level, **what to bring**, cancel | Cancellation only | **Missing** age/level/what-to-bring |
| Reviews | Central | **None exist** | Missing — but see §4 (don't fake it) |
| Where | **Public meeting address** | "Covers {regions}", exact address **gated to paid** | Intentional difference (privacy) — see §4 |
| Cancellation | "Up to 1 day before" | "Free to cancel up to {h} hours before…" | Comparable; ours is good |
| Photos | Item mosaic + host face | Item mosaic + headshot (no cover field) | Comparable |

### What reads worse than theirs, ranked by what it costs a guest deciding to book
1. **No duration.** A guest can't tell if a "£45" massage is 30 or 90 minutes. We
   hold the number; we hide it. Cheapest, highest-impact fix.
2. **The person is a cipher.** First name + face + town, when we asked them for a
   title, their qualifications, their years doing it and their recognition — and a
   guest inviting a stranger into their holiday cottage is exactly the guest who
   wants that. `professional_title` is loaded-but-unrendered — a latent gap, not
   even a new decision.
3. **No "what you'll do" / "what to bring".** A single paragraph where Airbnb has a
   structured itinerary and a kit list; for an outdoors or a class experience that
   is booking-relevant safety information, not marketing.
4. **No social proof.** Airbnb's reviews are the spine of the page; ours has
   nothing yet. This one is model-shaped, not a render gap (see §4).

---

## 4. What NOT to copy — because our model differs

These are deliberate, and Airbnb's version would be **wrong** for us:

- **Full names / a public standalone profile.** Our providers are **individual
  people shown by first name only** — the byline computes `firstName(...)`
  explicitly to keep a surname from ever reaching a guest. Airbnb shows full
  names/brands and a rich standalone profile. **Do not** add surnames or a public
  per-provider profile page; surface *more of the person* (title, credentials, a
  bio) **within** the first-name, no-standalone-profile frame.
- **Star reviews / "N bookings".** We have no review corpus and, on a ten-property
  soft launch, won't for a while; we already **hide** `bookingsCount` on purpose
  ("New here" loses more than it gives). **Do not** fabricate social proof or show
  a zero. Our trust signal is **"Verified business" / admin-approved** — lean on
  that (Airbnb leans on stars; we lean on vetting). A real review system is its own
  later feature, not a presentation tweak.
- **The "hosts as a business" disclosure.** Airbnb tags business hosts and prints a
  "they're responsible for this experience" line. Our providers are individuals we
  approve, and the **agent-vs-principal question is still open** (host-terms,
  unreviewed by a solicitor). **Do not** copy the business-host legal framing until
  that's decided — the wrong disclosure is worse than none.
- **A public meeting address.** Airbnb prints the exact meeting-point address to
  anyone. Ours deliberately gates the exact address to a **confirmed, paid** order
  and shows only coverage regions before. **Keep** that; do not expose a pre-payment
  address to match Airbnb.
- **City-wide discovery / "More experiences in {city}".** Airbnb is a standalone
  marketplace; ours is bought **against a cottage stay**, so cross-sell is "other
  experiences **for your stay**", not area-wide browsing. Standalone discovery is a
  *different feature* — see `GUEST-EXPERIENCES-STANDALONE-PURCHASE-SCOPE.md` — not a
  presentation change to make here.

---

## Decisions this needs, in dependency order

1. **Surface duration.** Render the per-item `duration_minutes` on the card and the
   listing (a highlight line + on each menu row). Pure render; the data exists.
   *(Recommend: yes, first — cheapest win.)*
2. **Surface the person within our privacy frame** (§3.2): render
   `professional_title` (already loaded — fix the missing JSX), and decide whether
   `qualifications` / `years_experience` / `recognition` become a guest-facing "About
   {first name}" block. Decision: which of the captured fields are guest-safe to
   show (a qualification is; a surname isn't). No new capture.
3. **A "what you'll do" / "things to know"** shape: do we add structured itinerary +
   age/level/what-to-bring fields to the wizard, or render richer prose from what's
   there? This one *may* need new capture — scope the wizard cost.
4. **Trust signal** (§4): confirm "Verified / approved by us" is the line we show in
   place of stars, and that `bookingsCount` stays hidden until there's a real review
   feature.
5. **The host-responsibility disclosure** — blocked on the agent-vs-principal /
   solicitor decision; do not design copy until that lands.

## Not in this doc
- **A reviews/ratings system** — a whole feature (collection, moderation, display),
  not presentation; and premature on a ten-property launch.
- **Standalone/city-wide discovery** — `GUEST-EXPERIENCES-STANDALONE-PURCHASE-SCOPE.md`.
- **The dated-class timetable display** — `GUEST-EXPERIENCES-CLASS-SCHEDULING-SCOPE.md`
  (Airbnb's "spots available per session" is exactly that two-lane display).
- **Exact visual design** — this is a gap analysis; the layout/design pass is
  separate.
