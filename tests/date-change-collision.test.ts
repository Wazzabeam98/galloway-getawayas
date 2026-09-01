// Moving an agreed job onto a day a guest is in the cottage.
//
// The collision warning exists twice already — in EnquiryForm when a host
// raises an enquiry, and in the Stripe webhook when a booking lands on planned
// work. Both fire at the moment a date is SET. Neither fires when the date
// MOVES, which is what accepting a proposed change does, so the one path that
// can put a tradesman in an occupied cottage was the one path that never
// looked.
//
// Proven on the test database before it was fixed: enquiry GG-PROOF-1 sits on
// listing f346605d, which has a confirmed stay from 18 to 22 September.
// Proposing the 20th and accepting it produced no warning anywhere, and
// `grep -c bookings` over both date-change routes returned 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, fakeSupabase, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/services/enquiries/respond-date/route';

const ENQUIRY = {
    id: 'e1',
    host_id: 'host1',
    provider_id: 'p1',
    listing_id: 'l1',
    status: 'accepted',
    reference: 'GG-TEST-1',
    trade: 'plumber',
    preferred_date: '2026-09-10',
    proposed_date: '2026-09-20',
    proposed_window_from: null,
    proposed_window_to: null,
};

function loadRoute(handlers: any, opts: any = {}) {
    const alerts: any[] = [];

    stubModule('@supabase/supabase-js', { createClient: () => fakeSupabase(handlers).client });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: { id: opts.uid || 'host1' } } }) },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('@/lib/logError', { logError: async () => {} });
    stubModule('@/lib/serviceEnquiryAlert', {
        announceChangeDecision: async (...args: any[]) => { alerts.push({ kind: 'decision', args }); return {}; },
        announceWorkNowClashes: async (...args: any[]) => { alerts.push({ kind: 'clash', args }); return {}; },
    });
    stubModule('next/server', {
        NextResponse: {
            json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }),
        },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, alerts };
}

const accept = () =>
    new Request('http://example.invalid/api/services/enquiries/respond-date', {
        method: 'POST',
        body: JSON.stringify({ enquiryId: 'e1', reply: 'yes' }),
    });

// THE ONE THAT MATTERS. Accepting a move onto an occupied day must not be
// silent — the host is agreeing to it, and the guest is the thing they cannot
// see from the enquiry.
test('accepting a move onto a day with a guest in the cottage warns somebody', async () => {
    const seen: string[] = [];

    const { route, alerts } = loadRoute({
        service_enquiries: { data: { ...ENQUIRY }, error: null },
        service_providers: { data: { id: 'p1', contact_email: 'trade@example.invalid' }, error: null },
        listings: { data: { id: 'l1', title: 'The Cottage' }, error: null },
        bookings: (state: any) => {
            seen.push('bookings');
            return { data: [{ id: 'b1', check_in: '2026-09-18', check_out: '2026-09-22' }], error: null };
        },
    });

    const res: any = await route.POST(accept());

    assert.equal(res.status, 200);
    assert.equal(seen.includes('bookings'), true,
        'the route must look for a guest on the new day before it lets the move stand');
    assert.equal(res.body.clash, true, 'and it must say so in the answer');
    assert.equal(alerts.some((a) => a.kind === 'clash'), true, 'and tell the host');
});

// The ordinary case must stay quiet. A warning on every date change is a
// warning nobody reads.
test('accepting a move onto a free day warns nobody', async () => {
    const { route, alerts } = loadRoute({
        service_enquiries: { data: { ...ENQUIRY }, error: null },
        service_providers: { data: { id: 'p1', contact_email: 'trade@example.invalid' }, error: null },
        listings: { data: { id: 'l1', title: 'The Cottage' }, error: null },
        bookings: { data: [], error: null },
    });

    const res: any = await route.POST(accept());

    assert.equal(res.status, 200);
    assert.equal(!!res.body.clash, false);
    assert.equal(alerts.some((a) => a.kind === 'clash'), false);
});

// Declining leaves the agreed day alone, so there is nothing to collide with.
test('declining a move looks for no guest at all', async () => {
    const seen: string[] = [];
    const { route } = loadRoute({
        service_enquiries: { data: { ...ENQUIRY }, error: null },
        service_providers: { data: { id: 'p1' }, error: null },
        listings: { data: { id: 'l1', title: 'The Cottage' }, error: null },
        bookings: () => { seen.push('bookings'); return { data: [], error: null }; },
    });

    const res: any = await route.POST(new Request('http://example.invalid/x', {
        method: 'POST',
        body: JSON.stringify({ enquiryId: 'e1', reply: 'no' }),
    }));

    assert.equal(res.status, 200);
    assert.equal(seen.includes('bookings'), false, 'nothing moved, so nothing to check');
});
