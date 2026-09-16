# How money moves on Galloway Getaways — what's live today

A plain-English account of how money actually moves on the **live site** (the code
deployed to production right now), written for you, not for a developer. At the end
there's a dated list of what has actually changed in the last month, and what's
fixed on a branch but **not yet live**.

## Read this first — no real money has moved yet

Everything below is how the live code behaves. But production is still running
against **Stripe's test mode** — the real card-charging switch has not been flipped.
On the live database today there are five bookings, all cancelled, a handful of
test payments worth pennies, **no payouts at all**, and no experience orders. So
this is how money **will** move the day live mode is switched on; the same code is
being exercised now with test cards. Two consequences worth holding onto:

- **The payout engine has never actually run in production.** It's the biggest
  untested thing, and it's the one that sends money to other people.
- Where I say "known weak spot" below, that's a real flaw in the **live** code. The
  fixes for the worst of them are written but sitting on branches — see the last
  section — so they are **not** protecting production yet.

## A few words used throughout

- **A hold vs a charge.** A card can be *held* (the money is reserved but not taken)
  and then *captured* (actually taken) later — or charged outright. We use a hold
  for experiences (so nothing is taken until the provider says yes) and an outright
  charge for cottages.
- **Our balance vs their account.** A cottage payment lands in **our own Stripe
  account** first; the host is paid later by a separate transfer. An experience
  payment goes **straight to the provider's own Stripe account**, with our
  commission peeled off automatically. Two different shapes, on purpose.
- **Commission.** Cottages: 10% (frozen onto each booking when it's made, so a later
  rate change never rewrites an old booking). Experiences: 10%, taken automatically
  as Stripe's "application fee".
- **The "replay label".** Every money instruction to Stripe carries a label so that
  if the same instruction is sent twice — a retry, a double-click, a cron that ran
  twice — Stripe repeats the first result instead of doing it again. This is what
  stops most double-charges. Where it's missing or weak, I say so.

---

## 1. A cottage booking — deposit now, balance later

**Who's charged, and when.** The guest, in up to two goes:

- **At booking:** they're sent to a Stripe payment page. If check-in is far enough
  off (the balance isn't due yet) they can pay a **25% deposit**; otherwise they pay
  in full. The price is always worked out on our server from the listing and dates —
  never trusted from the browser — and the dates are held for 30 minutes while they
  pay. If they took the deposit option (or the place has a damage deposit), **their
  card is saved** so we can take the rest automatically later.
- **30 days before check-in:** a daily job charges the **remaining balance** to the
  saved card, with the guest not present.

**By what.** An ordinary Stripe charge for the deposit/full amount; an automatic
"charge the saved card" for the balance.

**Where the money sits.** In **our** Stripe account. A cottage stay is our charge,
not the host's — the host gets their share later (flow 5).

**Who gets paid.** Nobody yet at this stage — the money sits with us until the payout
runs the day after check-in.

**What confirms the booking.** We don't trust the guest's browser to tell us they
paid — Stripe tells us directly, in the background. That message marks the booking
paid (or deposit-paid), saves the card details for the balance, and writes a line in
our own payments ledger. The booking only turns "confirmed" off the back of that.

**If the balance can't be taken:** the guest gets a chain of reminders — three daily
tries over **72 hours**, then the booking is cancelled on their behalf and refunded
whatever the cancellation policy allows that day. The one exception: if the failure
is the guest's **bank asking them to approve the payment** (common in the UK, and not
their fault), they get a **week** instead of 72 hours.

**When it goes wrong.**
- The balance charge is carefully protected against taking the money **twice** — it
  records an "attempting" line before it charges and reuses that as the replay label,
  so a job that dies mid-charge replays rather than re-charges. This part is solid.
- **Known live weak spot:** if a guest cancels their stay at the *exact moment* the
  balance job is charging them, the live code can charge the card and then mark the
  now-cancelled booking "paid" — money taken for a stay that no longer exists. The
  fix for this is written but **not live yet** (see the last section). It needs an
  unlucky split-second overlap, and with no real balances running yet it hasn't bitten
  anyone — but it is real.
- If the "confirmed" message from Stripe is ever processed twice, most of the ledger
  is protected, but the code itself notes the balance step "is not safe to run twice"
  in one rare path.

---

## 2. A guest cancelling

