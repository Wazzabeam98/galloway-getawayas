// A guest paying a provider for an experience during their stay.
//
// Same shape as lib/serviceProviders.ts and lib/serviceEnquiries.ts: pure
// functions and constants, no queries, so the guest surface, the order route,
// the confirm route and the expiry sweep all read the same rules and can be
// tested without a database anywhere near it.
//
// THIS IS THE FILE WHERE MONEY MOVES, so it is the file that decides who is
// live, what an order may cost, how much of it is ours, and which state may
// follow which. The routes carry it out; they do not re-decide it.

import { serviceCeiling, serviceCommission } from '@/lib/pricing';
import { commissionRateFor } from '@/lib/serviceProviders';

// ---------------------------------------------------------------------------
// THE LAUNCH SWITCH
// ---------------------------------------------------------------------------
//
// Guest experiences do not open to guests until this says so, whatever else is
// true — a chef can be approved, connected and covering the cottage, and a
// guest still cannot book until the switch is on. It is a deliberate launch
// gate, not a bug: the owner opens it the moment the first chef is ready.
//
// ONE ENV VAR, GUEST_EXPERIENCES_OPEN, and nothing else. Absent or anything
// other than the string 'true' means closed. Read on the SERVER only — this is
// the lock, not the shop window, so it must not be a NEXT_PUBLIC_ value a
// browser could see or a UI that only hides a button. The order route and the
// experiences route both consult it, so a direct API call is refused the same
// as a click.
//
// Flipping it takes a redeploy to bind on Vercel — see MAINTENANCE.md.
export function guestExperiencesOpen(): boolean {
    return process.env.GUEST_EXPERIENCES_OPEN === 'true';
}

// The three /business sign-up tiles — holiday let, offer a service, and host a
// guest experience — are held behind a "coming soon" state on PRODUCTION until
// the host/provider terms are back from the solicitor. This is a front-door
// flag only: it greys the tiles on the fork and nothing else. The flows behind
// them (/addhome, /services/join, /services/join?trade=guest) are untouched, and
// so is every existing host and tradesman — none of their routes read this.
//
// Releasing is ONE step for all three: set BUSINESS_SIGNUPS_OPEN=true on
// Production (a redeploy binds it, same as GUEST_EXPERIENCES_OPEN above). All
// three tiles read this one flag, so they come back together.
//
// Held on PRODUCTION only — previews and local always return open, so the whole
// of each flow stays walkable while the terms are outstanding. Defaulting to
// held on prod (absent, or anything but 'true') is the safe direction: the
// RESEND_API_KEY-set-on-Production-not-Preview class of scoping slip can only
// ever leave a preview more open, never expose production before the terms land.
export function businessSignupsOpen(): boolean {
    if (process.env.VERCEL_ENV !== 'production') return true;
    return process.env.BUSINESS_SIGNUPS_OPEN === 'true';
}

// ---------------------------------------------------------------------------
// WHO STRIPE THINKS EACH PROVIDER IS
// ---------------------------------------------------------------------------
//
// There are no fixed per-trade MCCs any more. Every guest provider is 'guest'
// and has NO fixed category by definition — the owner reads what they described
// and assigns a code by hand at review, stored on the row as stripe_mcc. See
// mccForProvider below, which reads that per-provider code. Host trades never
// take a Connect charge, so they never needed a code here either.
//
// The map is kept (empty) so mccForTrade stays a total function and the fallback
// in mccForProvider stays honest: a provider with no assigned code returns null
// and cannot be onboarded, which is the right failure — a category is a decision
// for a person, not a default.
export const TRADE_MCC: Record<string, string> = {};

export function mccForTrade(trade: string): string | null {
    return TRADE_MCC[String(trade || '')] || null;
}

// The code for a specific provider, which is the per-provider one where it has
// been assigned (an "other" provider, categorised by the owner) and otherwise
// the trade's fixed code. This is what the guest gate and the connect route ask
// — never mccForTrade directly — so an approved, categorised "other" provider
// is treated exactly like a chef and is not filtered out for having no entry in
// the table above.
export function mccForProvider(
    provider: { trade?: string | null; stripe_mcc?: string | null } | null | undefined
): string | null {
    if (!provider) return null;
    const assigned = String(provider.stripe_mcc || '').trim();
    if (assigned) return assigned;
    return mccForTrade(String(provider.trade || ''));
}

