# How money moves on Galloway Getaways — live on production

*A plain-English account of how money actually moves on the live site today, written
for you. "Live" means the code currently on production (master, 17 Sept 2026) — not
anything sitting on a branch. Where a branch matters, it's called out.*

---

## Read this first — the one fact that reframes everything

**No real money has moved on production yet.** Stripe is still in **test mode**: the
live database has five bookings (all cancelled), a handful of payments worth pennies,
**no payouts at all**, and **no experiences sold**. Two things follow that you should
hold onto while reading:

- **The payout engine has never run in production.** One host has connected their
  bank details and is ready to be paid, but no payout has ever been sent. It is the
  biggest untested thing in the business and it's the one that sends money to other
  people.
- **Experiences are switched off to guests on production.** The whole experiences
  money model (including standalone purchases) is *in the live code*, but a single
  switch (`GUEST_EXPERIENCES_OPEN`) is off on production and there are zero experience
  providers there — so no guest can actually buy one today. It's built and waiting,
  not running.

So this describes how money **will** move the day the switch is flipped and live mode
is turned on. Today the same code is being exercised with test cards and pennies.

**A few plain terms**, because they recur:
- *A hold vs a charge.* A card can be **held** (money reserved, not taken) and later
  **captured** (actually taken), or **charged** outright. We hold for a chef-style
  experience request; we charge outright for cottages and saunas.
- *Our balance vs their account.* A cottage payment lands in **our own Stripe account**
  first and is paid out to the host later. An experience payment goes **straight into
  the provider's own Stripe account**, with our cut skimmed off automatically — we
  never hold it. These are two genuinely different shapes; section **TWO** is entirely
  about which is which.
- *The "replay label."* Every money instruction to Stripe carries a label, so a repeat
  of the same instruction (a retry, a double-click, a job that ran twice) replays the
  first result instead of doing it again. It's what stops most double-charges. Where
  it's weak, I say so.

---

## The six flows

### 1. A cottage booking — deposit now, balance later

- **Who's charged, and when.** The guest, in up to two goes. At booking they're sent
  to a Stripe payment page and pay either a **25% deposit** (only offered if the
  balance isn't due yet) or the **whole amount**. If they paid a deposit (or the place
  has a damage deposit), **their card is saved**. Then **30 days before check-in**, a
  daily job charges the **remaining 75%** to the saved card automatically.
- **By what.** An ordinary Stripe charge for the deposit/full; an automatic
  "charge-the-saved-card" for the balance.
- **Where the money sits between charge and payout.** In **our** Stripe account — from
  the moment they pay until **the day after check-in**. On a stay booked and paid
  months ahead, that means we hold the guest's money for months. The host isn't paid
  until the day after their guest checks in.
- **Who ends up paid, and what we keep.** The host, the day after check-in, gets their
  share; **we keep 10%** — not as a separate charge, but simply by transferring less to
  the host and leaving our cut in our balance. (Stripe's own card-processing fee comes
  out of our balance too — see the surprises.)
- **What confirms it.** We don't trust the guest's browser — Stripe tells us in the
  background that the payment succeeded, and that message is what flips the booking to
  paid/confirmed and saves the card for the balance.
- **When it goes wrong:**
  - *Card declined (at booking):* no booking is confirmed; nothing is held.
  - *Card declined (the balance, 30 days out):* the guest gets a chain of reminders —
    three daily tries over **72 hours**, then the booking is cancelled and refunded
    whatever the policy allows that day. The exception: if it's the **bank asking the
    guest to approve** the payment (common, not their fault), they get a **week**.
  - *The confirmation message goes missing:* the booking sits unconfirmed until it's
    reconciled — the classic symptom is a payment that succeeded at Stripe while the
    site still shows the booking as pending.
  - *Guest cancels at the exact moment the balance job charges:* **this is a real live
    weak spot.** The live code can charge the card and then mark the just-cancelled
    booking "paid" — money taken for a stay that no longer exists. The fix exists but
    is **on a branch, not live** (see section ONE). It needs an unlucky split-second
    overlap, and with no real balances running it hasn't bitten anyone — but it's real.

