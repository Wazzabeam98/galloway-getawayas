// The nudge that tells a host somebody is waiting on them.
//
// It went silent on 31 August 2026 and these are the two assertions that would
// have caught it. Messages became polymorphic that afternoon — a message now
// hangs off either a booking or an enquiry — and this route is keyed on the
// booking from end to end: it groups by booking_id, looks the bookings up, and
// reads conversation_prefs and sent_reply_nudges by booking_id.
//
// A job-thread message has booking_id null. Every one of them collapsed into a
// single bucket keyed "null"; once the newest of those was older than the
// waiting threshold, the null travelled into `.in('id', bookingIds)`; Postgres
// answered `invalid input syntax for type uuid: "null"`; the lookup returned
// no rows; and every message — booking ones included — fell through the
// "no booking" skip. The route reported ok:true with emailed:0, which is
// exactly what a quiet hour looks like.
//
// Proven before it was fixed: with one legitimate 13-hour-old booking message
// and one 13-hour-old job message on the test database, the run went from
// {waiting:1, emailed:1} to {waiting:2, emailed:0, skipped:2}.

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

// THE ONE THAT MATTERS. The exclusion has to be asked of the database, because
// the database is what does the filtering — a message with no booking must
// never reach the grouping, where its null becomes a bucket key and then an
// argument to `.in()`.
test('the run asks the database for booking messages only', async () => {
    let messageOps: any[] = [];

    const { client } = fakeSupabase({
        messages: (state: any) => {
            messageOps = state.ops;
            return { data: [], error: null };
        },
    });

    const { route } = loadRoute(client);
    await route.GET(authorised());

    const excluded = messageOps.some((o: any) =>
        o.op === 'not' && o.args[0] === 'booking_id' && o.args[1] === 'is' && o.args[2] === null);

    assert.equal(excluded, true,
        'the messages query must exclude booking_id null, or job threads collapse '
        + 'into one bucket and put a null into .in()');
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
