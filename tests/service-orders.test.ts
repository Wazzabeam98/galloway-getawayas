// The rules a guest order runs on: who is live, what it costs, what is ours,
// and which state may follow which. No database, no Stripe — a wrong number
// here is wrong whatever the routes do with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

import {
    TRADE_MCC, mccForTrade, mccForProvider, stripeProfileForTrade, stripeProfileForProvider,
    isLiveToGuests, isAwaitingConnect,
    priceOrder,
    canTransition, releasesHold,
    CONFIRM_WINDOW_HOURS, expiryFrom, guestExperiencesOpen,
} from '@/lib/serviceOrders';
import { GUEST_TRADES } from '@/lib/serviceProviders';

// --- who Stripe thinks each provider is --------------------------------------

test('every fixed guest trade has an MCC, and it is ours not the provider’s', () => {
    // The gap this closes: a guest trade with no category cannot be onboarded,
    // so a new FIXED one added without a code fails loudly rather than
    // defaulting to lodging. Looped over GUEST_TRADES so a fifth fixed guest
    // trade added tomorrow makes this fail until someone chooses its code.
    //
    // 'other' is the one deliberate exception — a "something else" business has
    // no fixed category by definition; the owner assigns its code per provider
    // at approval. It is covered by the next test, not this one.
    for (const trade of GUEST_TRADES as unknown as string[]) {
        if (trade === 'other') continue;
        assert.equal(typeof mccForTrade(trade), 'string', trade + ' has no MCC');
        assert.match(mccForTrade(trade) as string, /^\d{4}$/, trade + ' MCC is not a 4-digit code');
    }
});

test('“other” has no fixed code, but a per-provider one resolves and gates', () => {
    // No fixed code — which is exactly what holds an un-categorised "other"
    // provider out of Stripe onboarding until the owner picks one.
    assert.equal(mccForTrade('other'), null, 'other must have no fixed trade code');
    assert.equal(mccForProvider({ trade: 'other' }), null, 'an un-categorised other has no code');
    assert.equal(stripeProfileForProvider({ trade: 'other' }), null, 'and so cannot be onboarded');

    // Once the owner assigns a code on the row, that provider resolves exactly
    // like a fixed trade — so it is not filtered out for having no table entry.
    assert.equal(mccForProvider({ trade: 'other', stripe_mcc: '7299' }), '7299');
    const profile = stripeProfileForProvider({
        trade: 'other', stripe_mcc: '7299', stripe_product_description: 'Massage therapy for holiday guests.',
    });
    assert.equal(profile && profile.mcc, '7299');
    assert.ok(profile && profile.product_description.length > 0);

    // A fixed trade is unchanged by the per-provider path: with no code on the
    // row, it still reads its own from the table.
    assert.equal(mccForProvider({ trade: 'chef' }), '5811');
});

test('a trade with no code cannot be onboarded', () => {
    assert.equal(mccForTrade('sponge'), null, 'a host trade is not a guest experience');
    assert.equal(mccForTrade(''), null);
    assert.equal(mccForTrade('nonsense'), null);
});

test('the MCC table is not a host category', () => {
    // 7011 is lodging. No guest experience may carry it — that is the whole
    // reason the provider gets its own account.
    for (const code of Object.values(TRADE_MCC)) {
        assert.notEqual(code, '7011', 'a guest trade must not be filed as lodging');
    }
});

test('the Stripe profile carries the trade’s own category and a description', () => {
    const chef = stripeProfileForTrade('chef');
    assert.equal(chef && chef.mcc, '5811');
    assert.ok(chef && chef.product_description.length > 0, 'a description Stripe can read');

    // A trade with no code yields no profile — which is what stops the connect
    // route creating an account for an un-categorised trade.
    assert.equal(stripeProfileForTrade('sponge'), null);
    assert.equal(stripeProfileForTrade(''), null);
});

// --- who a guest may see -----------------------------------------------------

test('live to guests needs approval AND payouts, not either alone', () => {
    assert.equal(isLiveToGuests({ status: 'approved', stripe_payouts_enabled: true }), true);

    assert.equal(isLiveToGuests({ status: 'approved', stripe_payouts_enabled: false }), false,
        'approved but not connected is not live');
    assert.equal(isLiveToGuests({ status: 'pending_review', stripe_payouts_enabled: true }), false,
        'connected but not approved is not live');
    assert.equal(isLiveToGuests({ status: 'declined', stripe_payouts_enabled: true }), false);
    assert.equal(isLiveToGuests(null), false);
    assert.equal(isLiveToGuests({}), false, 'a missing payout flag is not a yes');
});

test('awaiting-connect is exactly approved-but-not-payable', () => {
    assert.equal(isAwaitingConnect({ status: 'approved', stripe_payouts_enabled: false }), true);
    assert.equal(isAwaitingConnect({ status: 'approved', stripe_payouts_enabled: true }), false,
        'a connected provider is not still waiting');
    assert.equal(isAwaitingConnect({ status: 'pending_review', stripe_payouts_enabled: false }), false,
        'not approved yet is a different state, and a different message');
});

// --- what it costs, and what is ours -----------------------------------------

const CHEF = { trade: 'chef', plan: 'commission', commission_rate: 0.10 };
const CAT: any[] = []; // no priced extras for the simple case

