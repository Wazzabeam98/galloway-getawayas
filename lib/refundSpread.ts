// Which charges a refund comes out of.
//
// WHY THIS EXISTS
//
// A stay paid as a deposit and then a balance has TWO charges at Stripe, held
// in two columns: `stripe_payment_intent_id` and `balance_payment_intent_id`.
// A Stripe refund names ONE payment intent and may not exceed what that charge
// took.
//
// The refund route never knew that. It refunded the whole amount against
// `stripe_payment_intent_id` alone, so a £300 stay paid as £150 + £150 and
// then cancelled came back from Stripe as:
//
//   Refund amount (£300.00) is greater than charge amount (£150.00)
//
// — the route threw, the booking was left confirmed, and the guest got
// nothing. Observed on the test project on 31 August 2026.
//
// The deposit is 25%, so this bit every deposit booking refunded above a
// quarter of its total, which is nearly all of them: the deposit plan is
// offered whenever check-in is more than thirty days out and it is the option
// that looks cheaper.
//
// `lib/payoutSource.ts` already knew a booking can have two charges — it reads
// both columns to decide which one a transfer draws on. It was written on 30
// August. The refund route was written before the balance ladder existed and
// was never told.

import { stripeRequest } from '@/lib/stripe';

export interface RefundableCharge {
    /** The payment intent to name on the refund. */
    intentId: string;
    /** What is left on this charge that can still be given back, in pence. */
    refundable: number;
}

/**
 * The charges behind a booking, in the order they were taken, with what is
 * still refundable on each.
 *
 * Deposit first, then balance. A guest reading their statement sees the money
 * come back the way it went out, and the deposit is the older charge — Stripe
 * refunds age out at 180 days, so the older one is the one to use first.
 *
 * A charge that cannot be read is left out rather than guessed at. Refunding
 * against a charge we could not confirm is how you get the failure this file
 * exists to stop.
 */
export async function refundableCharges(booking: {
    stripe_payment_intent_id?: string | null;
    balance_payment_intent_id?: string | null;
}): Promise<RefundableCharge[]> {
    const intentIds = [booking.stripe_payment_intent_id, booking.balance_payment_intent_id]
        .filter(function (id): id is string { return !!id; });

    // The same intent in both columns is not a hypothetical. The webhook's
    // balance branch writes `stripe_payment_intent_id` as well, so a balance
    // paid by hand from the reminder link can leave both columns holding it.
    // Counting it twice would offer twice the refundable amount and produce
    // exactly the overspend this is here to prevent.
    const seen: Record<string, boolean> = {};
    const unique = intentIds.filter(function (id) {
        if (seen[id]) return false;
        seen[id] = true;
        return true;
    });

    const out: RefundableCharge[] = [];

    for (const id of unique) {
        try {
            const intent = await stripeRequest('GET', '/payment_intents/' + id);
            const chargeId = intent && intent.latest_charge;
            if (!chargeId) continue;

            const charge = await stripeRequest('GET', '/charges/' + String(chargeId));
            if (!charge || !charge.id) continue;

            const left = Number(charge.amount || 0) - Number(charge.amount_refunded || 0);
            if (left > 0) out.push({ intentId: id, refundable: left });
        } catch (err) {
            // Deliberately swallowed per charge. One unreadable charge must not
            // stop the other one being refunded — a guest getting half their
            // money back beats a guest getting none while Stripe is having a
            // bad minute. The caller compares what it managed to refund against
            // what it meant to and reports the difference.
            continue;
        }
    }

    return out;
}

/**
 * How much comes off each charge, in the order given.
 *
 * Takes as much as each charge can bear before moving to the next, which is
 * the same walk `lib/hostDebt.spread` does for debts. Amounts are pence, so
 * this is whole-number arithmetic throughout and no rounding can invent or
 * lose one.
 */
export function spreadPence(amountPence: number, charges: RefundableCharge[]): number[] {
    let left = amountPence > 0 ? Math.round(amountPence) : 0;

    return charges.map(function (charge) {
        const room = charge.refundable > 0 ? charge.refundable : 0;
        const take = Math.min(left, room);
        left = left - take;
        return take;
    });
}

export interface IssuedRefunds {
    /** The Stripe refund objects that were actually created. */
    refunds: any[];
    /** What actually went back, in pence. */
    refundedPence: number;
    /** The charges it was spread across, in the order used. */
    charges: RefundableCharge[];
    /** What came off each charge, aligned with `charges`. */
    shares: number[];
    /** Set if a refund was refused part-way through. */
    failure: any;
}

/**
 * Give money back across every charge behind a booking.
 *
 * The one place a refund is issued, for the same reason `lib/pricing.ts` is the
 * one place a total is calculated: there are four routes that refund and they
 * had four copies of "refund the whole amount against stripe_payment_intent_id",
 * which is wrong on every deposit booking and was wrong in all four at once.
 *
 * `keyFor` builds the idempotency key for a charge. It must vary with anything
 * that legitimately allows a second refund on the same booking and must NOT
 * vary between two concurrent attempts at the same refund — that collision is
 * the whole protection.
 *
 * Never throws for an individual refusal. The caller compares `refundedPence`
 * against what it meant to send and decides what to say; a guest half-refunded
 * with somebody told is better than a guest not refunded at all.
 */
export async function issueRefunds(
    booking: { stripe_payment_intent_id?: string | null; balance_payment_intent_id?: string | null },
    amountPounds: number,
    metadata: Record<string, string>,
    keyFor: (intentId: string) => string
): Promise<IssuedRefunds> {
    const charges = await refundableCharges(booking);
    const shares = spreadPence(Math.round(amountPounds * 100), charges);

    const refunds: any[] = [];
    let refundedPence = 0;
    let failure: any = null;

    for (let i = 0; i < charges.length; i++) {
        const share = shares[i];
        if (share <= 0) continue;

        try {
            const one = await stripeRequest(
                'POST',
                '/refunds',
                {
                    payment_intent: charges[i].intentId,
                    amount: share,
                    metadata: metadata,
                },
                keyFor(charges[i].intentId)
            );
            refunds.push(one);
            refundedPence += share;
        } catch (err) {
            // Stop rather than carry on. Whatever refused the first charge is
            // likely to refuse the second, and two failures help nobody.
            failure = err;
            break;
        }
    }

    return { refunds, refundedPence, charges, shares, failure };
}