**Who's refunded, and how much.** The guest, back to their card. The amount follows
the listing's **cancellation policy** (Flexible / Moderate / Limited / Firm — full
or half refund depending on how far ahead they cancel). Two deliberate rules:

- **The cleaning fee always comes back in full**, even inside the non-refundable
  window — you never charge for a clean that won't happen.
- The refund is **spread across both charges** on a deposit booking (the deposit and
  the balance are two separate Stripe charges, and Stripe won't let you refund more
  against one charge than it took — so the money is given back deposit-first, then
  balance, as one combined refund).

**When.** Immediately, when they cancel — and the money goes back **before** the
booking is marked cancelled, so if Stripe refuses, the guest still has their stay
rather than neither.

**Where it comes from.** Out of **our** Stripe account.

**What else happens.** The dates are freed, a receipt is emailed, and any experiences
booked onto that stay are cancelled and refunded too.

**When it goes wrong.**
- If only part of the refund can be sent, we record what *actually* went back, not
  what was owed, and log the shortfall — a guest is never quietly recorded as made
  whole when they're short.
- **Known live weak spot:** the running total of "how much has been refunded" is
  updated in ordinary code rather than in one atomic database step, so two refunds
  happening at the very same moment (say a guest cancel and a host goodwill refund at
  once) could each overwrite the other's figure — the money all goes back at Stripe,
  but the booking's record could understate it. The fix is written but **not live
  yet** (last section).

---

## 3. A host refunding

Two different things a host can do:

**3a. The host cancels (or declines) the booking.**
- The guest gets **everything still held back**, regardless of the policy tier — a
  host pulling out never keeps the guest's money.
- Because cancelling a confirmed stay is the most damaging thing a host can do, the
  host pays a **5% penalty** (5% of the booking total), taken off their *next* payout
  rather than invoiced. This is recorded as a debt against the host.