// The MCCs the owner may assign to a guest provider, in plain words. A short
// curated list, NOT Stripe's full catalogue — the point of a person reading the
// description and choosing is that the choice is a small, sane one. Add to this
// as real businesses arrive; a code that is not here cannot be assigned, which
// is the right failure.
//
// Every guest provider now flows through here, so the three that used to be
// fixed trades — a chef (5811), a baker (5462), a hamper/shop (5411) — are
// first-class choices at the top, not just the long tail.
export const ASSIGNABLE_MCCS: Array<{ code: string; label: string }> = [
    { code: '5811', label: 'Caterers & private chefs' },
    { code: '5462', label: 'Bakeries & cakes' },
    { code: '5411', label: 'Groceries & hampers' },
    { code: '7299', label: 'Personal services (massage, wellbeing, catch-all)' },
    { code: '7997', label: 'Clubs, activities & recreation' },
    { code: '7911', label: 'Dance, classes & instruction' },
    { code: '7333', label: 'Photography & videography' },
    { code: '5812', label: 'Eating places & prepared meals' },
    { code: '7230', label: 'Hair, beauty & barber' },
    { code: '5992', label: 'Florists' },
    { code: '7392', label: 'Guiding, consulting & planning' },
    { code: '7999', label: 'Recreation services (not elsewhere listed)' },
];

export function assignableMccLabel(code: string): string {
    const found = ASSIGNABLE_MCCS.filter((m) => m.code === String(code || ''))[0];
    return found ? found.label : String(code || '');
}

// The food codes — a private chef (5811), a bakery/cake maker (5462), a
// grocer/hamper (5411) and a prepared-meals kitchen (5812). We single these
// out so a guest ordering food is asked about allergies specifically: it is
// safety information a cook needs, and a generic "anything else?" box invites
// people to leave it out.
export const FOOD_MCCS = new Set(['5811', '5462', '5411', '5812']);

export function isFoodProvider(
    provider: { trade?: string | null; stripe_mcc?: string | null } | null | undefined
): boolean {
    const code = mccForProvider(provider);
    return !!code && FOOD_MCCS.has(code);
}

// What Stripe is told the account sells, alongside the MCC. There are no fixed
// per-trade descriptions any more; a guest provider's is set at review beside
// the code (stripe_product_description) and read by stripeProfileForProvider.
// Kept (empty) so stripeProfileForTrade stays a total function whose fallback is
// the neutral line below.
export const TRADE_STRIPE_DESCRIPTION: Record<string, string> = {};

// The business_profile for a provider's connected account: the category and a
// description, both keyed off the trade we already know. Returns null for a
// trade with no MCC, which is what stops an un-categorised trade being
// onboarded at all.
export function stripeProfileForTrade(
    trade: string
): { mcc: string; product_description: string } | null {
    const mcc = mccForTrade(trade);
    if (!mcc) return null;
    return {
        mcc,
        product_description: TRADE_STRIPE_DESCRIPTION[String(trade || '')]
            || 'A local experience for holiday guests.',
    };
}

// The business_profile for a specific provider's connected account. Same as
// stripeProfileForTrade, but it honours a per-provider code first — so an
// "other" provider the owner has categorised onboards with the code and the
// description the owner assigned, and every fixed trade is unchanged. Returns
// null when no code is available, which is what still stops an un-categorised
// "other" provider being onboarded at all.
export function stripeProfileForProvider(
    provider: {
        trade?: string | null;
        stripe_mcc?: string | null;
        stripe_product_description?: string | null;
    } | null | undefined
): { mcc: string; product_description: string } | null {
    if (!provider) return null;
    const assigned = String(provider.stripe_mcc || '').trim();
    if (assigned) {
        return {
            mcc: assigned,
            product_description: String(provider.stripe_product_description || '').trim()
                || 'A local experience for holiday guests.',
        };
    }
    return stripeProfileForTrade(String(provider.trade || ''));
}

