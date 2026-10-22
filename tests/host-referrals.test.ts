// The referral scheme's rules, proven on the pure logic in lib/referrals across
// all three types (stay / experience / trade): no self-referral, first referral
// wins, only genuinely new hosts/providers, invited → active with the type set,
// the type-matched waiver lookup, and the reward-due stamp as an idempotent
// CLAIM with the right amount per type. The real money (the waiver flowing
// through the payout calcs) is proven end to end in the scenario scripts; here
// we hold the decision logic.
//
// Nothing here reaches a database. A small in-memory fake stands in for the
// service-role client, filtering rows for real so first-wins and the claim are
// genuinely exercised rather than asserted against a mock that always agrees.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    attachReferral,
    markReferralRewardDue,
    waivableReferralFor,
    getOrCreateReferralCode,
    REFERRAL_REWARDS,
} = require('@/lib/referrals');
const { referralRewardDueEmail } = require('@/lib/referralEmails');

type Row = Record<string, any>;

// A tiny Supabase-shaped fake supporting exactly the chains lib/referrals uses:
// select / eq / in / order / limit / maybeSingle / insert / update, each either
// awaitable or terminating in maybeSingle. Rows are filtered for real.
function makeAdmin(seed: { referral_codes?: Row[]; referrals?: Row[]; listings?: Row[]; service_providers?: Row[] } = {}) {
    const tables: Record<string, Row[]> = {
        referral_codes: seed.referral_codes ? seed.referral_codes.slice() : [],
        referrals: seed.referrals ? seed.referrals.slice() : [],
        listings: seed.listings ? seed.listings.slice() : [],
        service_providers: seed.service_providers ? seed.service_providers.slice() : [],
    };

    function builder(table: string) {
        const filters: Array<{ col: string; op: 'eq' | 'in'; val?: any; vals?: any[] }> = [];
        let limitN: number | null = null;

        const match = () => {
            let rows = tables[table].slice();
            for (const f of filters) {
                if (f.op === 'eq') rows = rows.filter((r) => r[f.col] === f.val);
                else rows = rows.filter((r) => (f.vals as any[]).includes(r[f.col]));
            }
            if (limitN !== null) rows = rows.slice(0, limitN);
            return rows;
        };

        const api: any = {
            select() { return api; },
            order() { return api; },
            eq(col: string, val: any) { filters.push({ col, op: 'eq', val }); return api; },
            in(col: string, vals: any[]) { filters.push({ col, op: 'in', vals }); return api; },
            limit(n: number) { limitN = n; return api; },
            maybeSingle() { return Promise.resolve({ data: match()[0] || null, error: null }); },
            then(resolve: any) { return resolve({ data: match(), error: null }); },

            insert(row: Row) {
                const conflict =
                    (table === 'referrals' && tables.referrals.some((r) => r.referred_user_id === row.referred_user_id)) ||
                    (table === 'referral_codes' && tables.referral_codes.some((r) => r.code === row.code));
                const err = conflict ? { message: 'duplicate key value violates unique constraint' } : null;
                if (!err) tables[table].push({ ...row });
                const result = { data: err ? null : { ...row }, error: err };
                return {
                    select() { return this; },
                    maybeSingle() { return Promise.resolve(result); },
                    then(resolve: any) { return resolve(result); },
                };
            },

            update(patch: Row) {
                const upFilters: Array<{ col: string; val: any }> = [];
                const applyAndReturn = () => {
                    const hit = tables[table].filter((r) => upFilters.every((f) => r[f.col] === f.val));
                    hit.forEach((r) => Object.assign(r, patch));
                    return { data: hit[0] ? { ...hit[0] } : null, error: null };
                };
                const up: any = {
                    eq(col: string, val: any) { upFilters.push({ col, val }); return up; },
                    select() { return up; },
                    maybeSingle() { return Promise.resolve(applyAndReturn()); },
                    then(resolve: any) { return resolve(applyAndReturn()); },
                };
                return up;
            },
        };
        return api;
    }

    return { from: builder, _tables: tables } as any;
}

