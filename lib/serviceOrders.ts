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
//   basket  5947  Gift, card, novelty & souvenir shops (hampers are gifts)
//   paw     7299  Miscellaneous personal services (pet sitting / walking)
//
// Best-fit starting values; the table is owned here and changed here.
export const TRADE_MCC: Record<string, string> = {
    chef: '5811',
    cake: '5462',
    basket: '5947',
    paw: '7299',
};

export function mccForTrade(trade: string): string | null {
    return TRADE_MCC[String(trade || '')] || null;
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
