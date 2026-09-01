# Guest experiences: one form for anyone

**Status:** agreed, not yet built. This note is the shape.

## The decision

Stop presetting the guest trades. A wild-swimming guide, a whisky tasting, a
stargazing walk and a willow-weaver are all things a guest would book, and none
of them are on a list I could have written in advance. Presetting the list means
only the businesses I imagined can sign up.

So: **one form for anyone offering something to guests.** They describe the
business, name their items and prices, and set their area. The *category* — the
word a guest reads, the Stripe code we charge under, whether they hold a date
exclusively — is something **I assign when I review them**, not something they
pick from my list.

This is not a new flow. The `other` trade already works exactly this way: no
preset word (`custom_label`), no preset code (`stripe_mcc`), both assigned at
review. The change makes `other` the **only** guest shape rather than the
exception. Most of the work is deletion.

## Decisions locked

- **Audience is an explicit fork, not inferred.** The first question is one
  choice: *"something for guests staying in a cottage"* or *"a service for
  cottage owners."* Inferring it from which page someone landed on means a person
  who follows a friend's link ends up on the wrong payment model without being
  asked — and commission vs subscription is a real difference in what they pay.
- **Rename `other` → `guest`.** "Other" meant something as an exception; when
  everyone is other, the word tells the next person reading the code nothing.
  There are **zero guest providers on production**, so this costs a rename now
  instead of a year of confusion.
- **`exclusive_per_date` becomes a flag I set at review**, a checkbox beside the
  MCC picker. A private chef or a massage therapist wants one-per-cottage-per-date;
  a baker does not. It stops being hardcoded to `trade = 'chef'`.

## 1. The sign-up, without a picker

Today step one is the trade-tile grid — pick "Private chef", "Cakes & baking",
"Hampers & shopping" or "Something else" — and that pick silently drives the
audience, the payment model, the Stripe code and the shape of the price editor.

After:

- **The trade grid is gone for guests.** In its place, the explicit audience fork
  above. Picking "something for guests" sets `audience = 'guest'` directly and
  `trade = 'guest'` as a placeholder; it no longer carries a category.
- **The rest of the wizard is unchanged**, because it is already gated on
  *audience*, not trade: who you are (name, a line, a photo), your photos, your
  area, your menu. None of those steps ask what kind of business you are.
- **One menu editor for everyone.** Today the editor branches `single = trade ===
  'chef'` to give a chef one "your experience" price and everyone else a menu.
  With no chef trade, everyone builds a menu; a chef adds one item, and a
  one-item menu already renders as a single price on the card. The placeholders
  ("Celebration cake", "Welcome hamper") stop being keyed on trade and become
  generic. This is a simplification, not new work.

The applicant never sees a category field. They describe their business in their
own words, and those words are what I categorise from.

## 2. What I see at review

Today the "assign a category" panel only appears for `trade === 'other'`
([ProviderReviewRow.tsx:296](components/admin/ProviderReviewRow.tsx:296)), and the
approval blocker only fires for `other`
([serviceProviders.ts:1975](lib/serviceProviders.ts:1975)). For every other guest
trade the code and the word came from the fixed tables automatically, and Approve
was never gated on a category decision.

After, categorisation is **universal for guest providers**:

- Every guest application arrives uncategorised. I set the **guest-facing word**
  (`custom_label`), the **Stripe MCC**, and now the **`exclusive_per_date`
  checkbox**, all in one panel.
- **Approve stays blocked until the word and code are set.** The blocker moves
  from `trade === 'other'` to `audience === 'guest'`. (See §"Waiting" — this is
  why there is no approved-but-invisible state.)
- **The MCC dropdown has to grow up.** `ASSIGNABLE_MCCS` is a short curated list
  today, aimed at the occasional oddity. Once every guest flows through it, it
  must carry chef (5811), bakery (5462) and grocery/hamper (5411) as first-class
  choices, not just the long tail.
- **The applicant's own description belongs front-and-centre** in the review row,
  because I am categorising from their words, not from a label they picked.

**The honest cost of the whole change lives here.** Three of four guest signups
used to categorise themselves. Now every one needs a decision from me.

## 3. What the guest sees on the card

Almost nothing changes. The card eyebrow is `guestCategory(p)`
([serviceProviders.ts:1999](lib/serviceProviders.ts:1999)); today it picks the
trade's label for a fixed trade and `custom_label` for `other`. After, it is
**always** `custom_label` — the word I assigned: "Cakes & baking", "Wild
swimming", "Whisky tasting". The card leads with the person, the photos and the
menu, none of which touch trade, and the collapsed menu already works regardless.

The one behaviour to keep in mind: a provider with no assigned MCC is filtered
out of the guest list ([experiences route:134](app/api/services/experiences/route.ts:134)).
That is already true for `other` and it is the right fail-closed default —
**approved-but-uncategorised = invisible** — but because Approve is gated on
categorisation, that state can't actually occur (see below).