const CODE_A = 'AAAA1111';
const CODE_B = 'BBBB2222';

function withCodes(extra: Partial<Parameters<typeof makeAdmin>[0]> = {}) {
    return {
        referral_codes: [
            { user_id: 'alice', code: CODE_A },
            { user_id: 'bob', code: CODE_B },
        ],
        ...extra,
    };
}

test('no self-referral: opening your own link records nothing', async () => {
    const admin = makeAdmin(withCodes());
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'alice', stage: 'invited' });
    assert.equal(out, 'none');
    assert.equal(admin._tables.referrals.length, 0);
});

test('a genuinely new person is recorded as invited (no type yet)', async () => {
    const admin = makeAdmin(withCodes());
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'carol', stage: 'invited' });
    assert.equal(out, 'invited');
    assert.equal(admin._tables.referrals.length, 1);
    assert.equal(admin._tables.referrals[0].status, 'invited');
    assert.equal(admin._tables.referrals[0].type, null);
});

test('first referral wins: a second link cannot overwrite the first', async () => {
    const admin = makeAdmin({
        ...withCodes(),
        referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'invited', type: null }],
    });
    const out = await attachReferral(admin, { code: CODE_B, referredUserId: 'carol', stage: 'invited' });
    assert.equal(out, 'noop');
    assert.equal(admin._tables.referrals[0].referrer_id, 'alice');
});

test('invited advances to active and stamps the type when they list a holiday let', async () => {
    const admin = makeAdmin({
        ...withCodes(),
        referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'invited', type: null }],
    });
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'carol', stage: 'active', type: 'stay' });
    assert.equal(out, 'active');
    assert.equal(admin._tables.referrals[0].status, 'active');
    assert.equal(admin._tables.referrals[0].type, 'stay');
});

test('an established host is not recorded for a stay', async () => {
    const admin = makeAdmin({ ...withCodes(), listings: [{ id: 'l1', host_id: 'dan', status: 'published' }] });
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'dan', stage: 'active', type: 'stay' });
    assert.equal(out, 'none');
    assert.equal(admin._tables.referrals.length, 0);
});

test('an established experience provider is not recorded for an experience', async () => {
    const admin = makeAdmin({
        ...withCodes(),
        service_providers: [{ id: 'p1', owner_id: 'erin', audience: 'guest', status: 'approved' }],
    });
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'erin', stage: 'active', type: 'experience' });
    assert.equal(out, 'none');
    assert.equal(admin._tables.referrals.length, 0);
});

test('a provider still in review does NOT count as established', async () => {
    const admin = makeAdmin({
        ...withCodes(),
        service_providers: [{ id: 'p1', owner_id: 'carol', audience: 'guest', status: 'pending_review' }],
    });
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'carol', stage: 'active', type: 'experience' });
    assert.equal(out, 'active');
    assert.equal(admin._tables.referrals[0].type, 'experience');
});

test('a trade (audience host) is independent of an experience (audience guest) for the established check', async () => {
    // Carol runs an approved experience but is new as a trade — refer her as a trade.
    const admin = makeAdmin({
        ...withCodes(),
        service_providers: [{ id: 'p1', owner_id: 'carol', audience: 'guest', status: 'approved' }],
    });
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'carol', stage: 'active', type: 'trade' });
    assert.equal(out, 'active');
    assert.equal(admin._tables.referrals[0].type, 'trade');
});

test('waivableReferralFor matches on type, not just status', async () => {
    const admin = makeAdmin({ referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'active', type: 'experience' }] });
    assert.ok(await waivableReferralFor(admin, 'carol', 'experience'));
    assert.equal(await waivableReferralFor(admin, 'carol', 'stay'), null);
});