test('the guest pays the provider’s price, and 10% of it is ours', () => {
    const p = priceOrder(CHEF, { bandPrice: 200 }, CAT);
    assert.equal(p.price, 200, 'the guest pays exactly the provider’s price — no markup');
    assert.equal(p.commissionRate, 0.10);
    assert.equal(p.commission, 20);
    assert.equal(p.net, 180, 'the provider keeps the rest');
});

test('the pence figures reconcile to the penny', () => {
    // A price that does not divide cleanly by ten is where a double-rounded fee
    // drifts. amount − fee must be exactly the provider's net, always.
    const p = priceOrder(CHEF, { bandPrice: 199.99 }, CAT);
    assert.equal(p.amountPence, 19999);
    assert.equal(p.amountPence - p.applicationFeePence, Math.round(p.net * 100),
        'amount minus our fee is exactly the provider’s net');
});

test('a subscription provider pays no commission — and so should never be here', () => {
    // Guarded because commissionRateFor returns 0 for a subscription plan. A
    // subscription guest provider would take the whole price with no fee, which
    // is the signal that such a provider should not be on this path at all.
    const sub = { trade: 'chef', plan: 'subscription' };
    const p = priceOrder(sub, { bandPrice: 200 }, CAT);
    assert.equal(p.commission, 0);
    assert.equal(p.applicationFeePence, 0);
});

test('a free experience is priced, not refused', () => {
    const p = priceOrder(CHEF, { bandPrice: 0 }, CAT);
    assert.equal(p.price, 0);
    assert.equal(p.amountPence, 0);
    assert.equal(p.applicationFeePence, 0);
});

// --- the state machine -------------------------------------------------------

test('a held card may be captured, declined, expired or cancelled — nothing else', () => {
    assert.equal(canTransition('authorised', 'confirmed'), true);
    assert.equal(canTransition('authorised', 'declined'), true);
    assert.equal(canTransition('authorised', 'expired'), true);
    assert.equal(canTransition('authorised', 'cancelled'), true);

    // Not straight to refunded — you cannot refund money that was only held.
    assert.equal(canTransition('authorised', 'refunded'), false,
        'a hold is released, not refunded — no money was taken');
});

test('only a confirmed order can be refunded', () => {
    assert.equal(canTransition('confirmed', 'refunded'), true);
    assert.equal(canTransition('declined', 'refunded'), false);
    assert.equal(canTransition('expired', 'refunded'), false);
    assert.equal(canTransition('cancelled', 'refunded'), false);
});

test('an ended order is ended', () => {
    for (const terminal of ['declined', 'expired', 'cancelled', 'refunded'] as const) {
        for (const to of ['authorised', 'confirmed', 'declined', 'refunded'] as const) {
            assert.equal(canTransition(terminal, to), false,
                terminal + ' → ' + to + ' must be impossible');
        }
    }
});

test('a confirmed order cannot be re-confirmed or quietly cancelled', () => {
    assert.equal(canTransition('confirmed', 'confirmed'), false);
    assert.equal(canTransition('confirmed', 'cancelled'), false,
        'once captured, unwinding is a refund with a policy, not a cancel');
});

test('the three no-money endings are named as a set', () => {
    assert.equal(releasesHold('declined'), true);
    assert.equal(releasesHold('expired'), true);
    assert.equal(releasesHold('cancelled'), true);
    assert.equal(releasesHold('confirmed'), false, 'confirm captures, it does not release');
    assert.equal(releasesHold('refunded'), false);
});

// --- the confirm window ------------------------------------------------------

test('the window is inside Stripe’s seven-day hold', () => {
    assert.ok(CONFIRM_WINDOW_HOURS < 7 * 24,
        'the platform must release the hold before Stripe expires it');
});

test('expiry is the window added to creation', () => {
    const created = '2026-09-01T10:00:00.000Z';
    const expires = expiryFrom(created);
    const gapHours = (new Date(expires).getTime() - new Date(created).getTime()) / (60 * 60 * 1000);
    assert.equal(gapHours, CONFIRM_WINDOW_HOURS);
});

// --- the launch switch -------------------------------------------------------

test('guest experiences are closed unless the env var is exactly "true"', () => {
    const prev = process.env.GUEST_EXPERIENCES_OPEN;
    try {
        delete process.env.GUEST_EXPERIENCES_OPEN;
        assert.equal(guestExperiencesOpen(), false, 'absent is closed');

        process.env.GUEST_EXPERIENCES_OPEN = 'false';
        assert.equal(guestExperiencesOpen(), false);

        process.env.GUEST_EXPERIENCES_OPEN = 'TRUE';
        assert.equal(guestExperiencesOpen(), false, 'only the exact string true opens it');

        process.env.GUEST_EXPERIENCES_OPEN = '1';
        assert.equal(guestExperiencesOpen(), false);

        process.env.GUEST_EXPERIENCES_OPEN = 'true';
        assert.equal(guestExperiencesOpen(), true, 'the one value that opens it');
    } finally {
        if (prev === undefined) delete process.env.GUEST_EXPERIENCES_OPEN;
        else process.env.GUEST_EXPERIENCES_OPEN = prev;
    }
});
