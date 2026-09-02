// The nudge that tells someone a reply is waiting on them.
//
// The failure this guards, from 31 August 2026: a message with booking_id null
// (a job thread, and later an order thread) collapsed into a single bucket keyed
// "null"; the null travelled into `.in('id', bookingIds)`; Postgres answered
// `invalid input syntax for type uuid: "null"`; the lookup returned no rows; and
// every message — booking ones included — fell through the "no booking" skip.
// ok:true, emailed:0 — indistinguishable from a quiet hour.
//
// The unified-inbox pass (2 September 2026) removed the booking_id-null filter so
// the nudge chases all three kinds. The protection MOVED rather than went away:
// the run now PARTITIONS by kind — the booking pipeline runs on booking rows
// only, so every id it hands to `.in()` is a real booking id, and the enquiry
// and order kinds are chased down their own paths. This file guards the moved
// protection: a null booking_id must still never reach `.in('id', …)`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, fakeSupabase, installAliases } from './helpers/stub';

installAliases();

process.env.CRON_SECRET = 'test-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/cron/needs-reply/route';

function loadRoute(supabaseClient: any) {
    const logged: any[] = [];

    stubModule('@supabase/supabase-js', { createClient: () => supabaseClient });
    stubModule('@/lib/logError', {
        logError: async (message: string, detail: any, context: any) => {
            logged.push({ message, detail, context });
        },
    });
    stubModule('@/lib/email', {
        sendEmail: async () => true,
        emailLayout: () => '',
        escapeHtml: (s: string) => s,
        formatDate: () => '',
        button: () => '',
        SITE_URL: 'http://example.invalid',
    });
    stubModule('next/server', {
        NextResponse: {
            json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }),
        },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, logged };
}

const authorised = () =>
    new Request('http://example.invalid/api/cron/needs-reply?x=1', {
        headers: { authorization: 'Bearer test-secret' },
    });

test('an unauthorised call is refused', async () => {
    const { client } = fakeSupabase({});
    const { route } = loadRoute(client);
    const res: any = await route.GET(new Request('http://example.invalid/x'));
    assert.equal(res.status, 401);
});

// THE ONE THAT MATTERS. The messages query now returns every kind (no filter),
// and a null booking_id must never reach `.in('id', …)`. Fed one booking message
// and one order message (booking_id null), the run must hand the bookings lookup
// the real id ONLY — never the null.
test('a null booking_id never reaches the bookings lookup', async () => {
    let messageOps: any[] = [];
    let bookingInArgs: any = null;
    const old = '2020-01-01T00:00:00.000Z';

    const { client } = fakeSupabase({
        messages: (state: any) => {
            messageOps = state.ops;
            return {
                data: [
                    { id: 'm1', booking_id: 'b1', enquiry_id: null, order_id: null, sender_id: 'g', recipient_id: 'someone-else', body: 'x', created_at: old },
                    { id: 'm2', booking_id: null, enquiry_id: null, order_id: 'o1', sender_id: 'p', recipient_id: 'guest', body: 'x', created_at: old },
                ],
                error: null,
            };
        },
        bookings: (state: any) => {
            const inOp = state.ops.find((o: any) => o.op === 'in' && o.args[0] === 'id');
            if (inOp) bookingInArgs = inOp.args[1];
            return { data: [{ id: 'b1', host_id: 'host', guest_id: 'g', listing_id: 'l1', check_in: '2020-01-01', check_out: '2020-01-02', status: 'confirmed' }], error: null };
        },
        // Empty everywhere else the run reads, so it reaches the lookup and stops.
        listings: { data: [], error: null },
        conversation_prefs: { data: [], error: null },
        sent_reply_nudges: { data: [], error: null },
        service_orders: { data: [], error: null },
    });

    const { route } = loadRoute(client);
    await route.GET(authorised());

    const excluded = messageOps.some((o: any) =>
        o.op === 'not' && o.args[0] === 'booking_id' && o.args[1] === 'is' && o.args[2] === null);
    assert.equal(excluded, false, 'the filter is gone — the query now returns every kind');

    assert.ok(bookingInArgs, 'the bookings lookup ran');
    assert.equal(bookingInArgs.includes(null), false, 'a null booking_id must never reach .in(id)');
    assert.deepEqual(bookingInArgs, ['b1'], 'only real booking ids reach the bookings lookup');
});

// The silence was the expensive half. Both queries used to drop their error on
// the floor, so a failure looked identical to a quiet hour.
test('a failure to read the messages is reported, not reported as a quiet hour', async () => {
    const { client } = fakeSupabase({
        messages: { data: null, error: { message: 'boom' } },
    });

    const { route, logged } = loadRoute(client);
    const res: any = await route.GET(authorised());

    assert.equal(res.status, 500, 'a broken read is not a successful run');
    assert.equal(res.body.ok, false);
    assert.equal(logged.length >= 1, true, 'and it reaches /admin/errors');
});
