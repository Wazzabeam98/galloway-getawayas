// Where an experience order's money is, and how it moves from there.
//
// TWO FLOWS, ONE PER ORDER, SAID ON THE ORDER (service_orders.funds_flow).
//
//   'direct' — every order before 30 Sep 2026. A destination charge:
//       on_behalf_of the provider, transfer_data.destination = the provider,
//       our 10% as an application fee. The provider's share reached their own
//       Stripe balance the moment the card was captured, so a refund has to
//       pull it back out of them (refund_application_fee + reverse_transfer).
//
//   'held' — every order from this change. A charge made on our account but
//       ON BEHALF OF the provider (on_behalf_of), with no transfer_data and no
//       application fee. The provider stays the seller on the card networks —
//       their name is on the guest's statement — but the whole amount settles
//       to the Galloway Getaways balance and stays there until the day after
//       the experience, when /api/cron/experience-payouts transfers the
//       provider's share (Stripe's "separate charges and transfers" with a
//       settlement merchant). The timing mirrors a host being paid the day
//       after check-in; the seller does not — on a stay we are the seller, by
//       decision, and that is unchanged. A refund before payout comes straight
//       from us, with nothing to reverse. A refund after it also claws the
//       payout back.
//
// The marker is written by the code that creates the charge, in the same
// breath, and the database refuses to change it once a PaymentIntent is
// attached — so an order can never be paid twice by drifting from one flow to
// the other. A row that says nothing means 'direct' (the migration default),
// because until this code deploys every order written is still a destination
// charge.
//
// Relative imports on purpose: exercised by unit tests, where the '@/' alias
// is a build-time path Node cannot always resolve.

import { stripeRequest } from './stripe';
import { logMoneyFailure } from './moneyAlert';
import { reversibleFrom, isShortOfFunds } from './clawback';

export type FundsFlow = 'direct' | 'held';

export function fundsFlowOf(order: { funds_flow?: string | null } | null | undefined): FundsFlow {
    return order && order.funds_flow === 'held' ? 'held' : 'direct';
}

// The columns every money path needs to read to act on an order correctly.
// One string so a refund site cannot forget the payout it may have to reverse.
export const ORDER_FUNDS_COLUMNS =
    'funds_flow, platform_fee, paid_out_at, payout_amount, payout_transfer_id, payout_reversed, payout_clawback_owed';

// ---------------------------------------------------------------------------
// CREATING A NEW (HELD) CHARGE
// ---------------------------------------------------------------------------

// What rides on a new order's PaymentIntent (and its Checkout session): the
// flow, so the webhook writes the order row with the right marker, and our fee
// in pence, which used to be the application fee and is now just a number the
// payout run subtracts. Deliberately NO transfer_data or application_fee_amount
// — those are what sent the money to the provider at capture. on_behalf_of IS
// set, by heldChargeSeller below: it names the seller, it does not move money.
export function heldChargeMetadata(pricing: { applicationFeePence: number }): Record<string, string> {
    return {
        funds_flow: 'held',
        platform_fee_pence: String(Math.max(0, Math.round(Number(pricing.applicationFeePence) || 0))),
    };
}

// Who the card networks see as the seller of a held charge: the provider.
// Spread into payment_intent_data at every place an experience is charged, so
// the five routes cannot disagree. on_behalf_of makes the provider the
// settlement merchant (their statement descriptor, their card_payments
// capability — requested at Connect onboarding); the money still settles to
// our balance and waits for the payout run, because there is no transfer_data.
export function heldChargeSeller(providerAccountId: string): { on_behalf_of: string } {
    if (!providerAccountId) throw new Error('heldChargeSeller: the provider has no Stripe account');
    return { on_behalf_of: providerAccountId };
}