### 2. A guest cancelling

- **Who's refunded, and how much.** The guest, back to their card, following the
  listing's cancellation policy (full or half depending how far ahead). Two rules worth
  knowing: **the cleaning fee always comes back in full** (you never charge for a clean
  that won't happen), and the refund is **spread across both charges** on a deposit
  booking (deposit and balance are two separate Stripe charges, and Stripe won't let
  you refund more against one than it took).
- **When / where from.** Immediately, out of **our** balance — and the money goes back
  **before** the booking is marked cancelled, so if Stripe refuses, the guest keeps
  their stay rather than neither.
- **What we keep.** Nothing extra — a guest cancel is not a fee event (the policy
  decides how much they get back; anything non-refundable simply stays where it was).
- **When it goes wrong:** if only part can be refunded, we record what *actually* went
  back, not what was owed, and flag the shortfall. **Live weak spot:** if a guest
  cancel and a host goodwill refund happen at the very same instant, the "how much has
  been refunded" figure is updated in a way that could let one overwrite the other —
  the money all goes back at Stripe, but the booking's record could understate it. The
  fix is **on a branch, not live**.

### 3. A host refunding

Two different things:

- **The host cancels the booking.** The guest gets **everything still held**, whatever
  the policy tier says (a host pulling out never keeps the guest's money). Because
  cancelling a confirmed stay is the most damaging thing a host can do, **the host pays
  a 5% penalty** (5% of the booking total), taken off their **next payout**, not
  invoiced. If the host had already been paid, we **claw the money back** from their
  account (see flow 6). The dangerous case — money refunded but the booking record
  fails — is surfaced as an error, not swallowed.
- **A goodwill refund without cancelling.** The stay goes ahead; the host just hands
  back some money. Same spread-across-both-charges, same clawback if already paid.

### 4. A guest experience booked against a stay (a chef, a masseuse, a sauna)

**On production this is switched off** (the `GUEST_EXPERIENCES_OPEN` flag is off, and
there are no experience providers). This is how it works when on.

- **The big difference from a cottage:** the **provider is the merchant** — the money
  goes **straight into the provider's own Stripe account**, and **our 10% is skimmed
  off automatically by Stripe as an "application fee."** We never hold the provider's
  money; there's no separate payout step for experiences.
- **Who's charged, and when — two shapes:**
  - *A request (you ask a chef):* the guest's card is **held, not charged**, when they
    request. The provider has 48 hours. **Confirm →** the hold is captured, money goes
    to the provider minus our 10%. **Decline →** the hold is released, nothing taken.
  - *A slot (a sauna at 6pm):* instant. The seat is claimed so two guests can't take
    the last one, and the card is charged outright on the payment page.
- **What we keep.** 10%, as a Stripe application fee (a distinct, recorded fee — unlike
  the cottage 10%, which is invisible; see the surprises).
- **When it goes wrong:** a payment page never completed releases the seat and takes
  nothing. **Good news, now live:** if a guest paid for a slot but the confirming
  message went missing, before we expire the hold we now **ask Stripe whether they
  actually paid** and keep the seat if so — so a paid guest isn't left with no booking
  (shipped 10 Sept).

### 5. A standalone experience purchase (no cottage booking)

The honest picture here is split, and it's the one most likely to trip you up:

- **For a slot experience (a sauna), standalone purchase is fully built and in the
  live code.** A signed-in person who has *no* cottage booking can browse an
  experience, pick a time within a 90-day window, **type in their own address**, and
  pay — a real Stripe checkout, with the **provider as merchant of record**, exactly
  like flow 4. It went live in the code on **15 Sept**.
- **For a request/chef-style experience, standalone is not built** — that page says
  "coming soon," and the request route still refuses anything without a cottage
  booking.
- **But on production, none of it is reachable:** the same `GUEST_EXPERIENCES_OPEN`
  switch is off, and there are no providers. So *today* there is no standalone purchase
  happening — it's built (for saunas), waiting on the switch, the providers, and the
  host terms.
- **When it goes wrong / what's untested:** because a standalone buyer has no stay, the
  day-of contact rules (which today only know how to connect a **guest and a host**)
  have no obvious path to release the provider's number to a bookingless buyer — the
  order does capture the buyer's contact for the provider, but the reverse and the
  arrival-window timing were built for stays. Nobody has bought standalone yet, so this
  is untested in anger.

### 6. A host payout — the one that's never run for real

- **When.** A daily job pays a host **the day after their guest checks in**.
- **How much.** Only what was actually **collected and kept** — what the guest paid,
  minus any refunds — then minus our 10%. A partly-refunded stay pays out on the
  smaller figure.
- **By what, and where from.** A **transfer** out of **our** balance into the host's
  own account, tied to the guest's original charge so we're not trying to pay out of
  card money that hasn't settled yet.
- **What we keep.** Our 10% simply stays in our balance; only the host's share is
  transferred. Any debt the host owes us (a cancellation penalty, a clawback) comes off
  first.
- **When it goes wrong — the live weak spot to watch first.** The transfer happens at
  Stripe **before** the two records that prove it. If **both** of those records fail to
  write, the next day's run doesn't know the money went and — once Stripe's 24-hour
  replay label has expired — can send a **second, real transfer.** The code logs this
  loudly for a human to reconcile; it can't be fully closed automatically. Combined
  with the fact that **this engine has never run in production**, the first real
  payouts are the thing I'd watch hardest. (A related guard — refusing to report a
  clean payout when the records didn't write — did go live on 13 Sept.)
- **Clawback (a refund after a payout):** we reverse only what the host can actually
  afford to give back and carry the rest as a debt, so their account never goes
  negative (if it did, Stripe would quietly recover the same money a second time).

---

## ONE — what actually changed on a payment path in the last month

Dated by the day it went **live on production** (merged to master). This is the list to
answer "what's real vs what's on a branch."

**Live (merged), last month:**

| Went live | What changed about money |
|---|---|
| 15 Sept | **Standalone experience purchase** — a bookingless slot buyer can pay a provider directly (flow 5). |
| 14 Sept | A slot provider can offer both studio and travelling sessions; the travelling destination address is frozen onto the order and the seat only released when paid; per-treatment durations; mixed menus. (Product handling around the same charge; not the charge itself.) |
| 13 Sept | **Host-payout double-pay guard hardened** — the run now stops instead of reporting a clean payout when it couldn't write the payout records (flow 6). |
| 12–14 Sept | Experience terms panel; slot per-item capacity/minimum; per-night price series frozen onto a booking; provider self-serve take-down. |
| 10 Sept | **Slot lost-payment reconcile** — before expiring a stuck slot hold, ask Stripe whether the guest actually paid, and keep the seat if so (flow 4). |
| 9 Sept | Guest-experience sign-up wizard rebuild (pricing/field plumbing). |

**Earlier in the window** (the money spine itself): GBP-only checkout (22 Aug); the
balance-charge replay label re-keyed on the attempt (22 Aug); chargeback/dispute
handling (22 Aug); "pay hosts out of the charge that funded them" (31 Aug); "refund the
whole stay across both charges + claw back only money that's really there" (1 Sept); "a
retried payout reconciles instead of paying twice" (1 Sept); the slot money path
foundation (1 Sept). Say the word and I'll date each of these out too.

**Fixed but NOT live — still on a branch (production does not have these):**

- **The balance-charge / cancelled-stay guard** (flow 1's live weak spot). Stops the
  balance job marking a cancelled booking paid, and refunds a charge taken against a
  stay that vanished mid-run. *Not live.*
- **The atomic refund fix** (flow 2's live weak spot). Makes "how much has been
  refunded" update in one safe step so two simultaneous refunds can't lose each other.
  It needs a small database change that isn't on production either. *Not live.*

*(One correction to an earlier note of mine: the "slot lost-payment reconcile" I'd
previously listed as pending is in fact **live** — it shipped on 10 Sept. Its branch is
just stale. That's exactly the confusion this document exists to end.)*

---

## TWO — where we are the merchant of record, and where we are not

This is the part that matters for your terms and your insurance. "Merchant of record"
= whose payment it legally is, and whose name a guest sees on their card statement.

| Flow | Whose Stripe account is charged | Whose name on the statement | Our cut | Where the money sits |
|---|---|---|---|---|
| **Cottage booking** | **Ours** | **Galloway Getaways** | 10%, kept invisibly (we transfer less) | **Our balance**, from payment until the day after check-in |
| **Guest cancel / host refund** | Ours (money leaves our balance) | n/a (a refund) | none | — |
| **Experience — against a stay** | **The provider's** | **The provider's** | 10%, as a Stripe application fee | **Never ours** — straight to the provider, minus our fee |
| **Standalone experience (sauna)** | **The provider's** | **The provider's** | 10% application fee | Never ours |
| **Host payout** | Ours → out to the host | (the host was never on the guest's statement) | we keep our 10% | leaves our balance |

The one sentence to remember: **for cottages we are the merchant — we take the guest's
money, hold it, and pay the host later. For experiences we are not — the provider is
the merchant, their name is on the statement, the money never touches our balance, and
we only ever keep a fee.** The code says this to the guest in as many words on an
experience checkout: *"Galloway Getaways takes the payment on their behalf and is not
the provider."* You are agent on experiences and principal on cottages — and that split
is the thing to get right with the solicitor.

---

## THREE — things you might be surprised by

1. **Nothing has run for real, at all.** No payout has ever been sent; one host is
   connected and ready and has been paid nothing. Every "when it goes wrong" above is a
   real property of the live code, but none has been tested with real money. The
   first real payout is the single riskiest moment ahead.

2. **You hold guests' money — sometimes for months.** On a cottage, the guest's full
   payment sits in **our** Stripe balance from the day they pay until the day after
   check-in. A stay booked and paid in full six months out means we're holding a
   stranger's money for six months. That's a client-money and insurance question, not
   just a technical one.

3. **The 10% is taken two completely different ways.** On a cottage it's *invisible* —
   there is no "commission" object at Stripe; we simply keep it by paying the host
   less. On an experience it's an *explicit Stripe application fee* that Stripe records
   and reports. Same headline number, two different accounting shapes — and only one of
   them shows up as a fee in Stripe.

4. **A fee that's easy to forget: the 5% host-cancellation penalty.** A host who cancels
   a confirmed stay is charged 5% of the booking, taken off their next payout. It's real
   and it's live.

5. **A fee I genuinely can't tell you the answer to from here: who pays Stripe's own
   processing cut on an experience.** On a cottage it clearly comes out of our balance
   (we're the merchant). On an experience — provider as merchant, our 10% as an
   application fee — *who bears Stripe's ~1.5%+20p* depends on Connect settings I can't
   read from the code alone. Worth confirming in the Stripe dashboard before you sign a
   host term that promises the provider "keeps 90%," because they might keep 90% minus
   Stripe's fee, or minus nothing, depending on that setting.

6. **A live discrepancy already on the books.** One host on production shows owing us
   **£0.05** with **no record behind it explaining why** — the fingerprint of a
   book-keeping write that didn't land. It's five pence and almost certainly test
   noise, but it's exactly the shape of "the books and Stripe disagree," sitting on
   production right now.

7. **Two ways the books and Stripe can still disagree, live today:** the balance-charge
   cancelled-stay case (flow 1) and the simultaneous-refunds case (flow 2). Both have
   fixes written and **not yet live**. Until they're merged, a rare unlucky timing can
   leave money moved at Stripe that the booking record doesn't reflect.

8. **A whole business model is built and switched off.** The experiences money path —
   provider-as-merchant, standalone sauna purchases, application fees — is all in the
   live code, tested only with pennies, and held behind one environment switch plus the
   absence of any real providers and the host terms. It works today *only because
   nobody has turned it on.* When you do, that's a lot of untested money-movement going
   live at once — the argument for switching it on with one real provider first.

---

*Snapshot as of production on 17 Sept 2026 (master `223a9883`). The fastest-dating part
is the "not live — on a branch" list: the moment one of those two fixes merges, it moves
up into the live section, and this document is out of date until it's re-checked.*