test('markReferralRewardDue stamps the stay amount and the booking', async () => {
    const admin = makeAdmin({ referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'active', type: 'stay' }] });
    const row = await markReferralRewardDue(admin, { referredUserId: 'carol', type: 'stay', waivedBookingId: 'bk1', waivedCommission: 48.33 });
    assert.ok(row);
    assert.equal(admin._tables.referrals[0].status, 'reward_due');
    assert.equal(admin._tables.referrals[0].reward_amount, REFERRAL_REWARDS.stay);
    assert.equal(admin._tables.referrals[0].waived_booking_id, 'bk1');
    assert.equal(admin._tables.referrals[0].waived_order_id, null);
});

test('markReferralRewardDue stamps the experience amount and the order', async () => {
    const admin = makeAdmin({ referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'active', type: 'experience' }] });
    const row = await markReferralRewardDue(admin, { referredUserId: 'carol', type: 'experience', waivedOrderId: 'so1', waivedCommission: 11 });
    assert.ok(row);
    assert.equal(admin._tables.referrals[0].reward_amount, REFERRAL_REWARDS.experience);
    assert.equal(admin._tables.referrals[0].waived_order_id, 'so1');
    assert.equal(admin._tables.referrals[0].waived_booking_id, null);
});

test('markReferralRewardDue stamps the trade amount and waives nothing', async () => {
    const admin = makeAdmin({ referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'active', type: 'trade' }] });
    const row = await markReferralRewardDue(admin, { referredUserId: 'carol', type: 'trade' });
    assert.ok(row);
    assert.equal(admin._tables.referrals[0].reward_amount, REFERRAL_REWARDS.trade);
    assert.equal(admin._tables.referrals[0].waived_booking_id, null);
    assert.equal(admin._tables.referrals[0].waived_order_id, null);
    assert.equal(admin._tables.referrals[0].waived_commission, null);
});

test('markReferralRewardDue is an idempotent claim: stamps once, then null', async () => {
    const admin = makeAdmin({ referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'active', type: 'stay' }] });
    const first = await markReferralRewardDue(admin, { referredUserId: 'carol', type: 'stay', waivedBookingId: 'bk1', waivedCommission: 5 });
    assert.ok(first);
    const second = await markReferralRewardDue(admin, { referredUserId: 'carol', type: 'stay', waivedBookingId: 'bk1', waivedCommission: 5 });
    assert.equal(second, null, 'a second run claims nothing — no double email');
});

test('the wrong-type claim does not fire: a stay payout cannot stamp an experience referral', async () => {
    const admin = makeAdmin({ referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'active', type: 'experience' }] });
    const row = await markReferralRewardDue(admin, { referredUserId: 'carol', type: 'stay', waivedBookingId: 'bk1' });
    assert.equal(row, null);
    assert.equal(admin._tables.referrals[0].status, 'active');
});

test('getOrCreateReferralCode returns the existing code and does not mint a second', async () => {
    const admin = makeAdmin(withCodes());
    const code = await getOrCreateReferralCode(admin, 'alice');
    assert.equal(code, CODE_A);
    assert.equal(admin._tables.referral_codes.filter((r: Row) => r.user_id === 'alice').length, 1);
});

test('getOrCreateReferralCode mints an 8-char code for a user who has none', async () => {
    const admin = makeAdmin(withCodes());
    const code = await getOrCreateReferralCode(admin, 'carol');
    assert.ok(code && code.length === 8);
});

test('the reward-due email names the right reward per type and both first names', () => {
    for (const type of ['stay', 'experience', 'trade'] as const) {
        const mail = referralRewardDueEmail('Alice', 'Carol', type);
        assert.match(mail.subject, new RegExp('£' + REFERRAL_REWARDS[type]));
        assert.match(mail.html, /Alice/);
        assert.match(mail.html, new RegExp('£' + REFERRAL_REWARDS[type]));
    }
});
