# Guest experiences — scope

Scope, not a build. One decision to make before any code, a liability position to
design for rather than assert, and the smallest first version.

Guest trades already exist in the model — `chef`, `cake`, `basket`, `paw`
(`GUEST_TRADES` in `lib/serviceProviders.ts`). They can even be registered today
(the apply route stamps `audience: 'guest'`). What they have never had is a
surface a guest can reach or a way for anyone to be paid. That gap is this.

---

## The decision, first: pay through us, not introduce-and-direct

**Recommendation: the guest pays through us.** It is the heavier build, and I'd
still pick it, because the commission model you've chosen only works that way.

The reason is already written into the code, not invented here. The entire
services side is an **introduction**, deliberately money-free. `lib/serviceEnquiries.ts`
says it in as many words:

> THERE IS NO MONEY IN HERE, AND THAT IS THE POINT. Every trade that reaches
> this flow is on the subscription. The platform takes nothing per job … What
> the platform sells is the introduction. **If a trade that pays commission is
> ever pointed at this file … it means that trade wants a booking instead.**

Every guest trade is on the **commission** plan (`TRADE_PLANS`: chef, cake,
basket, paw = `commission`). So by the architecture's own rule, guest trades are
booking-shaped, not enquiry-shaped. The introduce-and-direct model is the
subscription model wearing a price tag, and it collects nothing per job.

Put the two options against what you actually want — **10% commission per job,
built for commission not markup**:

| | Introduce & pay direct | Pay through us |
|---|---|---|
| Commission per job | **Not collectible.** Money never touches us; we'd be invoicing providers for 10% of cash we can't see, or falling back to a subscription — which is the host model, not what you asked for. | Collected automatically as a platform fee on the charge. This is the only reliable way to take 10% of the provider's own price. |
| Reuses what's built | The enquiry flow (already live). | The host booking rails — Stripe Connect, checkout, the payout cron, refunds — already built and audited. |
| Liability posture | Cleanest by default (we never hold money). | Clean **if structured** (see below). Not automatically dirty. |
| Matches the design | No — contradicts the "commission ⇒ booking" rule. | Yes. |

The thing that makes "pay through us" safe rather than reckless is the choice
you already made: **commission, not markup.** A markup would mean we buy the
service and resell it at a higher price — that makes us the seller, and the
seller carries the liability. A commission taken off the provider's own,
unchanged price means the guest pays what the provider charges, and we take a
cut of the provider's take. That is a platform fee, and it is the single most
important fact keeping us a platform rather than a reseller. Hold that line
hard: the guest must never see a price the provider didn't set.

The honest cost of this choice: it needs Stripe for guest-trade providers,
refunds, cancellations and payouts. Most of that already exists for host stays.
What's genuinely new is provider onboarding to Connect (the critical-path
dependency — see the first version) and a cancellation policy that belongs to
the provider, not us.

---

## Liability: what the design has to do, not just say

Your position — the provider takes liability, we're the platform — is defensible
with money passing through us, but only if the build earns it. Asserting it in
the terms while the flow behaves like a shop does not hold. **This section is
product-and-engineering requirements; the actual consumer-law and liability
position needs a solicitor to confirm before launch, especially the
merchant-of-record structuring and the wording of the terms.** What follows is
what the design must do so that a lawyer has something to bless.

### Does money passing through us undermine it?

Not by itself — but *how* the money passes through decides it. There are two
Stripe Connect shapes, and the host bookings use the weaker one for this purpose:

- **Separate charges and transfers** (what host payouts do today: charge lands
  on our account, the `host-payouts` cron transfers the net to the host's
  connected account). Here **we are the merchant of record.** The guest's card
  statement and receipt say us; we look like the seller. Fine for our own
  cottages. Wrong for someone else's chef.
- **Destination charge with `on_behalf_of`, or a direct charge on the
  provider's account.** Here **the provider is the merchant of record.** The
  receipt names the provider, the money is legally theirs, we take an explicit
  application fee (the 10%). This is the shape that supports "the provider is
  the supplier, we're the platform."

So the requirement is concrete and it is a place where reusing the host model
verbatim would actively hurt us: **guest-service charges must make the provider
the merchant of record** (`on_behalf_of` / direct charge), not the
charge-then-transfer model host stays use.

### What the design must do

1. **Provider is the merchant of record** on every charge (above). The 10% is a
   named platform fee, never a margin baked into the price.
2. **The guest is told who they're contracting with, before they pay, in plain
   words.** Not buried in terms. On the offer, on the checkout button, on the
   receipt, on the confirmation: "You're booking *[Provider business name]*.
   Galloway Getaways takes the payment on their behalf and is not the provider."
   The existing enquiry flow already treats the provider's identity as the
   thing being traded; carry that instinct here.
