# Buying an experience without a stay — scope

Scoping doc (GitHub issues are disabled on this repo). Today an experience can
only be bought **against a cottage booking**: the stay is where the guest, the
dates and the address come from, and every order carries the `booking_id` that
anchors them. This scopes letting **anyone** buy — a local booking a massage, a
day-tripper booking a class — with no stay behind it.

**Status: scoped, NOT started.** No code. This records what the stay silently
provides today, and what a standalone purchase has to supply in its place.

## The short version

An experience order is not a standalone thing today; it is a **child of a stay**.
Both order engines demand a `booking_id` the buyer owns
(`app/api/services/order/route.ts:67`, `app/api/services/slots/book/route.ts:57`),
and from that one booking they take **four things without asking**: who the guest
is (`booking.guest_id === user.id`), when it may happen (the check-in/check-out
window), how many people (`booking.guests`), and where it happens (the cottage,
via `booking.listing_id → listings`). Nothing about the location is stored on the
order — it is re-derived from the listing at read time
(`app/experiences/order/[orderId]/page.tsx:88-109`).

So "anyone can buy" is not a checkout change. It is **rebuilding the four things
the stay was quietly supplying**, plus one rule that has no standalone form at
all: the day-of contact release, which only knows how to pair a **guest with a
host**, never a provider with a bookingless buyer. The money-collision core (the
hold/capture, the slot seat claim, the interval overlap) is untouched — this is
about severing the stay as the source of identity, place and permission, not
about how the money moves.

The one genuinely new piece of data is a **guest-entered address**: a standalone
"comes to you" experience has no cottage to go to, and there is nowhere on the
order to put one today (`service_orders` has no address column).

---

## 1. What the stay supplies today, and what replaces it

| The stay gives | Where it's taken | Standalone replacement |
|----------------|------------------|------------------------|
| **Guest identity** — `booking.guest_id === user.id`, ownership-gated | `order/route.ts:84`, `slots/book/route.ts:69` | Who is the buyer? (see §2 — the pivotal decision) |
| **Valid dates** — the service date must fall in `[check_in, check_out)` | `order/route.ts:134-142`, `slots/book/route.ts:103-108` | A new validity rule: lead time, and "the session is in the future" |
| **Head count** — `booking.guests` onto the order | `order/route.ts:228`, `slots/book/route.ts:276` | Asked at checkout, or implied by the item's per-person quantity |
| **The address** — cottage, via `booking.listing_id → listings` | `order/[orderId]/page.tsx:88-109,243-244` | A guest-entered destination address for "comes to you" (new column); studio/collection rows already carry the provider's address |
| **Contact release** — the confirmed+paid stay opens phone/email/address | `profile_private`, `stayWindow.ts`, `bookingEntitlement.ts` | A standalone contact rule (see §5 — the hardest one) |

The pattern: the stay was a bundle of **identity + place + permission**. Standalone
has to name each of those three explicitly, because none of them falls out of a
`booking_id` any more.

---

## 2. Who the guest is — the decision everything hangs on

Today the guest is a **logged-in user** who owns the booking: `guest_id = user.id`,
checked against `booking.guest_id`. The order then snapshots their name, phone and
email from their profile — written by the webhook at purchase
(`app/api/stripe/webhook/route.ts:447-484`), honouring `show_full_name`. That
snapshot is **not** gated by the stay window; it is frozen on the order regardless
of stay status, which is convenient here — it already gives the provider a name
and a contact without touching `profile_private`.

The fork:

- **Account required.** A standalone buyer signs in (or signs up) first, so
  `guest_id` still exists and the profile snapshot still works unchanged. Smallest
  change; keeps one identity model; adds a sign-up wall in front of a cake.
- **Guest checkout.** No account — collect name/email/phone at checkout and write
  them straight onto the order. Then `guest_id` is null, and everything that keys
  off a user id (the guest's own "my orders" view, the message thread's
  `auth.uid()` pairing, re-notifying them) needs an anonymous-buyer path.

