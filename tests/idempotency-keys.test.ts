// The keys that stop money moving twice.
//
// Mutation testing found that `payout-<booking>` was asserted nowhere: it
// could be replaced with a random value and all 75 tests still passed. That
// is the only thing stopping a host being paid twice for one stay, and this
// class of bug has already cost a double payment once and been found a second
// time in the balance charge.
//
// Its own comment claims "this stay can never pay out twice however the data
// is later edited". Nothing checked the claim. These do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.CRON_SECRET = 'test-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/cron/host-payouts/route';

const BOOKING = {
    id: 'b1', listing_id: 'l1', host_id: 'h1', check_in: '2026-01-01',
    total_price: 500, amount_paid: 500, amount_refunded: 0,
    commission_rate: 10, status: 'confirmed', payment_status: 'paid', paid_out_at: null,
};

function load(booking: any) {
    const keys: (string | undefined)[] = [];

    const handlers: Record<string, any> = {
        bookings: (state: any) =>
            state.ops.some((o: any) => o.op === 'update')
                ? { data: null, error: null }
                : { data: [booking], error: null },
        profiles: (state: any) =>
            state.ops.some((o: any) => o.op === 'update')
                ? { data: null, error: null }
                : {
                    data: {
                        id: booking.host_id, stripe_account_id: 'acct_test',
                        stripe_payouts_enabled: true, payout_balance_owed: 0,
                    },
                    error: null,
                },
        listings: { data: { title: 'A cottage', commission_rate: 10 }, error: null },
        payouts: { data: [], error: null },
    };

    function builder(table: string) {
        const state: any = { table, ops: [] };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') {
                    const h = handlers[table] ?? { data: [], error: null };
                    const v = typeof h === 'function' ? h(state) : h;
                    return (resolve: any) => resolve(v);
                }
                return (...args: any[]) => { state.ops.push({ op: prop, args }); return chain; };
            },
        });
        return chain;
    }

    const client = {
        from: (t: string) => builder(t),
        auth: { admin: { getUserById: async () => ({ data: { user: { email: '' } } }) } },
    };

    stubModule('@supabase/supabase-js', { createClient: () => client });
    stubModule('@/lib/logError', { logError: async () => undefined });
    stubModule('@/lib/stripe', {
        stripeRequest: async (_m: string, path: string, _b: any, key?: string) => {
            if (path === '/transfers') keys.push(key);
            return { id: 'tr_test' };
        },
    });
    stubModule('@/lib/email', {
        sendEmail: async () => true, emailLayout: () => '', escapeHtml: (s: string) => s,
        formatDate: () => '', button: () => '', SITE_URL: 'http://example.invalid',
    });
    stubModule('@/lib/payoutTiming', {
        readSchedule: async () => null,
        arrivalSentence: () => '',
    });
    stubModule('next/server', {
        NextResponse: { json: (b: any, i?: any) => ({ body: b, status: (i && i.status) || 200 }) },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    return { route: require(ROUTE.replace('@/', '../')), keys };
}

const authorised = () =>
    new Request('http://example.invalid/api/cron/host-payouts', {
        headers: { authorization: 'Bearer test-secret' },
    });

test('a payout is keyed on the booking, and nothing else', async () => {
    const { route, keys } = load(BOOKING);
    await route.GET(authorised());

    assert.equal(keys.length, 1, 'one transfer');
    assert.equal(
        keys[0],
        'payout-b1',
        'one payout per booking, ever — the booking id alone is the attempt'
    );
});

// The claim its comment makes: "built from the booking alone, so this stay can
// never pay out twice however the data is later edited". Every one of these
// fields moves in normal operation — a refund changes amount_refunded, a
// commission renegotiation changes the rate, a repair script touches almost
// anything. None may reach the key.
test('the key survives the booking being edited underneath it', async () => {
    const first = load(BOOKING);
    await first.route.GET(authorised());

    const edited = load({
        ...BOOKING,
        amount_refunded: 120,
        commission_rate: 15,
        total_price: 900,
        amount_paid: 900,
        check_in: '2026-06-30',
        payment_status: 'partially_refunded',
    });
    await edited.route.GET(authorised());

    assert.equal(
        edited.keys[0],
        first.keys[0],
        'the same stay must present the same key however its row has changed'
    );
});

test('two different stays get two different keys', async () => {
    const a = load(BOOKING);
    await a.route.GET(authorised());

    const b = load({ ...BOOKING, id: 'b2' });
    await b.route.GET(authorised());

    assert.notEqual(a.keys[0], b.keys[0], 'or the second stay would never pay out');
});

test('the key is deterministic — the same run twice presents the same key', async () => {
    const once = load(BOOKING);
    await once.route.GET(authorised());
    const twice = load(BOOKING);
    await twice.route.GET(authorised());

    assert.equal(
        once.keys[0],
        twice.keys[0],
        'a retried run must be recognised by Stripe as the same request'
    );
});