// ---------------------------------------------------------------------------
// WHO A GUEST MAY SEE
// ---------------------------------------------------------------------------
//
// Two gates, and BOTH are required. Approval is the human decision that the
// business is real. Payout-readiness is Stripe saying it can pay them. A guest
// must never be shown a provider we cannot take money for, because the offer
// would fail at the checkout — better an empty category than a broken payment.
//
// This is the single reason "approved" stopped meaning "live" for guest trades.
export function isLiveToGuests(provider: any): boolean {
    if (!provider) return false;
    // owner_paused is the provider's own take-down: approved and payout-ready, but
    // hidden by their choice for now. Undefined (a caller that didn't select the
    // column) reads as not-paused, so this stays inert everywhere but the
    // marketplace reads that select it.
    return provider.status === 'approved' && provider.stripe_payouts_enabled === true
        && !provider.owner_paused;
}

// A provider who has been approved but has not finished Stripe. Not a guest's
// problem — they never see them — but the provider's own dashboard says so.
export function isAwaitingConnect(provider: any): boolean {
    if (!provider) return false;
    return provider.status === 'approved' && provider.stripe_payouts_enabled !== true;
}

// ---------------------------------------------------------------------------
// WHAT AN ORDER COSTS, AND WHAT IS OURS
// ---------------------------------------------------------------------------
//
// The price is the provider's own, unchanged — commission not markup, so the
// guest pays exactly what the provider charges and our cut comes off the
// provider's take. `serviceCeiling` and `serviceCommission` already own the
// arithmetic; this only turns it into the two figures Stripe needs.
//
// The catalogue is the priced-extras vocabulary, passed in by the caller from
// lib/serviceProviders so this file keeps no copy of it.
export interface OrderPricing {
    price: number;              // what the guest pays, in pounds
    commissionRate: number;     // e.g. 0.10
    commission: number;         // our fee, in pounds
    net: number;                // what the provider keeps, in pounds
    amountPence: number;        // the charge, in pence
    applicationFeePence: number;// our fee, in pence
}

function pence(pounds: number): number {
    return Math.round(Number(pounds) * 100);
}

export function priceOrder(
    provider: any,
    ceilingInput: Parameters<typeof serviceCeiling>[0],
    catalogue: Parameters<typeof serviceCeiling>[1]
): OrderPricing {
    const price = serviceCeiling(ceilingInput, catalogue);
    const commissionRate = commissionRateFor(provider);
    const commission = serviceCommission(price, commissionRate);
    const net = Math.round((price - commission) * 100) / 100;

    return {
        price,
        commissionRate,
        commission,
        net,
        amountPence: pence(price),
        // The application fee is taken in the same currency and rounded to
        // whole pence the same way, so amountPence − applicationFeePence is
        // exactly the provider's net. Deriving one from the other rather than
        // rounding both independently is what stops a stray penny.
        applicationFeePence: pence(price) - pence(net),
    };
}

// ---------------------------------------------------------------------------
// UNITS, AND THE QUANTITY THAT MULTIPLIES THEM
// ---------------------------------------------------------------------------
//
// A menu item's price carries a unit. 'flat' is a set price — a chef's whole
// evening — charged once, with no quantity to pick. Every other unit is a rate:
// the guest picks a quantity and the charge is unit price × quantity. This is
// the honest reading of "£30 per person" — six people is £180, not £30 — and
// the amount held on the card, the amount captured and the 10% fee all scale
// with it, because the total is what priceOrder is handed.
//
// A guest choosing a quantity can choose it wrong, and it is the provider who
// turns up to it. Two guards sit under that: the surface shows the number and
// the total back before they pay, and the count is capped here so a
// fat-fingered 100 cannot put a four-figure hold on a card. The cap is a
// safety rail, not a business limit — a genuinely large order is a phone call,
// not a silent charge — and it lives in one place so the route and the surface
// cannot disagree.

