# Hotels on Galloway Getaways — plan

Letting hotels (not just single self-catering cottages) sign up, list, and sell
rooms on Galloway Getaways. Written from research into Booking.com's extranet,
Airbnb's hotel listings and Expedia Partner Central, plus a full survey of how
our own booking → payment → payout → cancellation → messaging machinery works.

**The whole of this is OFF production.** It lives on branch `feat/hotels`,
against the TEST database and previews only, behind a feature flag
(`hotelsOpen()`) that is held shut on production. No migration is applied to the
production database until Liam says so.

---

## 1. What a hotel needs that a holiday let doesn't

A cottage on this site is **one unit**: one `listings` row, one nightly price,
one calendar, and a database exclusion constraint that makes "this cottage,
these nights" bookable exactly once. A hotel breaks four of those assumptions at
once. From the research, here is everything a hotel genuinely adds:

1. **Multiple room types, each a real object with its own count.** "Double",
   "Family room", "Suite" — each with a *quantity* of identical physical rooms
   (Booking.com `Room/@Quantity`, Expedia room-type objects). This is the single
   biggest difference: a room type is **fungible inventory of N**, not a unique
   unit. Airbnb fakes this by making each room type a separate listing with a
   quantity and grouping them under a property page; Booking.com and Expedia use
   a true `Property → Room type` hierarchy. Our brief asks for the true model.

2. **Per-room-type beds, occupancy, size, amenities and photos.** Bed
   configuration (e.g. 1 king, or 2 twins), max occupancy split into adults and
   children, room size, room-level amenities and room-level photos — all per
   room type, not per property.

3. **Per-room-type rates and availability.** A price and an available-count for
   each room type for each night, not one nightly price for the whole property.

4. **Rate plans.** The commercial offer layered on a room type: *flexible vs
   non-refundable*, and *room only vs breakfast included*. On Booking.com a rate
   plan is almost empty by itself (just a name + optional derivation from a
   parent); all the conditions — meal plan, cancellation policy, prepayment,
   pricing model — hang off a **roomrate** join object that binds one room type
   to one rate plan. This join is the most important structural idea to copy.

5. **Minimum-stay and closed-to-arrival / closed-to-departure rules.** Per room
   type (× rate plan) × date. Booking.com field names: `minimumstay`,
   `minimumstay_arrival`, `maximumstay`, `closedonarrival`, `closedondeparture`.
   We already have min-nights; CTA/CTD and max-stay are new.

6. **Check-in and check-out times** at the property (we have these on a
   listing), plus **hotel facilities** (restaurant, bar, parking, accessibility,
   pets, wifi, pool, …) — a property-wide tick-list, not per room.

7. **Star rating** — self-declared at setup on Booking.com/Expedia. Airbnb has
   none (reviews instead). We will store it but present it modestly.

8. **VAT invoices.** Hotels are usually VAT-registered businesses and need a VAT
   number captured and VAT shown on the guest's confirmation/invoice. (This ties
   into the open agent-vs-principal / VAT-threshold question in the main
   `CLAUDE.md` — flagged, not resolved here.)

9. **Booking several rooms in one reservation.** One reservation / one booking
   reference containing N room lines, each a room type × rate plan × dates ×
   occupancy × price. Booking.com and Expedia both do this; it is a later phase
   for us (phase one books one room type, quantity one).

### What the big platforms deliberately leave out (copy the restraint)

Every platform keeps the **sign-up wizard spare**: one decision per screen,
save-and-resume, amenities and photos deferrable, and *a single base rate is
enough to go live* — rate plans, restrictions and multi-room come after. The
room-type editor is a small fixed set (name, count, beds, occupancy, size,
amenities tick-list, photos; **never a price**, which lives on the rate). The
rates-and-availability calendar is a plain price + rooms-left grid, with
CTA/CTD/min-LOS **hidden behind a toggle** as opt-in power-user fields. This
matches this codebase's standing warning that its pages "keep failing by being
thorough rather than spare" — so the default views stay minimal.

---

## 2. The architectural decision — reuse the money path exactly

