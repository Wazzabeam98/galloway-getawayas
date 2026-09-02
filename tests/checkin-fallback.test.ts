// The check-in floor: a guest gets the address and arrival time even when the
// host never wrote a template.
//
// Two halves. The pure body builder — asserted directly because the wording is
// what a guest reads at the door — and the cron wiring, proving the fallback
// fires for a host with NO templates (the exact case that early-returns before
// the template loop) and stays quiet when the host has already covered it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
process.env.CRON_SECRET = 'secret';

import { checkInFallbackBody } from '../lib/scheduledMessages';

test('the fallback body carries the address and the arrival time', () => {
    const body = checkInFallbackBody({
        firstName: 'Morag',
        listing: { title: 'Harbour Cottage', location: '3 Castle St, Kirkcudbright, DG6 4JA', check_in_time: '15:00:00', check_out_time: '11:00:00', check_in_method: 'Host greets you' },
        checkIn: 'Friday 12 December',
        code: null,
    });
    assert.match(body, /3 Castle St, Kirkcudbright, DG6 4JA/, 'the address');
    assert.match(body, /after 3pm/, 'the arrival time');
    assert.match(body, /meet you at the property/, 'greeted check-in wording');
    assert.doesNotMatch(body, /the code is/, 'no code for a greeted check-in');
});

test('a self-check-in fallback carries the code when the host set one', () => {
    const body = checkInFallbackBody({
        firstName: 'Morag',
        listing: { title: 'Harbour Cottage', location: 'A St', check_in_time: '16:00:00', check_in_method: 'Lockbox' },
        checkIn: 'Fri', code: '4821',
    });
    assert.match(body, /key safe/);
    assert.match(body, /the code is 4821/);
});

test('a self-check-in with no code set says the code will follow, not a blank', () => {
    const body = checkInFallbackBody({
        firstName: 'Morag',
        listing: { title: 'Harbour Cottage', location: 'A St', check_in_time: '16:00:00', check_in_method: 'Keypad' },
        checkIn: 'Fri', code: null,
    });
    assert.match(body, /send the code before you arrive/);
    assert.doesNotMatch(body, /the code is\s*\./);
});

// --- Cron wiring ---
const ROUTE = '@/app/api/cron/scheduled-messages/route';

function load(opts: { templates?: any[]; booking: any; listing: any; code?: string | null }) {
    const messages: any[] = [];
    const claims: any[] = [];

    const data: Record<string, any> = {
        message_templates: opts.templates || [],
        message_template_listings: [],
        bookings: [opts.booking],
        listings: [opts.listing],
        profiles: [{ id: opts.booking.guest_id, full_name: 'Morag Guest', preferred_name: null, show_full_name: true }],
        listing_access_codes: opts.code ? [{ listing_id: opts.listing.id, code: opts.code }] : [],
        sent_scheduled_messages: [],
    };

    function builder(table: string) {
        const chain: any = {
            select: () => chain,
            eq: () => chain,
            in: () => chain,
            gte: () => chain,
            lte: () => chain,
            delete: () => chain,
            insert: (row: any) => {
                if (table === 'sent_scheduled_messages') { claims.push(row); return Promise.resolve({ error: null }); }
                if (table === 'messages') { messages.push(row); return Promise.resolve({ error: null }); }
                return Promise.resolve({ error: null });
            },
            then: (resolve: any) => resolve({ data: data[table] ?? [], error: null }),
        };
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: builder }) });
    stubModule('@/lib/logError', { logError: async () => {} });
    stubModule('next/server', { NextResponse: { json: (b: any, i?: any) => ({ body: b, status: (i && i.status) || 200 }) } });
    clearModule(ROUTE);
    return { route: require('../app/api/cron/scheduled-messages/route'), messages, claims };
}

const soon = () => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0]; };
const later = () => { const d = new Date(); d.setDate(d.getDate() + 4); return d.toISOString().split('T')[0]; };
const authed = () => new Request('http://x/api/cron/scheduled-messages', { headers: { authorization: 'Bearer secret' } });

const BOOKING = () => ({ id: 'b1', host_id: 'h1', guest_id: 'g1', listing_id: 'l1', check_in: soon(), check_out: later(), status: 'confirmed', confirmed_at: new Date().toISOString() });
const LISTING = { id: 'l1', title: 'Harbour Cottage', location: '3 Castle St, Kirkcudbright', check_in_time: '15:00:00', check_out_time: '11:00:00', check_in_method: 'Host greets you' };

test('a host with NO templates still sends the guest the address and time', async () => {
    const { route, messages } = load({ templates: [], booking: BOOKING(), listing: LISTING });
    const res: any = await route.GET(authed());
    assert.equal(res.status, 200);
    assert.equal(messages.length, 1, 'the floor message went');
    assert.match(messages[0].body, /3 Castle St, Kirkcudbright/);
    assert.match(messages[0].body, /after 3pm/);
    assert.equal(messages[0].recipient_id, 'g1');
});

test('the fallback stays quiet when the host already covers the listing', async () => {
    const template = {
        id: 't1', user_id: 'h1', template_type: 'checkin_details', enabled: true,
        body: 'Come to {listing}, key is under the mat.', anchor: 'check_in', days_offset: 3,
        send_hour: 9, minutes_after: null, hours_after: null, hours_before: null, created_at: '2020-01-01',
    };
    const { route, messages } = load({ templates: [template], booking: BOOKING(), listing: LISTING });
    await route.GET(authed());
    // The host's own template covers it, so no SEPARATE fallback message.
    const fallbacks = messages.filter((m) => /practical details for getting in/.test(m.body));
    assert.equal(fallbacks.length, 0, 'no fallback on top of the host message');
});
