// The referral scheme's rules, proven on the pure logic in lib/referrals: no
// self-referral, first referral wins, only genuinely new hosts, invited →
// listed, and the reward-due stamp as an idempotent CLAIM. The real money
// (the waiver flowing through feeAmount(base, 0)) is proven end to end in
// scripts/payout-scenarios.mjs; here we hold the decision logic.
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
    REFERRAL_REWARD_GBP,
} = require('@/lib/referrals');
const { referralRewardDueEmail } = require('@/lib/referralEmails');

type Row = Record<string, any>;

// A tiny Supabase-shaped fake supporting exactly the chains lib/referrals uses:
// select / eq / in / order / limit / maybeSingle / insert / update, each either
// awaitable or terminating in maybeSingle. Rows are filtered for real.
function makeAdmin(seed: { referral_codes?: Row[]; referrals?: Row[]; listings?: Row[] } = {}) {
    const tables: Record<string, Row[]> = {
        referral_codes: seed.referral_codes ? seed.referral_codes.slice() : [],
        referrals: seed.referrals ? seed.referrals.slice() : [],
        listings: seed.listings ? seed.listings.slice() : [],
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
                // Enforce the unique(referred_user_id) and unique(code) the table
                // has, so first-wins and code minting behave as in production.
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

function withCodes() {
    return {
        referral_codes: [
            { user_id: 'alice', code: CODE_A },
            { user_id: 'bob', code: CODE_B },
        ],
    };
}

test('no self-referral: opening your own link records nothing', async () => {
    const admin = makeAdmin(withCodes());
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'alice', stage: 'invited' });
    assert.equal(out, 'none');
    assert.equal(admin._tables.referrals.length, 0);
});

test('a genuinely new person is recorded as invited', async () => {
    const admin = makeAdmin(withCodes());
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'carol', stage: 'invited' });
    assert.equal(out, 'invited');
    assert.equal(admin._tables.referrals.length, 1);
    assert.equal(admin._tables.referrals[0].referrer_id, 'alice');
    assert.equal(admin._tables.referrals[0].status, 'invited');
});

test('first referral wins: a second link cannot overwrite the first', async () => {
    const admin = makeAdmin({
        ...withCodes(),
        referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'invited' }],
    });
    const out = await attachReferral(admin, { code: CODE_B, referredUserId: 'carol', stage: 'invited' });
    assert.equal(out, 'noop');
    assert.equal(admin._tables.referrals.length, 1);
    assert.equal(admin._tables.referrals[0].referrer_id, 'alice'); // unchanged
});

test('invited advances to listed when they list', async () => {
    const admin = makeAdmin({
        ...withCodes(),
        referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'invited' }],
    });
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'carol', stage: 'listed' });
    assert.equal(out, 'listed');
    assert.equal(admin._tables.referrals[0].status, 'listed');
});

test('an already-established host is not recorded', async () => {
    const admin = makeAdmin({
        ...withCodes(),
        listings: [{ id: 'l1', host_id: 'dan', status: 'published' }],
    });
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'dan', stage: 'listed' });
    assert.equal(out, 'none');
    assert.equal(admin._tables.referrals.length, 0);
});

test('a first listing still in review does NOT count as established', async () => {
    const admin = makeAdmin({
        ...withCodes(),
        listings: [{ id: 'l1', host_id: 'carol', status: 'pending_review' }],
    });
    const out = await attachReferral(admin, { code: CODE_A, referredUserId: 'carol', stage: 'listed' });
    assert.equal(out, 'listed');
    assert.equal(admin._tables.referrals.length, 1);
});

test('waivableReferralFor returns the row only while status is listed', async () => {
    const listed = makeAdmin({ referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'listed' }] });
    assert.ok(await waivableReferralFor(listed, 'carol'));

    const invited = makeAdmin({ referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'invited' }] });
    assert.equal(await waivableReferralFor(invited, 'carol'), null);
});

test('markReferralRewardDue is an idempotent claim: stamps once, then null', async () => {
    const admin = makeAdmin({ referrals: [{ id: 'r1', referrer_id: 'alice', referred_user_id: 'carol', status: 'listed' }] });

    const first = await markReferralRewardDue(admin, { referredUserId: 'carol', bookingId: 'bk1', waivedCommission: 12.34 });
    assert.ok(first, 'the first claim returns the row');
    assert.equal(admin._tables.referrals[0].status, 'first_stay_done');
    assert.equal(admin._tables.referrals[0].reward_amount, REFERRAL_REWARD_GBP);
    assert.equal(admin._tables.referrals[0].waived_booking_id, 'bk1');
    assert.equal(admin._tables.referrals[0].waived_commission, 12.34);

    const second = await markReferralRewardDue(admin, { referredUserId: 'carol', bookingId: 'bk1', waivedCommission: 12.34 });
    assert.equal(second, null, 'a second run claims nothing — no double email');
});

test('getOrCreateReferralCode returns the existing code and does not mint a second', async () => {
    const admin = makeAdmin(withCodes());
    const code = await getOrCreateReferralCode(admin, 'alice');
    assert.equal(code, CODE_A);
    assert.equal(admin._tables.referral_codes.filter((r: Row) => r.user_id === 'alice').length, 1);
});

test('getOrCreateReferralCode mints one for a user who has none', async () => {
    const admin = makeAdmin(withCodes());
    const code = await getOrCreateReferralCode(admin, 'carol');
    assert.ok(code && code.length === 8, 'an 8-char code is minted');
    assert.equal(admin._tables.referral_codes.filter((r: Row) => r.user_id === 'carol').length, 1);
});

test('the reward-due email names the reward and both first names', () => {
    const mail = referralRewardDueEmail('Alice', 'Carol');
    assert.match(mail.subject, new RegExp('£' + REFERRAL_REWARD_GBP));
    assert.match(mail.html, /Alice/);
    assert.match(mail.html, /Carol/);
    assert.match(mail.html, new RegExp('£' + REFERRAL_REWARD_GBP));
});