**The entire money path keys off one `bookings` row.** Checkout recompute,
Stripe Connect, the webhook dispatcher, `lib/settlePaidBooking.ts`, the
host-payout cron, `lib/clawback.ts`, the balance failure ladder, cancellation,
refunds and messaging all take a single `bookings` row that carries
`guest_id`, `host_id`, a date range, `total_price`, the frozen money/cancellation
snapshots, and the Stripe intent ids. **A hotel stay must therefore become a
normal `bookings` row** — then all of that machinery works unchanged, which is
exactly what "reuse the existing flows exactly, no new mechanisms" demands.

A hotel diverges in **exactly two places**, both rooted in one fact (a room type
is fungible inventory of N, not a unique unit):

- **Availability is counting, not uniqueness.** The cottage model relies on the
  GiST exclusion constraint `bookings_no_overlapping_confirmed` (unique per
  `listing_id` × date range where `status='confirmed'`) and single-unit
  clash/hold/iCal checks. A hotel needs *rooms-sold < rooms-available for every
  night in range*. We do **not** touch or weaken that constraint; hotel bookings
  simply don't participate in it (see the data-model note on `listing_id`), and
  inventory is enforced by a hotel-specific atomic check.

- **Pricing is per-room-type/rate-plan, not one nightly rate.** `lib/pricing.ts`
  `quoteBooking` is built for a cottage's single nightly rate + cleaning/pet/
  extra-guest fees. A hotel needs a room-type rate quote. We add
  `lib/hotelPricing.ts` that returns **the same `PriceQuote` shape** (`total`,
  `nightly[]`, and a snapshot the checkout can freeze) so everything downstream
  is untouched.

**Rule we hold to:** the money-path files on the `WATCHED` fingerprint list
(`scripts/scenario-report.cjs`) and every money-path, fingerprint and privacy
guard stay exactly as they are. The new hotel divergences live in **new**
modules and a **new** checkout route, not by editing the shared cottage money
routes. Where a shared WATCHED file genuinely has to learn about hotels, that is
called out explicitly below as a money-path change (full gate + scenario re-run)
and done deliberately, never quietly — and in phase one we avoid it entirely by
giving a hotel booking its own checkout that produces a standard `bookings` row
the existing webhook/settle/payout already understand.

### How a hotel booking stays a standard `bookings` row

A hotel booking row carries the usual `guest_id`, `host_id` (the hotel's owner
profile, with its own Stripe Connect account exactly like a cottage host),
`check_in`/`check_out` day keys, party counts, `total_price`, the frozen money
and cancellation snapshots, and the Stripe intent ids. It adds:

- `room_type_id` → `hotel_room_types(id)` (which room type was sold),
- `rooms_booked` smallint (phase one: always 1),
- `listing_id` **left NULL** for a hotel booking.

`listing_id` being NULL keeps hotel rows out of the cottage exclusion constraint
(a partial constraint never matches a NULL key) with **zero change to that
constraint**. The downstream money path reads `host_id`, dates and money — all
present — so payout/webhook/settle/cancel/messaging work. The two places that
read `listing_id` directly (settle's instant-book lookup and the oversold
branch) are handled by giving the hotel its own checkout + settle-equivalent
path in later phases; **phase one** uses instant-book semantics and an atomic
inventory decrement at checkout so the cottage settle path is reached with the
booking already confirmed. (This boundary is the one real integration risk and
is called out again in §6.)

---

## 3. The data model

Mirrors the cottage machinery (`§` references are to the listing survey) and the
Booking.com hierarchy. All child tables are keyed by their parent with
`on delete cascade`. New tables are not auto-covered by the two column-grant
guards (those are hardwired to `profiles`/`service_providers`), but the table-,
function- and public-page grant guards still apply, and every new table gets the
full header-comment + RLS + revoke/grant + read-back migration shape from
`20261022130213_wishlists.sql`.

```
hotels                         the property (owner = a profile w/ Stripe Connect)
 ├─ hotel_room_types           a room category, with a count of identical rooms
 │   ├─ hotel_rate_plans*      flexible / non-refundable, room-only / breakfast
 │   └─ hotel_roomrates*       room type × rate plan → meal, cancellation, price
 ├─ hotel_availability*        per room type × date: rooms-left, min-stay, CTA/CTD
 ├─ hotel_access               co-host grants (clone of listing_access)
 ├─ hotel_photos               (text[] of storage paths on the hotel + per type)
 └─ hotel_facilities           (text[] column on hotels)
bookings (existing)            + room_type_id, + rooms_booked, listing_id NULL
```
`*` = later phases (see §6). Phase one ships `hotels`, `hotel_room_types`,
`hotel_access`, and the `bookings` columns, with a single implicit "flexible,
room-only" rate and a nightly price held on the room type.