export type OrderUnit = 'flat' | 'person' | 'night' | 'hour' | 'ticket' | 'item';

export const ORDER_UNITS: OrderUnit[] = ['flat', 'person', 'night', 'hour', 'ticket', 'item'];

/** A fat-finger guard, not a business rule. Tune freely; it is the one cap. */
export const MAX_ORDER_QUANTITY = 50;

/** Anything that is not a valid unit is treated as 'flat' — the safe default. */
export function normaliseUnit(unit: string | null | undefined): OrderUnit {
    return (ORDER_UNITS as string[]).includes(String(unit)) ? (unit as OrderUnit) : 'flat';
}

/** A flat price is charged once; every other unit multiplies by a quantity. */
export function unitMultiplies(unit: string | null | undefined): boolean {
    return normaliseUnit(unit) !== 'flat';
}

/** The word for one of them, singular. 'flat' has none — it is not counted. */
export function unitNoun(unit: string | null | undefined): string {
    const map: Record<OrderUnit, string> = {
        flat: '', person: 'person', night: 'night', hour: 'hour', ticket: 'ticket', item: 'item',
    };
    return map[normaliseUnit(unit)];
}

/** The suffix a price reads with: "per person". Empty for a flat price. */
export function unitLabel(unit: string | null | undefined): string {
    const noun = unitNoun(unit);
    return noun ? 'per ' + noun : '';
}

/** The question beside the quantity box: "How many people?". Empty for flat. */
export function quantityQuestion(unit: string | null | undefined): string {
    const noun = unitNoun(unit);
    if (!noun) return '';
    // "How many people?" reads better than "How many persons?".
    const plural = noun === 'person' ? 'people' : noun + 's';
    return 'How many ' + plural + '?';
}

/**
 * The quantity an order is actually for, from whatever the browser sent.
 *
 * A flat item is always one. Otherwise it is a whole number, at least one and
 * at most the cap. Returns null when the request is out of range for a
 * multiplying unit — the route turns that into a plain refusal rather than
 * silently clamping, because charging for 50 when someone typed 100 is its own
 * kind of wrong.
 */
export function orderQuantity(unit: string | null | undefined, requested: unknown): number | null {
    if (!unitMultiplies(unit)) return 1;
    const n = Number(requested);
    if (!Number.isInteger(n) || n < 1 || n > MAX_ORDER_QUANTITY) return null;
    return n;
}

/** The total in pounds: unit price × quantity, rounded to whole pence. */
export function orderTotal(unitPrice: number, quantity: number): number {
    return Math.round(Number(unitPrice) * Number(quantity) * 100) / 100;
}

// ---------------------------------------------------------------------------
// THE STATES, AND WHICH MAY FOLLOW WHICH
// ---------------------------------------------------------------------------
//
//   authorised  card held (PaymentIntent requires_capture). Awaiting provider.
//   confirmed   provider said yes; the hold was captured; money taken.
//   declined    provider said no; the hold released. No money moved.
//   expired     provider did not answer in the window; the hold released.
//   cancelled   guest pulled it. From 'authorised' the hold is released (no
//               money moved). From 'confirmed' it is the WALK-AWAY: the guest
//               cancels inside the no-refund window, forfeits what they paid,
//               the provider keeps it and gets the date back. No Stripe act, and
//               the money stays exactly where it is.
//   refunded    confirmed, then money returned under the provider's policy.
//
// Most transitions here correspond to a real Stripe act — a capture, a cancel, a
// refund — performed BEFORE the new status is written, so a status can never
// claim money moved when it did not. The ONE exception is confirmed→cancelled
// (the walk-away above): it moves no money by design, and stores a cancel_ack so
// the guest's forfeit is on the record.
export type OrderStatus =
    | 'authorised' | 'confirmed' | 'declined' | 'expired' | 'cancelled' | 'refunded';

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    authorised: ['confirmed', 'declined', 'expired', 'cancelled'],
    confirmed: ['refunded', 'cancelled'],
    declined: [],
    expired: [],
    cancelled: [],
    refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return (TRANSITIONS[from] || []).indexOf(to) !== -1;
}

