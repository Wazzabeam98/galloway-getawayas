// The package notice at the experience checkout (lib/packageNotice.ts).
//
// What these pin down, as intent:
//   * the notice applies only to the signed-in guest's OWN stay that is
//     confirmed AND paid, and only when the experience day is within it —
//     check-in day and check-out day both count;
//   * the server's decision reads the database with the session user's id, so a
//     planted/unpaid/cancelled stay, or somebody else's stay, never triggers it;
//   * the order records the version and time only when it applied, and nothing
//     the browser sends can switch it on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule, fakeSupabase } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const {
    PACKAGE_NOTICE_VERSION, PACKAGE_NOTICE_TEXT,
    stayCoversDate, coveringStayWindows, hasCoveringStay, packageNoticeRecord,
    packageNoticeMetadata, packageNoticeFromMetadata,
} = require('../lib/packageNotice');

const ME = 'guest-me';
const stay = (over: any = {}) => ({
    guest_id: ME, status: 'confirmed', payment_status: 'paid',
    check_in: '2026-10-10', check_out: '2026-10-14', ...over,
});

// ---- the pure rule -----------------------------------------------------------

test('the wording and its version live in one place', () => {
    assert.match(PACKAGE_NOTICE_VERSION, /^v\d+-\d{4}-\d{2}-\d{2}$/);
    assert.match(PACKAGE_NOTICE_TEXT, /this experience only/);
    assert.match(PACKAGE_NOTICE_TEXT, /isn’t part of a package with your stay/);
    assert.match(PACKAGE_NOTICE_TEXT, /isn’t protected as a package holiday/);
});

test('a confirmed, paid stay covers every day from check-in to check-out, both ends included', () => {
    const w = coveringStayWindows([stay()], ME);
    assert.equal(hasCoveringStay(w, '2026-10-12'), true, 'mid-stay');
    assert.equal(hasCoveringStay(w, '2026-10-10'), true, 'check-in day');
    assert.equal(hasCoveringStay(w, '2026-10-14'), true, 'check-out day');
    assert.equal(hasCoveringStay(w, '2026-10-09'), false, 'the day before arrival');
    assert.equal(hasCoveringStay(w, '2026-10-15'), false, 'the day after departure');
});

test('a deposit-paid confirmed stay counts too', () => {
    assert.equal(hasCoveringStay(coveringStayWindows([stay({ payment_status: 'deposit_paid' })], ME), '2026-10-11'), true);
});

test('unpaid, pending, cancelled and refunded stays never show it', () => {
    for (const over of [
        { status: 'pending_payment', payment_status: 'unpaid' },
        { status: 'pending', payment_status: 'paid' },
        { status: 'confirmed', payment_status: 'unpaid' },   // host self-confirmed, no money
        { status: 'cancelled', payment_status: 'paid' },
        { status: 'confirmed', payment_status: 'refunded' },
        { status: 'declined', payment_status: 'paid' },
    ]) {
        assert.equal(hasCoveringStay(coveringStayWindows([stay(over)], ME), '2026-10-11'), false, JSON.stringify(over));
    }
});

test('somebody else’s stay never shows it, and nobody signed out sees it', () => {
    assert.equal(hasCoveringStay(coveringStayWindows([stay({ guest_id: 'someone-else' })], ME), '2026-10-11'), false);
    assert.deepEqual(coveringStayWindows([stay()], null), []);
});

test('no date, or a malformed one, is never covered', () => {
    const w = coveringStayWindows([stay()], ME);
    assert.equal(hasCoveringStay(w, null), false);
    assert.equal(hasCoveringStay(w, ''), false);
    assert.equal(hasCoveringStay(w, 'next tuesday'), false);
    assert.equal(stayCoversDate({ checkIn: '2026-10-10', checkOut: '2026-10-14' }, '2026-10-12T23:30:00Z'), true, 'a timestamp is read as its day key');
});

// ---- the server's decision ---------------------------------------------------

// A bookings table that honours the filters the helper asks for, so the test
// proves the QUERY is pinned to the user and the rule — not just the JS filter.
function bookingsAdmin(rows: any[]) {
    const seen: any[] = [];
    const fake = fakeSupabase({
        bookings: (state: any) => {
            seen.push(state.ops);
            let out = rows.slice();
            for (const { op, args } of state.ops) {
                const [col, val] = args;
                if (op === 'eq') out = out.filter((r) => r[col] === val);
                if (op === 'in') out = out.filter((r) => val.includes(r[col]));
                if (op === 'lte') out = out.filter((r) => r[col] <= val);
                if (op === 'gte') out = out.filter((r) => r[col] >= val);
            }
            return { data: out, error: null };
        },
    });
    return { admin: fake.client, seen };
}

test('the server records the version and time when the guest’s own confirmed stay covers the day', async () => {
    const { admin, seen } = bookingsAdmin([stay()]);
    const rec = await packageNoticeRecord(admin, ME, '2026-10-14', '2026-09-30T10:00:00.000Z');
    assert.deepEqual(rec, { package_notice_version: PACKAGE_NOTICE_VERSION, package_notice_shown_at: '2026-09-30T10:00:00.000Z' });
    assert.ok(seen[0].some((o: any) => o.op === 'eq' && o.args[0] === 'guest_id' && o.args[1] === ME), 'the query is pinned to the session user');
});