- If the host had **already been paid** for this stay, we **claw the money back** from
  their Stripe account (flow 5 explains how that's done safely).
- The dangerous case — money refunded but the booking record fails to update — is
  **surfaced as an error**, not swallowed.

**3b. The host gives a goodwill refund without cancelling.**
- The stay still goes ahead; the host just hands back some money (up to what the guest
  has paid). Same spread-across-both-charges mechanism, and the same clawback if
  they've already been paid.

**Where it comes from.** Our Stripe account (and, for the clawback, back out of the
host's account into ours).

---

## 4. A guest experience (a chef, a masseuse, a class)

**Important:** experiences are currently **switched off to guests** behind a flag
(the host terms aren't back from the solicitor), so **no experience money is moving
on production at all**. This is how it works when it's turned on.

**The key difference from a cottage:** the **provider is the merchant** — the money
goes **straight into the provider's own Stripe account**, and our 10% commission is
peeled off automatically by Stripe. We never hold the provider's money.

**Who's charged, and when — two shapes:**

- **A request (a chef you ask):** the guest's card is **held, not charged**, when they
  request. Nothing moves. The provider then has 48 hours to answer. **Confirm →** the
  hold is **captured** (money actually taken, their share to them, our 10% to us) and
  the guest is told their card's been charged. **Decline →** the hold is released,
  nothing taken.
- **A slot (a sauna at 6pm):** instant. The seat is claimed atomically (so two guests
  can't take the last seat), a 15-minute hold is placed on it, and the card is charged
  outright on the payment page; the booking confirms off Stripe's background message,
  same as a cottage.

**When it goes wrong.** If the payment page is never completed, the seat is given back
by a sweep job and nothing is taken. A provider's goodwill refund unwinds **both** the
provider's transfer and our fee, and reopens the seat.

---

## 5. A host payout — the one that's never run for real

**When.** A daily job pays a host **the day after their guest checks in**.

**How much.** Only what was actually **collected and kept** — what the guest paid,
minus anything already refunded — and then minus our 10% commission. So a partly
refunded stay pays out on the smaller figure, and the headline price is never what's
shared.

**By what, and where from.** A **transfer** out of **our** Stripe account into the
host's own account. To avoid trying to pay a host out of card money that hasn't
settled yet (which would fail on the very first payout), the transfer is tied to the
**guest's own charge** — Stripe draws it against that specific payment.

**Commission.** We simply keep our 10% in our account; only the host's share is
transferred.

**Guarding against paying twice.** Before sending anything, the job checks its own
ledger for a payout it's already made for this stay. If it finds one, it just tidies
up the bookkeeping and sends nothing. This is deliberately **not** left to Stripe's
replay label, because that label expires after 24 hours and this job runs every 24
hours — so the ledger check is the real defence.

**Debts.** Anything a host owes us (a cancellation penalty, a clawback) comes off the
next payout first, and if the whole payout is swallowed by a debt the host is emailed
an explanation rather than left wondering.

**When it goes wrong — the known live weak spot.** The transfer happens at Stripe
**before** the two records that prove it happened are written. If **both** of those
writes fail, the next day's run doesn't know the money went, and — once Stripe's
24-hour replay label has expired — it can send a **second, real transfer**. The code
itself says this window can't be fully closed from our side; it logs it loudly with
the transfer reference so it can be reconciled by hand. Combined with the fact that
this engine has **never run in production**, this is the single thing I'd watch most
closely on the first real payouts.

**Clawback (a refund after a payout).** If money goes back to a guest after the host
was paid, we reverse only what the host can actually afford to give back and carry the
rest as a debt — so their account never goes negative (if it did, Stripe would quietly
recover the same money a second time out of their next transfer).

---

# What has actually changed in the last month — and is live

Dated by when it went live on production. The earliest entries are the original build
of each money route in mid-to-late August; the meaningful changes to how money behaves:

- **18 Aug** — one single source for commission (10%, worked out so host-share + our
  fee always equals what the guest paid to the penny).
- **18–19 Aug** — cancellation policy tiers and refund fractions; the first clawback;
  the **5% host-cancel penalty**; the host-payout job; daily payout schedule.
- **22 Aug** — the balance charge re-keyed on its "attempting" line (the current,
  safer double-charge protection); dispute/chargeback handling; GBP-only checkout.
- **28 Aug** — the cleaning fee is now refunded in full on any cancellation.
- **29 Aug** — one-payment-per-charge protection in the ledger (fixes an old
  double-count where a £300 booking read £450); money routes now verify who you are
  properly (a forged-cookie fix); webhook failures now get logged.
- **31 Aug** — "ten money routes stop failing quietly" (errors surfaced, not
  swallowed); host debts move atomically; the reminder ladder + saved-card balance
  capture + the week-long grace for bank-approval failures; hosts paid out of the
  guest's own charge (the unsettled-money fix).
- **1 Sept** — a retried payout reconciles against the ledger instead of paying twice;
  refunds spread across both charges (fixing deposit bookings that used to refund
  nothing); the slot money path.
- **2–3 Sept** — guest experiences: hold-on-request, capture-on-confirm, and the
  cascade that refunds experiences when a stay is cancelled; London-time date handling
  across balance and payout timing (a British-Summer-Time off-by-one fix).
- **13 Sept** — the host-payout double-pay guard hardened.
- **14–16 Sept** — a run of experience/slot feature merges (per-item durations,
  part-day blocks, mixed menus, standalone marketplace, per-item capacity). These add
  product handling **around** the same charge calls; the charging and commission
  mechanics themselves didn't change.
- **16 Sept** — the per-night price series is now frozen onto each booking (so a
  booking's breakdown can't drift if a price is edited later).

# What's fixed but NOT live yet (sitting on branches)

Three real payment fixes are written but **not merged**, so production does **not**
have them:

1. **The balance-charge / cancelled-stay fix** (flow 1). Stops the balance job from
   charging a card and marking a *cancelled* booking paid; if it happens, the money is
   refunded instead. *Not live.*
2. **The atomic-refund fix** (flows 2 & 3). Makes "how much has been refunded" update
   in one safe database step so two simultaneous refunds can't lose each other's
   figure. *Not live.*
3. **The slot lost-payment fix** (flow 4). Before a slot hold is expired, it asks
   Stripe whether the guest actually paid — so a paid guest whose confirmation message
   went missing keeps their seat instead of losing it. *Not live.*

(There are also a couple of money-**auditing** branches — checking tools, not changes
to how money moves — and one tracking note for a future payout guard that hasn't been
built.)

---

*This describes production as of the current live code. It is a snapshot: the "not
live yet" list is the thing that dates fastest — the moment one of those branches is
merged, it moves up into the live section.*
