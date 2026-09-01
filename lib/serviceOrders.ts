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

// ---------------------------------------------------------------------------
// WHO STRIPE THINKS EACH PROVIDER IS
// ---------------------------------------------------------------------------
//
// One category per trade, ours to set, never the provider's to guess. A
// provider asked "what is your MCC?" would answer wrong, and a wrong MCC is a
// payout hold months later that nobody traces back — so the account is created
// with the code from this table, keyed off the trade we already know.
//
// If a new guest trade is added and has no code here, `mccForTrade` returns
// null and the provider cannot be onboarded — which is the right failure: a
// trade with no category is not one to list until somebody has chosen its code.
// That is a decision for a person, not a default.
//
//   chef    5811  Caterers
//   cake    5462  Bakeries
//   basket  5411  Grocery stores. For a holiday let the common service is
//                 filling the fridge before arrival, not a gift hamper — and a
//                 hamper billed under a grocery code is unremarkable, where a
//                 weekly shop billed under a gift-shop code is not.
//
// There is no entry for "other". A "something else" provider has no fixed
// category by definition — the owner reads what they described and assigns a
// code by hand at approval, stored on the row as stripe_mcc. See mccForProvider
// below, which prefers that per-provider code over this table.
//
// The table is owned here and changed here, and reviewed with the owner before
// it reaches production.
export const TRADE_MCC: Record<string, string> = {
    chef: '5811',
    cake: '5462',
    basket: '5411',
};

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

// The MCCs the owner may assign to an "other" provider, in plain words. A short
// curated list, NOT Stripe's full catalogue — the point of a person reading the
// description and choosing is that the choice is a small, sane one. Add to this
// as real "something else" businesses arrive; a code that is not here cannot be
// assigned, which is the right failure.
export const ASSIGNABLE_MCCS: Array<{ code: string; label: string }> = [
    { code: '7299', label: 'Personal services (massage, wellbeing, catch-all)' },
    { code: '7997', label: 'Clubs, activities & recreation' },
    { code: '7911', label: 'Dance, classes & instruction' },
    { code: '7333', label: 'Photography & videography' },
    { code: '5811', label: 'Caterers & food' },
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

// What Stripe is told the account sells, alongside the MCC. Plain, and framed
// as the guest-facing thing it is. One per trade so the account a provider
// onboards describes their business, not lodging.
export const TRADE_STRIPE_DESCRIPTION: Record<string, string> = {
    chef: 'Private chef and in-home dining for holiday guests.',
    cake: 'Cakes and baking for holiday guests.',
    basket: 'Welcome hampers and shopping for holiday guests.',
};

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
    return provider.status === 'approved' && provider.stripe_payouts_enabled === true;
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
// THE STATES, AND WHICH MAY FOLLOW WHICH
// ---------------------------------------------------------------------------
//
//   authorised  card held (PaymentIntent requires_capture). Awaiting provider.
//   confirmed   provider said yes; the hold was captured; money taken.
//   declined    provider said no; the hold released. No money moved.
//   expired     provider did not answer in the window; the hold released.
//   cancelled   guest pulled it before the provider answered; hold released.
//   refunded    confirmed, then money returned under the provider's policy.
//
// Every transition here corresponds to a real Stripe act — a capture, a
// cancel, a refund — and the route performs the Stripe act BEFORE writing the
// new status, so a status can never claim money moved when it did not.
export type OrderStatus =
    | 'authorised' | 'confirmed' | 'declined' | 'expired' | 'cancelled' | 'refunded';

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    authorised: ['confirmed', 'declined', 'expired', 'cancelled'],
    confirmed: ['refunded'],
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

// FREE CANCELLATION, AND WHERE THE LINE IS.
//
// A guest can always cancel a request that has not been answered — the hold is
// released and nothing was ever taken. A CONFIRMED booking is different: money
// has moved, so cancelling it is a refund, and a refund follows the provider's
// own promise. The one every provider makes on their listing is "let me know 48
// hours ahead and there's nothing to pay", so that is the line the guest-facing
// cancel honours: 48 hours or more before the service date, a confirmed booking
// refunds in full; inside that window it is the provider's call, and the guest
// is pointed to them (the provider can still refund out of goodwill).
//
// Measured to the START of the service date, which is the earliest the work
// could begin. Pure and takes `now`, so it tests without a clock.
export const FREE_CANCEL_HOURS = 48;

export function guestMayCancelFree(serviceDate: string, now: Date): boolean {
    const start = new Date(String(serviceDate) + 'T00:00:00Z').getTime();
    if (isNaN(start)) return false;
    return start - now.getTime() >= FREE_CANCEL_HOURS * 60 * 60 * 1000;
}
