// The rules a guest order runs on: who is live, what it costs, what is ours,
// and which state may follow which. No database, no Stripe — a wrong number
// here is wrong whatever the routes do with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

import {
    TRADE_MCC, ASSIGNABLE_MCCS, mccForTrade, mccForProvider, stripeProfileForTrade, stripeProfileForProvider,
    isLiveToGuests, isAwaitingConnect,
    priceOrder, exclusivePerDate,
    canTransition, releasesHold,
    CONFIRM_WINDOW_HOURS, expiryFrom, guestExperiencesOpen,
    FREE_CANCEL_HOURS, guestMayCancelFree,
} from '@/lib/serviceOrders';
import { GUEST_TRADES } from '@/lib/serviceProviders';

// --- who Stripe thinks each provider is --------------------------------------

test('no guest trade carries a fixed MCC — the code is assigned per provider', () => {
    // The change this locks: there is no preset guest trade any more, so there
    // is no fixed category to look up. mccForTrade answers null for the guest
    // sentinel exactly as it does for a host trade — which is what holds an
    // un-categorised provider out of onboarding until the owner assigns a code.
    assert.deepEqual(TRADE_MCC, {}, 'no fixed per-trade codes remain');
    for (const trade of GUEST_TRADES as unknown as string[]) {
        assert.equal(mccForTrade(trade), null, trade + ' must have no fixed code');
    }
});

test('a guest provider has no fixed code, but an assigned one resolves and gates', () => {
    // No fixed code — which is exactly what holds an un-categorised guest
    // provider out of Stripe onboarding until the owner picks one at review.
    assert.equal(mccForProvider({ trade: 'guest' }), null, 'an un-categorised guest has no code');
    assert.equal(stripeProfileForProvider({ trade: 'guest' }), null, 'and so cannot be onboarded');

    // Once the owner assigns a code on the row, that provider resolves — so it
    // is not filtered out of the guest surface for having no fixed table entry.
    assert.equal(mccForProvider({ trade: 'guest', stripe_mcc: '7299' }), '7299');
    const profile = stripeProfileForProvider({
        trade: 'guest', stripe_mcc: '7299', stripe_product_description: 'Massage therapy for holiday guests.',
    });
    assert.equal(profile && profile.mcc, '7299');
    assert.ok(profile && profile.product_description.length > 0);

    // The assigned code is the ONLY way a guest provider resolves now — there is
    // no fixed fallback behind it.
    assert.equal(mccForProvider({ trade: 'guest' }), null);
});

test('a host trade or unknown value has no guest code', () => {
    assert.equal(mccForTrade('sponge'), null, 'a host trade is not a guest experience');
    assert.equal(mccForTrade(''), null);
    assert.equal(mccForTrade('nonsense'), null);
});

test('lodging can never be a guest category', () => {
    // 7011 is lodging. No guest experience may carry it — that is the whole
    // reason the provider gets its own account. With no fixed table left, the
    // guard is that the owner cannot ASSIGN it either.
    assert.ok(!ASSIGNABLE_MCCS.some((m) => m.code === '7011'), 'lodging is not assignable');
    for (const code of Object.values(TRADE_MCC)) {
        assert.notEqual(code, '7011');
    }
});

test('there is no fixed Stripe profile — it comes from the assigned code', () => {
    // TRADE_STRIPE_DESCRIPTION is empty, so stripeProfileForTrade yields nothing;
    // that is what stops the connect route onboarding on a trade alone. The
    // profile a provider onboards with is the per-provider one the owner set.
    assert.equal(stripeProfileForTrade('guest'), null);
    assert.equal(stripeProfileForTrade('chef'), null, 'no fixed chef profile any more');
    assert.equal(stripeProfileForTrade(''), null);

    const profile = stripeProfileForProvider({
        trade: 'guest', stripe_mcc: '5811', stripe_product_description: 'Private chef for holiday guests.',
    });
    assert.equal(profile && profile.mcc, '5811');
    assert.ok(profile && profile.product_description.length > 0);
});

test('exclusivity is a per-provider flag, not a trade', () => {
    // The chef-only rule became exclusive_per_date, set by the owner at review
    // and snapshotted onto the order. The order route pre-check and the partial
    // unique index both read it.
    assert.equal(exclusivePerDate({ exclusive_per_date: true }), true, 'a chef/masseur holds the date');
    assert.equal(exclusivePerDate({ exclusive_per_date: false }), false, 'a baker does not');
    assert.equal(exclusivePerDate({}), false, 'unset is not exclusive');
    assert.equal(exclusivePerDate(null), false);
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

// Free cancellation follows the provider's own "48 hours ahead" promise: at or
// beyond the window it is free (a full refund on a confirmed booking), inside it
// the provider decides. Measured to the start of the service date.
test('free cancellation holds the 48-hour line', () => {
    const svc = '2026-09-20';
    const start = new Date(svc + 'T00:00:00Z').getTime();
    const hoursBefore = (h: number) => new Date(start - h * 3600 * 1000);

    assert.equal(FREE_CANCEL_HOURS, 48);
    assert.equal(guestMayCancelFree(svc, hoursBefore(72)), true, 'three days out is free');
    assert.equal(guestMayCancelFree(svc, hoursBefore(49)), true, 'just outside the window is free');
    assert.equal(guestMayCancelFree(svc, hoursBefore(48)), true, 'exactly 48h is free (at or beyond)');
    assert.equal(guestMayCancelFree(svc, hoursBefore(47)), false, 'inside 48h is the provider’s call');
    assert.equal(guestMayCancelFree(svc, hoursBefore(1)), false, 'the day before is not free');
    assert.equal(guestMayCancelFree('not-a-date', hoursBefore(72)), false, 'an unparseable date is never free');
});
