// What the confirmation email actually says.
//
// It is the thing a guest keeps, and the three questions they ask in the ten
// minutes after paying — when does the rest come out, how long can I change my
// mind, and what do I get back if I do — were answered on the confirmation
// page and nowhere in the email.
//
// These assert on the rendered body rather than on the code path, because the
// figures in it are quoted back at a guest and a wrong one is a small broken
// promise. Nothing here sends an email or touches a database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/notify/route';

const HOST = 'host-1';
const GUEST = 'guest-1';

function load(booking: any) {
    const sent: any[] = [];

    const tables: Record<string, any> = {
        bookings: { data: booking, error: null },
        listings: { data: { title: 'Bookshop Flat', check_in_time: '15:00:00', check_out_time: '11:00:00' }, error: null },
        profiles: { data: { full_name: 'Alex Guest', preferred_name: null }, error: null },
        notification_preferences: { data: null, error: null },
    };

    function builder(table: string) {
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') {
                    const v = tables[table] ?? { data: null, error: null };
                    return (resolve: any) => resolve(v);
                }
                return () => chain;
            },
        });
        return chain;
    }

    const admin = {
        from: (t: string) => builder(t),
        auth: { admin: { getUserById: async () => ({ data: { user: { email: 'guest@example.invalid' } } }) } },
    };

    stubModule('@/lib/supabaseAdmin', { adminClient: () => admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: { id: HOST } } }) },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string, html: string) => {
            sent.push({ to, subject, html });
            return true;
        },
        emailLayout: (body: string) => body,
        escapeHtml: (s: string) => String(s),
        formatDate: (d: string) => String(d),
        button: () => '',
        detailRows: (rows: any[]) =>
            rows.map((r) => r.label + ': ' + r.value).join('\n'),
        SITE_URL: 'http://example.invalid',
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    // supabaseAdmin is stubbed directly above, so it must NOT be cleared here
    // — clearing it discards the stub and the real one loads instead, which
    // quietly makes every assertion run against a route that could not read
    // its own booking.
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, sent };
}

const call = () =>
    new Request('http://example.invalid/api/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'booking_status', bookingId: 'b1' }),
    });

const base = {
    id: 'b1', listing_id: 'l1', guest_id: GUEST, host_id: HOST,
    check_in: '2026-11-26', check_out: '2026-11-29', guests: 2,
    total_price: 600, status: 'confirmed',
    amount_paid: 150, amount_refunded: 0,
    balance_amount: 450, balance_due_date: '2026-10-27',
    free_cancel_until: '2026-11-21',
};

test('a deposit booking is told when the balance comes out', async () => {
    const { route, sent } = load(base);
    const res: any = await route.POST(call());

    assert.equal(res.status, 200);
    assert.equal(sent.length, 1, 'one email to the guest');

    // The body carries &pound; entities, not literal £ — assert on what is
    // actually sent rather than on what it renders as.
    const html = sent[0].html;
    assert.match(html, /Still to pay/);
    assert.match(html, /&pound;450\.00/, 'the balance, not the total');
    assert.match(html, /2026-10-27/, 'the date it is taken');
    assert.match(html, /same card/);
    assert.match(html, /pay it sooner/, 'and that they need not wait');
});

test('the free-cancellation deadline and what they get back are both there', async () => {
    const { route, sent } = load(base);
    await route.POST(call());
    const html = sent[0].html;

    assert.match(html, /Free cancellation/);
    assert.match(html, /2026-11-21/, 'the deadline');
    assert.match(html, /&pound;150\.00/, 'what they would get back — what they have actually paid');
    assert.doesNotMatch(html, /&pound;600\.00 today/, 'not the headline price they have not paid');
});

test('what they get back is net of anything already refunded', async () => {
    const { route, sent } = load({ ...base, amount_paid: 150, amount_refunded: 50 });
    await route.POST(call());
    assert.match(sent[0].html, /&pound;100\.00/, '150 paid less 50 already returned');
});

test('a booking paid in full says so rather than quoting a balance', async () => {
    const { route, sent } = load({
        ...base, amount_paid: 600, balance_amount: 0, balance_due_date: null,
    });
    await route.POST(call());
    const html = sent[0].html;

    assert.match(html, /paid in full/);
    assert.doesNotMatch(html, /taken from the same card/, 'there is no balance to take');
});

test('a booking past its free-cancellation window does not invent a deadline', async () => {
    const { route, sent } = load({ ...base, free_cancel_until: null });
    await route.POST(call());
    const html = sent[0].html;

    assert.doesNotMatch(html, /Free cancellation/);
    assert.match(html, /would not be refunded in full/, 'it says so plainly instead');
});

test('a declined booking gets none of this', async () => {
    const { route, sent } = load({ ...base, status: 'declined' });
    await route.POST(call());
    const html = sent[0].html;

    assert.doesNotMatch(html, /Still to pay/, 'nothing is owed on a booking that is not happening');
    assert.doesNotMatch(html, /Free cancellation/);
});