**My read:** account-required for v1. It keeps `guest_id` real, so the profile
snapshot, the message thread and "my bookings" all keep working, and it defers the
anonymous-identity problem (which is most of the messaging/contact complexity)
rather than solving it at launch. Guest checkout is a fast-follow, not a
foundation. This decision gates §5 and much of §6, so it is first.

---

## 3. The address — the one new fact

`service_orders` has **no address column** (confirmed across both writers). For a
"comes to you" order the destination is the cottage, read live from
`listing.street_address` via `order.listing_id`
(`order/[orderId]/page.tsx:243-244`). Standalone has no listing, so:

- **A guest-entered address becomes a real field on the order** — but only for the
  shapes that travel to the guest (`delivery` / travelling slot). A studio class,
  a collection cake, or a come-to-me massage needs the **provider's** address
  (already carried, released on payment via the `charged` gate,
  `order/[orderId]/page.tsx:135-141`), not the guest's.
- This mirrors the per-item location scope
  (`GUEST-EXPERIENCES-SLOT-LOCATION-SCOPE.md`): direction decides whose address is
  the delivery point. Standalone adds the case where the guest's end of a
  travelling order is **typed in**, not inherited.
- It should be **frozen on the order** like the other snapshots (`item_name`,
  `unit_price`, `duration_minutes`), not re-derived — there is no listing to
  re-derive it from, and a guest's address is exactly the kind of thing that must
  say what it said at purchase.

---

## 4. The date-validity rule

The only thing standing between "book any date" and chaos today is "the date is
inside your stay" (`order/route.ts:137`). Remove the stay and that check has no
bounds. A standalone order needs its own rule:

- The session/date must be **in the future** (the slot route already checks this,
  `slots/book/route.ts:125`; the request shapes rely only on the stay window and
  would need it added).
- The provider's **lead time** (`lead_time_days`) still applies for made-to-order.
- For a slot, the existing session generation + interval-overlap engine already
  bounds "when is bookable"; standalone just widens the date range it is asked over
  (today `loadMarketplace` clamps it to the stay, `lib/experiencesData.ts:168-169`)
  to some horizon rather than a stay window.

No money-correctness weight here — it is bounds, not collisions. But it is a real
gap: without the stay window, "any date" is the default until a rule is written.

---

## 5. Day-of contact — the coupling with no standalone form

This is the hardest part and the reason this is a scope, not a task.

The release of phone/email/address between two people runs through **one rule that
only knows guest↔host**:

- `bookingReleasesPrivateData` — `status === 'confirmed' && payment_status in
  (paid, deposit_paid)` (`lib/bookingEntitlement.ts`).