// The name on the guest's card statement for a held charge. on_behalf_of makes
// the provider's account the settlement merchant, and Stripe prints THAT
// account's statement descriptor — which, left unset, Stripe derives from the
// account's website. Provider accounts are created with our site as the
// website, so without this the guest would read GALLOWAYGETAWAYS.CO.UK and the
// provider would be the seller in name only. So the descriptor is set from the
// business name. Stripe's rules: 5–22 characters, at least one letter, Latin
// characters only, none of < > \ ' " *. Too short is padded rather than left
// for Stripe to fill from our website.
export function providerStatementDescriptor(businessName: string | null | undefined): string {
    let d = String(businessName || '')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>\\'"*]/g, '')
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!/[A-Za-z]/.test(d)) d = '';
    if (d.length < 5) d = (d ? d + ' ' : '') + 'EXPERIENCE';
    return d.slice(0, 22).trim();
}

// The two columns a route writes when it inserts a held order row itself (the
// slot shape and the change/top-up children write their row before Checkout).
export function heldOrderFields(pricing: { applicationFeePence: number }): { funds_flow: 'held'; platform_fee: number } {
    return {
        funds_flow: 'held',
        platform_fee: Math.max(0, Math.round(Number(pricing.applicationFeePence) || 0)) / 100,
    };
}

// The same two columns, read back off a Checkout session's metadata by the
// webhook / reconcile sweep. A session from code before this change carries no
// marker, and its PaymentIntent is a destination charge — so it is 'direct'.
export function orderFieldsFromMetadata(md: Record<string, any> | null | undefined): { funds_flow: FundsFlow; platform_fee: number | null } {
    if (md && md.funds_flow === 'held') {
        const pence = Number(md.platform_fee_pence);
        return { funds_flow: 'held', platform_fee: Number.isFinite(pence) && pence >= 0 ? pence / 100 : null };
    }
    return { funds_flow: 'direct', platform_fee: null };
}

// ---------------------------------------------------------------------------
// THE PROVIDER'S SHARE
// ---------------------------------------------------------------------------

// What the payout run sends, in pence: the money we still hold on this order
// less our fee on it. With nothing refunded it is `charge − fee` to the penny —
// what the application fee used to leave the provider, so commission is
// unchanged (on items only; a delivery fee passes through whole, because the
// frozen fee was worked out on the items). A partial refund scales our fee down
// in proportion, the way `refund_application_fee` did.
export function providerSharePence(input: {
    amountPence: number;
    refundedPence?: number | null;
    platformFeePence?: number | null;
    commissionRate?: number | null;
}): number {
    const amount = Math.max(0, Math.round(Number(input.amountPence) || 0));
    const refunded = Math.max(0, Math.round(Number(input.refundedPence) || 0));
    const kept = Math.max(0, amount - refunded);
    if (kept <= 0 || amount <= 0) return 0;

    let fee: number;
    const frozen = input.platformFeePence;
    if (frozen !== null && frozen !== undefined && Number.isFinite(Number(frozen)) && Number(frozen) >= 0) {
        fee = kept === amount
            ? Math.round(Number(frozen))
            : Math.round(Number(frozen) * kept / amount);
    } else {
        // No frozen fee (should not happen on a held order): the standard rate
        // on what was kept. A missing rate is the standard 10%, never zero.
        const rate = input.commissionRate === null || input.commissionRate === undefined || isNaN(Number(input.commissionRate))
            ? 0.10
            : Number(input.commissionRate);
        fee = Math.round(kept * rate);
    }
    return Math.max(0, Math.min(kept, kept - fee));
}

// ---------------------------------------------------------------------------
// REFUNDING
// ---------------------------------------------------------------------------

// The /refunds body for an order. A direct order hands back our fee and
// reverses the transfer to the provider, as it always did. A held order's money
// is ours to return: a plain refund. (reverse_transfer on a platform charge is
// refused by Stripe outright — there is no transfer on it to reverse.)
export function refundBody(order: { funds_flow?: string | null; stripe_payment_intent_id: string }): Record<string, string> {
    if (fundsFlowOf(order) === 'held') {
        return { payment_intent: order.stripe_payment_intent_id };
    }
    return {
        payment_intent: order.stripe_payment_intent_id,
        refund_application_fee: 'true',
        reverse_transfer: 'true',
    };
}