// The four ways a held card is let go without a charge. Named as a set so the
// sweep, the decline route and the guest-cancel route cannot disagree about
// which states mean "release the hold".
export function releasesHold(to: OrderStatus): boolean {
    return to === 'declined' || to === 'expired' || to === 'cancelled';
}

// How long a provider has to answer before the hold is released. Short enough
// that a guest is not left waiting on their card, long enough that a provider
// checking mail once a day still catches it. Stripe's own authorisation lasts
// up to seven days on a card; this is deliberately well inside that, so the
// platform releases the hold on its own terms rather than letting Stripe
// expire it silently — the same reasoning as a booking's payment hold.
export const CONFIRM_WINDOW_HOURS = 48;

export function expiryFrom(createdISO: string): string {
    const t = new Date(createdISO).getTime() + CONFIRM_WINDOW_HOURS * 60 * 60 * 1000;
    return new Date(t).toISOString();
}

// WHO CAN ONLY DO ONE THING ON A DATE — an owner-set flag, not a trade.
//
// A chef cooks one evening: a second live order for the same chef and date is a
// clash, not a queue, because they cannot be in two cottages at once. A masseur
// is the same. A baker can bake five cakes for one Saturday; a hamper maker can
// make ten. There is no longer a trade to key this on — everyone is 'guest' —
// so it is a per-provider flag the owner sets at review (exclusive_per_date),
// snapshotted onto the order so the hard guard can see it.
//
// The partial unique index in 20260902090000 carries the same predicate
// (`where exclusive_per_date`), and the order route's clash pre-check reads this
// function — keep the two in step.
export function exclusivePerDate(
    provider: { exclusive_per_date?: boolean | null; shape?: string | null } | null | undefined
): boolean {
    if (!provider) return false;
    // Shape is the source of truth now: a "comes to you" provider holds the
    // date. exclusive_per_date is kept in sync with it (and still carries the
    // partial unique index's predicate), so either answers — reading both means
    // a row written before the shape column, or after, both resolve correctly.
    return provider.shape === 'comes_to_you' || !!provider.exclusive_per_date;
}

// A short, quotable booking reference for an order — the same GG-XXXX shape a
// service enquiry uses (lib/serviceEnquiries.enquiryReference), so the language
// is one across the platform. DETERMINISTIC from the order id, so it is stable
// every time the same order is shown (an enquiry's is random-and-stored; an
// order has no such column, so we derive it). No I/O/0/1 — it gets read aloud.
const ORDER_REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function orderReference(orderId: string | null | undefined): string {
    const id = String(orderId || '');
    if (!id) return 'GG-????';
    // A small stable hash over the id's characters; the uuid's own entropy is
    // plenty for a 4-char human reference (collisions don't matter — the id is
    // still the key, this is only for a person to quote).
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    let out = '';
    for (let i = 0; i < 4; i++) {
        out += ORDER_REFERENCE_ALPHABET.charAt(hash % ORDER_REFERENCE_ALPHABET.length);
        hash = Math.floor(hash / ORDER_REFERENCE_ALPHABET.length) + 7;
    }
    return 'GG-' + out;
}

// The money split for ONE order: what the guest paid net of any refund, our 10%
// fee on it, and the provider's take. The provider's money is the 90% that lands
// directly in their own Stripe balance (destination charge). Shared so the
// calendar panel, the earnings page and anywhere else read the SAME numbers.
// NOTE commission_rate here is a FRACTION (0.10), not a percent.
export function orderNet(
    o: { price?: number | null; commission_rate?: number | null; amount_refunded?: number | null }
): { rate: number; refunded: number; gross: number; fee: number; youGet: number } {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const rate = Number(o.commission_rate) || 0.10;
    const refunded = Number(o.amount_refunded) || 0;
    const gross = Number(o.price || 0);
    const kept = r2(gross - refunded);        // what the guest actually paid, net of refund
    const fee = r2(kept * rate);              // our cut on what was kept
    return { rate, refunded, gross, fee, youGet: r2(kept - fee) };
}