## 4. What breaks in the trade-branching code

Mostly deletions and generalisations:

| Today | After |
| --- | --- |
| `GUEST_TRADES = ['chef','cake','basket','other']` | collapses to the single `'guest'` sentinel |
| `audienceForTrade(trade)` derives audience | audience is set directly at the fork; the ~6 wizard call sites become "is this the guest flow" |
| `TRADE_MCC` / `mccForTrade` fixed guest codes | dead for guests; `mccForProvider` already prefers the row's `stripe_mcc`, so it keeps working untouched |
| `guestCategory` branches on `other` | always `custom_label` |
| `planForTrade` picks commission vs subscription | constant for guests (all guest = commission; verified) |
| `categoryBlockers` fires for `trade === 'other'` | fires for `audience === 'guest'` |
| editor `single = trade === 'chef'` | one menu editor for all |
| trade-tile grid (guest branch), `TRADE_ICONS` guest entries | deleted |

**The one thing that is not deletion — the build this forces:**
`exclusivePerDate` is hardcoded to `trade === 'chef'`
([serviceOrders.ts:316](lib/serviceOrders.ts:316)), read by the order pre-check
([order route:119](app/api/services/order/route.ts:119)) and enforced by a partial
unique index (`where trade = 'chef'`, migration `20260901160000`). With no `chef`
trade there is nothing to key on. Replace it with a per-provider
`exclusive_per_date boolean`, set at review; rekey the index to
`where exclusive_per_date`. Small migration, one checkbox, correct generalisation.

**Explicitly untouched:** the entire host/enquiry side (plumber, skills, gas/oil,
registrations, subscription, rate bands) still branches on trade and stays as it
is. And the money path — hold, capture, 10% commission, refund — reads the
provider's MCC and the order's own snapshot, never the trade, so the webhook, the
order, respond and cancel routes need no change beyond the exclusivity re-key.

## Waiting: what a provider sees, and whether I get chased

This is the risk the change introduces: if categorising is on me and I'm slow,
does someone sit there thinking they're live and getting nothing?

**What they see while they wait.** The pending state is already honest. A
`pending_review` provider is sent back into the wizard, which shows an amber
panel: *"Thanks — we check every business before it appears, usually within
{REVIEW_WITHIN_HOURS} hours. We will email you either way."* They **cannot** set
up payouts or reach the dashboard — that screen is approved-only — so nothing
tells them they're live. Good. What they *are* is held to a number we quoted, and
if I miss it they are waiting past a promise with no update.

**There is no approved-but-invisible state.** Because Approve is gated on
categorisation (§2), an approved guest provider is always categorised, and
categorised + payouts-on = live. The only invisible window is `pending_review`,
which is the ordinary review queue — the same window any application sits in.

**Do I get chased? Today, no — and that's the gap to close.** The morning digest
([error-digest](app/api/cron/error-digest/route.ts:61)) chases the *opposite*
direction: applicants "waiting on themselves" who filled the form but never opened
their verification link. A proved, submitted, `pending_review` provider waiting on
**me** is on no list. That was tolerable when guest approvals were near-automatic
and the queue was small. Once every guest signup needs my decision, a slow review
is an invisible failure — exactly the "signed up, thinks they're live, gets
nothing" case.

So the digest change ships **with** this, not after it: add a review-queue block
to the same morning email — *"N businesses are waiting on you to review, oldest X
days"* — the mirror of the existing "waiting on themselves" block, same pattern,
opposite direction. That turns "I forgot" into a line in an email I already read
every morning.

## Cost of the rename

Zero guest providers on production, so `other` → `guest` is a clean rename now:
the enum value, the seeds (chef/baker/other demos), and the tests that assert
per-trade MCC and the chef branches. Those tests encode intent that is changing —
I'll show the exact test impact before touching them, per the "tests assert
intent" rule. On test there is the Effie's Bakes demo and the seed data; those
get re-seeded onto the new shape.

## Build order

1. Migration: add `exclusive_per_date boolean` to `service_providers`; rekey the
   chef-exclusivity partial index onto it; (rename is a code/data concern, the
   `trade` column stays text). Test first, prod on my say-so.
2. `lib/serviceProviders.ts` / `lib/serviceOrders.ts`: rename the sentinel,
   collapse `guestCategory`/`planForTrade`/`categoryBlockers`, drop the fixed
   guest MCC entries, replace `exclusivePerDate` with the flag.
3. Sign-up: the explicit audience fork; remove the guest trade grid; one menu
   editor.
4. Review: universal categorise panel, widened MCC list, `exclusive_per_date`
   checkbox, description surfaced.
5. Digest: the review-queue block.
6. Seeds + tests re-shaped; scenarios re-run if a money-path file moves.