- `profile_private` view — releases the counterparty's `email, phone,
  residential_address` **only** through a confirmed+paid booking that pairs
  `guest_id` and `host_id` with `auth.uid()`
  (`supabase/migrations/20260903171533_...:39-45`). **There is no provider↔guest
  branch at all.**
- `contactNumberVisible` — even for guest↔host, phone only opens within ±1 day of
  arrival and before the stay ends (`lib/stayWindow.ts:73-98`).

So a **provider and a bookingless buyer are never a guest↔host pair**: neither
`profile_private` nor `contactNumberVisible` will ever release contact between
them. Today the experience thread sidesteps this by **snapshotting**
`guest_phone`/`guest_email` onto the order at purchase (§2), so the provider does
already get a contact — but the guest getting the *provider's* number day-of, and
the whole "±1 day before arrival" window, are stay-shaped and have no analogue
when there is no stay.

The decisions:

- Does the provider↔guest contact release stay as a **per-order snapshot** (what
  already happens — provider sees the buyer's contact from purchase), extended so
  the buyer likewise sees the provider's contact near the session? That avoids
  `profile_private` entirely and is the smallest safe path.
- What replaces the **arrival window**? There is no stay to arrive at. The natural
  substitute is the **session time** — release contact from, say, a day before the
  session until it ends — but that rule has to be written; `stayWindow.ts` cannot
  be pointed at a session it knows nothing about.

**My read:** keep contact as an order-scoped snapshot (provider already gets it;
add the reverse), and define a **session-time window** to replace the arrival
window. Do **not** try to extend `profile_private` to provider↔guest — that view
is the guest/host privacy core and standalone experiences should not widen it.

---

## 6. Checkout, confirmation, and what the provider sees

- **Entry point.** The only way into the marketplace today is
  `/experiences/[bookingId]` (`app/experiences/[bookingId]/page.tsx`), and
  `loadMarketplace` returns nothing without an owned booking
  (`lib/experiencesData.ts:105-118`). Standalone needs a **bookingless storefront**
  — browse a provider/experience directly, pick a date, check out — that never
  passes through a `bookingId`.
- **The launch lock still applies.** `guestExperiencesOpen()`
  (`lib/serviceOrders.ts:32-34`) gates both order routes; a standalone path must
  read the same flag, so the whole feature stays behind the one switch.
- **Confirmation emails already carry no address** (`experienceCancel.ts:26-64`,
  `respond/route.ts:31-77`) — only business name, date, amount. So standalone
  confirmations largely work as-is; the gap is the guest-entered address (§3) that
  a "comes to you" provider needs to actually turn up.
- **What the provider sees.** The provider order/thread view shows the buyer's
  name, the item and the date, and **no address today**
  (`app/services/messages/order/[orderId]/page.tsx:31-33`). A travelling
  standalone order must surface the **guest-entered address** to the provider (they
  cannot deliver to an address nobody shows them) — a new line on the provider
  order view, released on payment the way the collection address is to the guest.

---

## 7. Cancellation sits outside the stay cascade (mostly fine)

`cancelStayExperienceOrders` refunds experiences by `booking_id` when a **stay** is
cancelled (`lib/experienceCancel.ts:67-73`). A standalone order has no booking, so
it simply lives outside that cascade — which is correct (there is no stay to cancel
it with). The direct order paths — the provider's `refund`/`decline`
(`orders/respond/route.ts`) and the guest/expiry cancels — key on the **order id**,
not the booking, so they keep working standalone unchanged. Worth stating so nobody
tries to wire standalone orders into the stay cascade.

---

## Decisions this needs, in dependency order

1. **Is a standalone order the same object?** Extend `service_orders` (make
   `booking_id`/`listing_id` nullable, add a guest-address field) vs a new table.
   Everything else assumes the answer. *(Recommend: same table, nullable links.)*
2. **Who is the buyer?** Account-required vs guest checkout (§2). Gates identity,
   the profile snapshot, messaging, and "my orders". *(Recommend: account-required
   for v1.)*
3. **The guest-entered address** (§3): which shapes require it, as a frozen order
   column, released to the provider on payment. Depends on 1.
4. **The date-validity rule** (§4) that replaces the stay window: lead time +
   future-session, and the browse horizon. Depends on 1.
5. **The contact-release rule** (§5): order-scoped snapshot both ways + a
   session-time window replacing the arrival window. Depends on 2 (who the buyer
   is) and is the money-adjacent privacy decision — a human on it.
6. **The bookingless storefront + checkout** (§6): a marketplace entry with no
   `bookingId`, still behind `guestExperiencesOpen`. Depends on 1–4.
7. **Provider order view** (§6): surface the guest-entered address to a travelling
   provider. Depends on 3.

## Not in this doc
- **Guest checkout (no account)** — deferred by decision 2; it reopens messaging,
  re-notification, and "my orders" for an anonymous buyer, and is a fast-follow.
- **Payments mechanics** — the hold/capture and slot seat claim are unchanged; only
  the entry point and the anchoring change.
- **Standalone experiences discovery/SEO** — how a bookingless storefront is found
  (a public experiences directory) is a product surface, not scoped here.
- **The stay-coupled path stays** — this adds a standalone path beside the
  against-a-stay one; it does not replace it.