### `hotels` (property)

Mirrors the sensitive-column discipline of `listings`: public columns readable,
sensitive columns (`street_address`, exact `latitude`/`longitude`,
`ical_token`, `commission_rate`, VAT number) revoked from the browser and
re-exposed through a `hotel_private` SECURITY DEFINER view, read by the owner/
co-host editor. A `hotels_readable` policy returns `status='published' OR
has_hotel_permission(id,'can_listing')`.

Columns: `id`, `owner_id` (→ auth.users; the hotel's host profile),
`status` ('draft'|'pending_review'|'published'|'hidden'), `name`,
`description`, `star_rating` smallint null, `property_type`
('hotel'|'bnb'|'guesthouse'|'inn'|'aparthotel'), `location` (public "Town,
Dumfries and Galloway"), `street_address`/`postcode`/`latitude`/`longitude`
(private), `check_in_time`, `check_in_end_time`, `check_out_time`,
`facilities` text[] (restaurant/bar/parking/pets/accessibility/wifi/pool/…),
`house_rules`, `cancellation_policy`, `cancellation_custom_days`,
`vat_registered` bool, `vat_number` (private), `commission_rate` (private),
`images` text[] (storage paths, cover first), `created_at`.

### `hotel_room_types`

`id`, `hotel_id`, `name` ("Double room"), `description`, `inventory_count`
smallint (how many identical rooms — the availability ceiling), `max_adults`,
`max_children`, `max_occupancy` (≤ adults+children, Booking.com's rule),
`size_sqm` null, `bed_config` jsonb (e.g. `[{type:'king',count:1}]`),
`amenities` text[], `images` text[] (room-level photos),
`price_per_night` numeric (phase one base rate; moves to the rate plan in a
later phase), `min_nights`, `sort_order`, `active`, `created_at`.

### Later-phase tables (designed now, built later)

- **`hotel_rate_plans`**: `id`, `room_type_id`, `name`, `meal_plan`
  ('room_only'|'breakfast'|'half_board'|'full_board'), `refundable` bool,
  `cancellation_policy`, `cancellation_custom_days`, `non_refundable`,
  `parent_rate_plan_id` null, `derive_percent` null (Booking.com's derived-rate
  model for flexible↔non-refundable pairs), `active`. Mirrors the Booking.com
  "thin rate plan" idea; conditions live on the roomrate.
- **`hotel_roomrates`**: the room-type × rate-plan join carrying `price_source`
  ('standard'|'occupancy'|'los'), price, meal inclusions, cancellation policy id.
- **`hotel_availability`**: `room_type_id`, `date`, `rooms_open` smallint,
  `min_stay`, `min_stay_arrival`, `max_stay`, `closed_to_arrival`,
  `closed_to_departure`. The counting model that replaces the exclusion
  constraint. In phase one, availability is derived live (inventory_count minus
  confirmed hotel bookings overlapping each night) rather than stored.

### `bookings` additions (one migration, additive, nullable)

`room_type_id uuid null references hotel_room_types(id)`,
`rooms_booked smallint null`. Both NULL for every existing cottage booking, so
nothing about the cottage path changes and no money-path guard is touched.

---

## 4. The sign-up / onboarding flow

Booking.com's structure, our design, and built on this codebase's existing
onboarding pattern (`app/addhome/page.tsx`): one `draftFields()` builder, direct
`supabase.from('hotels').insert/update` for ordinary columns with
`status:'draft'`, `/api/hotels/save` for columns the browser may not write,
`/api/hotels/publish` as the sole status-setter with a `pending_review` gate.
Reuse `EmailFirstStep`, `requireName`, `AgreementTick`, `PropertyTypePicker`,
`compressImage`/`photoRules`, and the autosave + write-lock pattern verbatim.

Steps, in Booking.com's dependency order but spare:

1. **Property basics** — property type (hotel/B&B/guesthouse/inn/aparthotel),
   name, star rating (optional, self-declared).
2. **Location** — address (typed by hand, geocoded server-side, as `/addhome`
   does; the paid address lookup is not used here — on TEST/preview it answers
   from a fake for `ID1 1QD` anyway).
3. **Room types** — add one or more: name, how many rooms of this type,
   beds, max adults/children, size (optional). *This is the hotel-shaped step
   `/addhome` has no equivalent of.* At least one room type required to publish.
4. **Facilities** — property tick-list (restaurant, bar, parking, pets,
   accessibility, wifi, pool, …).
5. **Photos** — property photos (+ optionally per-room-type photos), min count
   mirroring the cottage rule, uploaded immediately to a `hotels` storage bucket.
6. **Policies** — check-in/out times, cancellation policy, house rules, VAT
   registration + number.
7. **Price** — a nightly price per room type (the base rate; rate plans later).
8. **Review & publish** — summary, host agreement tick, Publish → `/api/hotels/
   publish` → `status='pending_review'`, admin approves at `/admin/hotels`.

The guest-facing hotel page and the room-type editor are both built to look at
Booking.com's real screens first (per the "go and look at a real one" rule),
rendered in our own design and our one **lifted-card** style on a `bg-slate-50`
page — no second card variant, and **no "today" marker** on any calendar.

---

## 5. What is reused vs what is new

**Reused unchanged (no edits to these files):**
- The `bookings` row and its money/Stripe/commission/cancellation columns and
  snapshot discipline.
- Stripe Connect model (`profiles.stripe_account_id`, Express accounts,
  separate charges & transfers).
- `app/api/stripe/webhook` dispatcher + `stripe_events` dedupe +
  `lib/settlePaidBooking.ts` compare-and-set (a hotel stay is just another
  `checkout.session.completed` with `metadata.booking_id`).
- `app/api/cron/host-payouts` + `lib/clawback.ts` + `lib/payoutSource.ts` +
  `lib/payoutTiming.ts` (all key on one booking row).
- `lib/cancellation.ts` + `refundDue` + `lib/fees.ts` + `lib/refundSpread.ts` +
  `record_booking_refund` RPC + the balance failure ladder.
- The messaging thread — a hotel booking is `booking_id`-keyed, existing RLS and
  co-host permission functions already apply. **No new messaging mechanism.**
- Shared libs reused as-is: `lib/stayRules.ts`, `lib/availability.ts` (adapted
  input), `lib/postcodeGeocode.ts`, `lib/places.ts`, `lib/address*.ts`,
  `lib/listingSafety.ts`.

**New (hotel-specific, additive):**
- `lib/hotels.ts` — the `hotelsOpen()` feature flag + hotel domain rules.
- `lib/hotelPricing.ts` — room-type pricing returning the same `PriceQuote`
  shape `lib/pricing.ts` produces.
- `lib/hotelAvailability.ts` — the inventory-counting availability model.
- `lib/hotelAccess.ts` — clone of `lib/access.ts` (table `hotel_access`,
  `checkHotel`, `isFullAccess`, `ownerOrFullAccess`) + SQL
  `has_hotel_permission(hotel, perm)` wired into every hotel write policy, the
  same way `lib/providerAccess.ts` cloned it for the services vertical.
- Pages: `app/hotels/[id]` (public listing), `app/hotels/browse`, `app/addhotel`
  (sign-up), `app/edit-hotel/[id]` (editor, later phase), `app/admin/hotels`.
- API: `app/api/hotels/save`, `/publish`, `/checkout`, `/availability`.
- Migrations for the new tables; a seed `scripts/seed-hotel.mjs` on a **new**
  reserved `@gallowayhotel.test` domain.

---

## 6. Phases

**Phase 1 (this branch) — sign-up → a viewable, bookable single-room-type hotel
on preview.**
- Feature flag `hotelsOpen()` (off on prod, on in preview/TEST), nav link gated.
- Migrations (TEST only, not applied to prod): `hotels`, `hotel_room_types`,
  `hotel_access`, `hotel_private` view, read policies, `has_hotel_permission`,
  and the two additive `bookings` columns.
- Sign-up wizard `app/addhotel` through publish → `pending_review` → admin
  approve.
- Public hotel page `app/hotels/[id]` with room types and a booking panel for
  one room type.
- `lib/hotelPricing.ts` + `lib/hotelAvailability.ts` (live-derived counting).
- `app/api/hotels/checkout` — recompute price server-side, atomic inventory
  check, create a standard `bookings` row (instant-book semantics,
  `room_type_id` set, `rooms_booked=1`, `listing_id` NULL), create the Stripe
  Checkout Session with `metadata.booking_id`, and let the existing webhook +
  `settlePaidBooking` confirm it. **Known integration boundary:**
  `settlePaidBooking` reads the booking's listing for instant-book + the
  oversold branch; phase one confirms inventory atomically at checkout and uses
  instant-book semantics so the row is safe to settle. If any shared WATCHED
  file must change to read a hotel booking cleanly, that is a money-path change —
  full gate + scenario re-run — and is flagged to Liam, not done silently.
- Seed `scripts/seed-hotel.mjs` + a test hotel + host login.

**Phase 2 — rate plans & restrictions.** `hotel_rate_plans` + `hotel_roomrates`
(flexible vs non-refundable, room-only vs breakfast), per-rate cancellation,
min-stay / CTA / CTD. Rates-and-availability calendar editor with restrictions
behind a toggle. Price moves from the room type to the roomrate.

**Phase 3 — multi-room reservations.** One reservation containing N room lines;
decide whether to model as N `bookings` rows (simplest reuse of payout) or one
row + a `booking_rooms` child. Store the counting-availability table
(`hotel_availability`) rather than deriving it, once concurrency at scale
warrants it.

**Phase 4 — VAT invoices & the agent/principal question.** Proper VAT invoice
on the guest confirmation; resolve how commission + VAT interact given the
open agent-vs-principal question in `CLAUDE.md`. Solicitor review of hotel terms.

**Phase 5 — channel managers (biggest, forward-looking).** Hotels run on
channel managers (SiteMinder, Little Hotelier, eviivo, Cloudbeds, Guestline,
Beds24). iCal does **not** scale to multi-room-type inventory (it carries
blocked dates only — no rates, no restrictions, no per-room counts, "one
calendar = one room"), so the current iCal sync is not a path for hotels.
Integration means becoming a **channel** that each CM pushes ARI (Availability,
Rates, Inventory) to and that returns reservations — the OpenTravel/HTNG XML
ARI model (`OTA_HotelInvCountNotifRQ` / `RateAmountNotif` / `AvailNotif`), one
certified connection per CM, each behind a partner agreement, PCI/PII
compliance and a ~60-day certification. Prototype against **Beds24** (open API)
first. This is a per-vendor engineering + commercial effort, scoped on its own
later.

---

## 7. Safety, flags and guards

- `hotelsOpen()`: `if (process.env.VERCEL_ENV !== 'production') return true;
  return flagIsTrue(process.env.HOTELS_OPEN);` — read server-side in both the
  pages and the API routes, never `NEXT_PUBLIC_`. Add `HOTELS_OPEN` to
  `app/api/health/flags/route.ts` (reports set/open, never the value) and a flag
  test modelled on `tests/business-signups-flag.test.ts`.
- Migrations are generated with `node scripts/new-migration.mjs`, follow the
  wishlists shape (header → table → indexes → RLS → revoke/grant → comment →
  erasure patch if personal data → `notify pgrst` → read-back), applied to
  **TEST only** via `scripts/migrate.mjs --target test --apply`. **Nothing is
  applied to production** until Liam says so; when that time comes it goes
  prod-first via `scripts/migrate.mjs` from this branch, per `CLAUDE.md`.
- `hotels.vat_number` and the owner's details are personal/sensitive data →
  revoked from the browser, behind the `hotel_private` view, and the hotel
  tables added to `admin_anonymise_account` erasure where they hold personal
  data.
- A new co-host reaching hotel pages means every hotel **write** is gated by
  `has_hotel_permission(...)` in its RLS policy (the standing rule from
  `CLAUDE.md`), not just the page.
- Money-path guards, fingerprint checks and privacy guards are **not touched**.
  If hotels ever moves money through a new file, that file is added to `WATCHED`
  and the scenario suite re-run.

---

## 8. Open questions for Liam (not blocking phase one)

- **Agent vs principal / VAT** (phase 4): unchanged from the main open question;
  affects whether we show VAT as ours or the hotel's on the invoice.
- **Who is the "host" of a hotel** — a single owner profile with a Stripe
  Connect account (phase one assumes this, mirroring a cottage host), or a
  business entity with staff? Phase one uses an owner profile + `hotel_access`
  co-hosts, which matches how cottages and service providers already work.
- **Multi-room modelling** (phase 3): N booking rows vs one row + child lines —
  decided when we build it, noted above.