3. **The service contract is guest ↔ provider.** Our terms say we introduce and
   collect payment as the provider's agent; the provider is responsible for the
   service and for anything that goes wrong with it (food safety for a chef,
   the dog's welfare for pet care — these are real liabilities, not abstract).
4. **Cancellation and refund policy is the provider's,** administered by us. We
   don't invent a platform-wide refund rule that would make us look like the one
   who sold the thing. v1 can keep this minimal (one stated policy per trade,
   refunds actioned by us against the provider's transfer) but it must read as
   *theirs*.
5. **No language that implies we supply it.** "Our chefs", "book our pet care" —
   out. "Local chefs, hampers and pet care near your cottage", "provided by
   [business]" — in. Guest trades already take work photos rather than a logo
   (`imageryFor` → `photos`) precisely because a guest is buying a named
   business's work; that same framing is the liability framing.
6. **Rely on Stripe as the regulated processor, not become one.** Connect keeps
   us out of money-transmission territory the same way host bookings do today —
   worth stating so nobody later "simplifies" it into us holding funds.

The clean test: if a guest, asked afterwards "who did you buy the cake from?",
would say "Galloway Getaways", the design has failed the liability posture,
whatever the terms say. They should say the baker's name.

---

## The smallest first version

The goal of v1 is to prove a guest will pay for a local experience during their
stay, and to collect the commission, without building the whole marketplace.

### Where a guest encounters it

On the **stay they've already paid for** — the highest-intent, most natural
moment, and one we already own. Two candidate surfaces, in order:

- **The booking-confirmed / "Your trip" page.** A guest who has just booked a
  cottage for specific dates in a specific place is exactly the person who wants
  a welcome hamper waiting or a chef for one night. We know their dates, their
  location and who they are — no new acquisition, no cold page.
- (Later) the listing page or an area page, for guests still deciding.

v1 = the trip page only. It reuses the guest's identity, dates and location for
free.

### What the guest sees

- A short, honest row: "Make more of your stay — local chefs, cakes, hampers and
  pet care near [town]." Only the guest trades, only providers who cover their
  cottage's area, only for their stay dates.
- Each provider as a **named business with work photos and their own price** —
  the price they set, unmarked-up. Pick a provider, pick a date within the stay,
  pay through us.
- At checkout, in plain words: who they're booking (the provider), that we're
  taking payment on the provider's behalf, and the provider's cancellation
  policy. Then the existing Stripe checkout, structured `on_behalf_of` the
  provider.
- A confirmation naming the provider, and the provider's contact for the
  arrangement details (when exactly the chef arrives, allergies, the dog's
  routine) — the same "details go both ways on acceptance" the enquiry flow
  already does, but after payment rather than after a yes/no.

### What the provider gets

- A **paid, confirmed order** — not an enquiry to answer. Guest name, contact,
  the date, the cottage, and whatever the trade needs (heads for a chef, the
  hamper contents, the dog's details).
- The money settled to their connected account, **minus the 10%**, on the same
  payout rails hosts use.
- The same "you were paid for this" trail hosts get.

### What v1 reuses vs builds

- **Reuses:** Stripe Connect onboarding (per-profile, same as hosts), the
  checkout route pattern, the payout/refund tooling, the provider model,
  `service_areas` for "near the cottage", the guest-trade vocabulary and pricing
  (`bandsFor` / `serviceCeiling` / `DEFAULT_SERVICE_COMMISSION` already exist).
- **Builds:** the trip-page surface; a guest-order object (booking-shaped, but
  for a service on a date rather than a stay); the `on_behalf_of` charge shape
  (new — host stays don't use it); the disclosure copy; one cancellation policy
  per guest trade.
- **The critical-path dependency:** guest-trade providers must be onboarded to
  Connect and payouts-enabled before a single order can be taken. If none are,
  there is no v1 to ship — so provider onboarding is the first thing to stand up,
  and it gates everything else. Worth confirming how many guest-audience
  providers exist and whether any are Connect-ready before committing to dates.

---

## Open questions for you (not mine to decide)

1. **Commission number** — you said 10%, settle later. `DEFAULT_SERVICE_COMMISSION`
   is already `0.10`; v1 can read it and you change one constant.
2. **Cancellation policy** — is it one platform-wide default per trade for v1
   (simplest, still "the provider's" in framing), or does each provider set
   their own from day one? I'd do the former for v1.
3. **Merchant of record** — confirm the `on_behalf_of` / direct-charge structure
   with the solicitor and with Stripe before it's built; it's the load-bearing
   liability decision and it's cheaper to get right in the schema than to
   migrate later.
4. **Do we take money before or at the point the provider confirms availability?**
   A chef might be booked already for that night. Options: charge on request and
   auto-refund if the provider can't do it (guest-friendly, needs the refund
   path on day one), or a free request → provider confirms → then pay (closer to
   the enquiry flow, delays the commission). This is the one place the "phase
   two shape with a price" model could survive inside a pay-through world, and
   it's worth your call.

---

## One-line answer, if you only read this far

Guest pays through us — it's the only way to collect per-job commission, and the
architecture already says commission trades want a booking. It stays a platform,
not a shop, as long as the provider is the merchant of record, the 10% is a fee
not a markup, and the guest is told plainly whose cake they're buying. Smallest
first version: an offer on the trip page they've already paid for, providers with
their own prices, paid `on_behalf_of` the provider, settled minus 10% on the
rails hosts already use.

---

# Addendum: the Connect step on a guest-trade application

The sign-up half exists — pre-built experiences, provider applies, you approve —
and it never needed Stripe, because a subscription trade never receives money
through us. A guest trade does, and `on_behalf_of` can't charge to an account
that doesn't exist. So the guest-trade application needs a Connect step, and
**"approved" must stop meaning "live."**

Today there is no gap between them: the shop and the enquiry flow gate purely on
`status === 'approved'` (`canBeEnquiredAbout`, and `enquiries/route.ts:92`).
There is no payout concept in the provider model at all. That's the thing to
add.

## Two gates, in order — not one

Split what "approved" currently does into two:

1. **Approved** — the human decision you already make: the business is real, the
   photos and price are right. Unchanged. This is your judgement.
2. **Payout-ready** — Stripe has what it needs to pay them: `payouts_enabled` on
   their profile (the connect route already reads and stores it). This is the
   provider's own KYC with Stripe, not your call.

**Live to guests = approved AND payout-ready.** Approval first (no point asking
someone to hand Stripe their passport before you've said yes), then Connect.

## What the Connect step adds to their sign-up

Mechanically it reuses the hosted flow hosts already use (`POST /api/stripe/connect`
→ Stripe Express onboarding → return). After you approve, their provider
dashboard grows one step: **"Set up payouts"** — a button to Stripe's hosted
onboarding (legal name, DOB, address, a bank account or debit card, ID for KYC),
then back to a payout-status screen. Same machinery as Account → Payments for
hosts.

Two things are genuinely new, not reuse:

- **The account's trade has to fit.** The host account is created with MCC 7011
  and "self-catering holiday accommodation" (`connect/route.ts`). A chef, a
  baker, a hamper-maker and a dog-walker are not lodging — the
  `business_profile` (MCC + product description) has to match the guest trade,
  or Stripe is being told the wrong thing about what's being sold. So the
  account-creation call needs to be parameterised by trade rather than
  hard-coded to hosting.
- **The return lands in the wrong place.** `return_url` / `refresh_url` point at
  `/account?section=payments`. A provider finishing onboarding should come back
  to their provider dashboard, not the host account page — so those URLs need to
  branch, or a shared payout screen serves both.

One flag, not a v1 blocker: `payouts_enabled` lives on the profile (the person),
so a user who is both a host and a guest-provider has **one** connected account.
Fine — but then whose MCC? Unlikely in v1 (guest providers won't usually be
hosts), worth a note before someone hits it.

## What they see if they abandon it half-way

The connected account is created on the first click, so abandoning leaves a real
account that is `details_submitted: false`, `payouts_enabled: false`, with
Stripe listing what's still `currently_due` — all of which the GET route already
reads and stores. Nothing is lost.

Their dashboard shows: **"Approved — one step left before guests can book you:
finish setting up payouts,"** and a *Continue setup* button. That button mints a
**fresh** onboarding link every time (the route already regenerates rather than
storing — Stripe's links are single-use and expire fast), so a stale link is
never a dead end; the `refresh_url` already catches an expired link mid-flow and
bounces them to a new one. They can walk away and come back any number of times;
the application stays approved, no re-approval.

If Stripe asks for more later (verification that only triggers after some
volume), it's the same surface driven by `stripe_requirements_due`: **"Action
needed on your payouts,"** with what's outstanding.

The one hard rule: half-connected is **not live**. They don't appear to guests.

## What a guest sees if a provider is approved but not yet connected

**Nothing — the provider isn't shown.** The guest surface filters on approved
**and** payout-ready, so an approved-but-unconnected provider is simply absent.

That's the whole reason for the second gate: we can't take money `on_behalf_of`
an account that can't receive it, so listing such a provider would be an offer
that fails at checkout. Better an empty category than a broken payment. There is
no "coming soon" card for them — a guest is never shown someone they can't
actually pay.

Same gate covers the account that *was* live and later falls out of good
standing (Stripe re-raises requirements, payouts pause): because the gate reads
the stored `payouts_enabled`, they drop out of the guest surface on their own and
get the "action needed" nudge — rather than a guest paying for a chef whose
payouts are frozen.

So, end to end: **you approve the business → they finish Connect → they go live.
Guests only ever see providers who can be paid; providers always know exactly why
they're not live yet and how to fix it in one button.**