// Refund an order in full, the right way for its flow. The idempotency key is
// the caller's (they already use 'refund-' + order.id, which is the order's own
// id and never resettable), so a retry replays rather than refunds twice.
//
// For a held order that has ALREADY been paid out — a provider refunding a
// past booking, a stay cancelled after the experience date — the guest's money
// comes back from us and the provider's payout is clawed back after it.
export async function refundExperienceOrder(admin: any, order: any, idempotencyKey: string): Promise<any> {
    const refund = await stripeRequest('POST', '/refunds', refundBody(order), idempotencyKey);
    if (fundsFlowOf(order) === 'held' && order.payout_transfer_id) {
        await clawBackExperiencePayout(admin, order, (refund && refund.id) || idempotencyKey);
    }
    return refund;
}

// Pull back what we paid a provider for an order that has since been refunded.
//
// Mirrors lib/clawback.ts for a stay: only reverse what the provider can
// actually fund (so their connected account never goes negative and Stripe
// never silently recovers the same money twice out of a later transfer), and
// say out loud what could not be recovered. There is no provider debt ledger
// the payout run nets off yet, so a shortfall is written on the order
// (payout_clawback_owed) and the directors are told now — the Experience
// Provider Agreement lets us recover it by invoice.
export async function clawBackExperiencePayout(
    admin: any,
    order: any,
    reference: string
): Promise<{ reversed: number; owed: number; failed: number }> {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const remaining = r2(Number(order.payout_amount || 0) - Number(order.payout_reversed || 0));
    if (!order.payout_transfer_id || remaining <= 0) return { reversed: 0, owed: 0, failed: 0 };

    const { data: prov } = await admin
        .from('service_providers')
        .select('stripe_account_id')
        .eq('id', order.provider_id)
        .maybeSingle();

    const reversible = prov && prov.stripe_account_id
        ? await reversibleFrom(prov.stripe_account_id, order.payout_transfer_id)
        : { reachable: null, fullyReversed: false };

    if (reversible.fullyReversed) return { reversed: 0, owed: 0, failed: 0 };

    const fundable = reversible.reachable === null
        ? remaining
        : r2(Math.max(0, Math.min(remaining, reversible.reachable)));
    let shortfall = r2(remaining - fundable);
    let reversed = 0;

    try {
        if (fundable > 0) {
            await stripeRequest(
                'POST',
                '/transfers/' + order.payout_transfer_id + '/reversals',
                { amount: Math.round(fundable * 100), metadata: { service_order_id: order.id, reason: 'refund after payout' } },
                'exp-clawback-' + order.id + '-' + reference
            );
            reversed = fundable;
        }
    } catch (err: any) {
        if (!isShortOfFunds(err)) {
            await logMoneyFailure(
                'experience-payouts: a refund went back to the guest but the provider’s payout could not be reversed — not charged to the provider; reconcile by hand',
                { order_id: order.id, transfer_id: order.payout_transfer_id, amount: remaining, message: err && err.message },
                { path: 'lib/experienceFunds' }
            );
            return { reversed: 0, owed: 0, failed: remaining };
        }
        shortfall = remaining;
    }

    const patch: Record<string, number> = {};
    if (reversed > 0) patch.payout_reversed = r2(Number(order.payout_reversed || 0) + reversed);
    if (shortfall > 0) patch.payout_clawback_owed = r2(Number(order.payout_clawback_owed || 0) + shortfall);
    if (Object.keys(patch).length) {
        const { error } = await admin.from('service_orders').update(patch).eq('id', order.id);
        if (error) {
            await logMoneyFailure(
                'experience-payouts: a payout reversal happened but could not be written on the order',
                { order_id: order.id, reversed, shortfall, message: error.message },
                { path: 'lib/experienceFunds' }
            );
        }
    }

    if (shortfall > 0) {
        await logMoneyFailure(
            'experience-payouts: a provider was refunded against after payout and £' + shortfall.toFixed(2)
                + ' could not be pulled back from their Stripe balance — owed to us, recover by invoice',
            { order_id: order.id, provider_id: order.provider_id, transfer_id: order.payout_transfer_id, reversed, owed: shortfall },
            { path: 'lib/experienceFunds' }
        );
    }

    return { reversed, owed: shortfall, failed: 0 };
}