test('the server records nothing without a covering stay', async () => {
    const cases: Array<[string, any[], string]> = [
        ['no stays at all', [], '2026-10-12'],
        ['date outside the stay', [stay()], '2026-10-20'],
        ['unpaid stay', [stay({ status: 'pending_payment', payment_status: 'unpaid' })], '2026-10-12'],
        ['cancelled stay', [stay({ status: 'cancelled' })], '2026-10-12'],
        ['someone else’s stay', [stay({ guest_id: 'someone-else' })], '2026-10-12'],
    ];
    for (const [name, rows, date] of cases) {
        const { admin } = bookingsAdmin(rows);
        assert.equal(await packageNoticeRecord(admin, ME, date, 'now'), null, name);
    }
    const { admin } = bookingsAdmin([stay()]);
    assert.equal(await packageNoticeRecord(admin, null, '2026-10-12', 'now'), null, 'signed out');
});

test('a failed read records nothing rather than guessing', async () => {
    const admin = fakeSupabase({ bookings: { data: null, error: { message: 'boom' } } }).client;
    assert.equal(await packageNoticeRecord(admin, ME, '2026-10-12', 'now'), null);
});

test('the checkout metadata carries the decision and the order reads it back only when set', () => {
    const rec = { package_notice_version: PACKAGE_NOTICE_VERSION, package_notice_shown_at: '2026-09-30T10:00:00.000Z' };
    assert.deepEqual(packageNoticeFromMetadata(packageNoticeMetadata(rec)), rec);
    assert.deepEqual(packageNoticeMetadata(null), { package_notice_version: '', package_notice_shown_at: '' });
    assert.deepEqual(packageNoticeFromMetadata(packageNoticeMetadata(null)), {});
    assert.deepEqual(packageNoticeFromMetadata({}), {});
});

// ---- the request/cart order row ---------------------------------------------

stubModule('@/lib/email', {
    sendEmail: async () => {}, emailLayout: () => '', escapeHtml: (s: any) => String(s), button: () => '',
    noteCallout: () => '', allergyCallout: () => '', formatDate: (s: any) => String(s),
    NEUTRAL_SUBTITLE: '', SITE_URL: 'http://example.invalid',
});
stubModule('@/lib/stripe', { stripeRequest: async () => ({}) });
stubModule('@/lib/logError', { logError: async () => {} });
stubModule('@/lib/supabaseAdmin', { adminClient: () => ({}) });
const { createRequestOrderFromSession } = require('@/lib/requestOrder');

async function insertFor(extraMeta: Record<string, string>) {
    let inserted: any = null;
    const admin = fakeSupabase({
        service_orders: (state: any) => {
            const ins = state.ops.find((o: any) => o.op === 'insert');
            if (ins) { inserted = ins.args[0]; return { data: { id: 'order-1' }, error: null }; }
            return { data: null, error: null };
        },
        service_providers: { data: { id: 'prov-1', business_name: 'Loch Chef', trade: 'chef', shape: 'comes_to_you', contact_email: 'p@example.com', exclusive_per_date: true }, error: null },
        profiles: { data: { id: ME, full_name: 'Sam Guest', email: 'sam@example.com' }, error: null },
    }).client;
    await createRequestOrderFromSession(admin, {
        metadata: {
            kind: 'service_order', provider_id: 'prov-1', booking_id: '', guest_id: ME, listing_id: '',
            service_date: '2026-10-12', service_time: '18:00', fulfilment: 'delivery', standalone: '1',
            commission_rate: '0.10', item_name: 'Dinner', item_unit: 'flat', ...extraMeta,
        },
        payment_intent: 'pi_test_pkg', amount_total: 12000,
    });
    return inserted;
}

test('a request order records the notice when checkout decided it applied', async () => {
    const row = await insertFor(packageNoticeMetadata({ package_notice_version: PACKAGE_NOTICE_VERSION, package_notice_shown_at: '2026-09-30T10:00:00.000Z' }));
    assert.equal(row.package_notice_version, PACKAGE_NOTICE_VERSION);
    assert.equal(row.package_notice_shown_at, '2026-09-30T10:00:00.000Z');
});

test('a request order without a covering stay records nothing', async () => {
    const row = await insertFor(packageNoticeMetadata(null));
    assert.equal(row.package_notice_version, undefined);
    assert.equal(row.package_notice_shown_at, undefined);
});

// ---- the browser cannot switch it on ----------------------------------------

// Both order-creating routes must take the decision from packageNoticeRecord,
// fed the session user's id — and must not read any notice field from the
// request body. (The routes are not in the test build; this reads their source.)
test('the order routes decide from the session user, never from the request body', () => {
    for (const rel of ['app/api/services/slots/book/route.ts', 'app/api/services/order/route.ts']) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        assert.match(src, /packageNoticeRecord\(admin, user\.id,/, rel + ' decides with the signed-in user');
        assert.doesNotMatch(src, /body\s*(&&\s*body)?\.\s*package/i, rel + ' reads no package field from the body');
        assert.doesNotMatch(src, /body\s*\[\s*['"]package/i, rel + ' reads no package field from the body');
    }
});
