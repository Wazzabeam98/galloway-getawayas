// When a host's saved message is due.
//
// These templates have existed for a long time and nothing ever sent them: a
// host writes their key safe code into "Check-in details", sees Saved, and the
// guest never gets it. The timing is the part worth testing without a
// database, because "three days before arrival at 9am" contains British
// Summer Time, a run that was missed, and a message whose moment has passed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    timingFor,
    isDue,
    hasRealContent,
    appliesToListing,
    fillPlaceholders,
    londonInstant,
    needsLockboxCode,
    usesLockboxCode,
} from '../lib/scheduledMessages';

const LISTING = { check_in_time: '15:00:00', check_out_time: '11:00:00' };

const booking = (over: any = {}) => Object.assign({
    id: 'b1', host_id: 'h1', guest_id: 'g1', listing_id: 'l1',
    check_in: '2026-08-20', check_out: '2026-08-24',
    status: 'confirmed', confirmed_at: '2026-08-01T12:00:00.000Z',
}, over);

const template = (over: any = {}) => Object.assign({
    user_id: 'h1', template_type: 'checkin_details',
    body: 'Hi {guest_name}, the key safe code is 1234.',
    enabled: true, anchor: 'check_in', days_offset: 3, send_hour: 9,
    minutes_after: null, hours_after: null, hours_before: null, listing_ids: null,
}, over);

/* ------------------------------------------------------------ the clock */

test('a send hour means the hour a guest experiences, not UTC', () => {
    // 20 August is British Summer Time: 9am London is 08:00 UTC. Getting this
    // wrong sends the key safe code an hour late all summer, and an hour
    // early all winter.
    const summer = londonInstant('2026-08-20', 9);
    assert.equal(summer.toISOString(), '2026-08-20T08:00:00.000Z');

    // January is GMT, so 9am London is 09:00 UTC.
    const winter = londonInstant('2026-01-20', 9);
    assert.equal(winter.toISOString(), '2026-01-20T09:00:00.000Z');
});

/* ----------------------------------------------------------- the anchors */

test('check-in details go out N days before arrival, at the chosen hour', () => {
    const t = timingFor(template({ days_offset: 3, send_hour: 9 }), booking(), LISTING);
    assert.ok(t);
    // Check-in is the 20th, so three days before is the 17th at 9am BST.
    assert.equal(t.dueAt.toISOString(), '2026-08-17T08:00:00.000Z');
});

test('check-in details stop being sent once the guest is due to arrive', () => {
    const t = timingFor(template(), booking(), LISTING);
    assert.ok(t);
    assert.equal(
        t.staleAfter.toISOString(),
        '2026-08-20T14:00:00.000Z',
        '3pm on arrival day, BST — after that the code should reach them another way'
    );

    const dayBefore = new Date('2026-08-19T10:00:00.000Z');
    const afterArrival = new Date('2026-08-20T16:00:00.000Z');
    assert.equal(isDue(t, dayBefore), true, 'late is better than never');
    assert.equal(isDue(t, afterArrival), false, 'but not once they have arrived');
});

test('a check-out note is counted back from the listing check-out time', () => {
    const t = timingFor(
        template({ anchor: 'before_check_out', hours_before: 14 }),
        booking(),
        LISTING
    );
    assert.ok(t);
    // Check-out is 11am on the 24th (10:00 UTC in BST); 14 hours before is
    // 8pm the evening before.
    assert.equal(t.dueAt.toISOString(), '2026-08-23T20:00:00.000Z');
    assert.equal(t.staleAfter.toISOString(), '2026-08-24T10:00:00.000Z');
});

test('a settling-in note is counted forward from the check-in time', () => {
    const t = timingFor(
        template({ anchor: 'after_check_in', hours_after: 4 }),
        booking(),
        LISTING
    );
    assert.ok(t);
    // 3pm BST on the 20th is 14:00 UTC; four hours later is 18:00.
    assert.equal(t.dueAt.toISOString(), '2026-08-20T18:00:00.000Z');
});

test('a delayed booking-confirmation note runs from when the host accepted', () => {
    const t = timingFor(
        template({ anchor: 'booking', minutes_after: 90 }),
        booking({ confirmed_at: '2026-08-01T12:00:00.000Z' }),
        LISTING
    );
    assert.ok(t);
    assert.equal(t.dueAt.toISOString(), '2026-08-01T13:30:00.000Z');
});

test('a booking-anchored template on a booking never accepted has no time', () => {
    const t = timingFor(
        template({ anchor: 'booking', minutes_after: 0 }),
        booking({ confirmed_at: null }),
        LISTING
    );
    assert.equal(t, null, 'nothing to count from, so nothing is sent');
});

test('an anchor nobody recognises sends nothing rather than guessing', () => {
    assert.equal(timingFor(template({ anchor: 'none' }), booking(), LISTING), null);
    assert.equal(timingFor(template({ anchor: null }), booking(), LISTING), null);
});

test('a listing with no times set falls back to 3pm and 11am', () => {
    const t = timingFor(template(), booking(), {});
    assert.ok(t);
    assert.equal(t.staleAfter.toISOString(), '2026-08-20T14:00:00.000Z', '3pm BST');
});

/* -------------------------------------------------------------- is it due */

test('a missed run sends late rather than never', () => {
    const t = timingFor(template({ days_offset: 3, send_hour: 9 }), booking(), LISTING);
    // Due on the 17th; the run that should have caught it did not happen.
    const twoDaysLate = new Date('2026-08-19T09:00:00.000Z');
    assert.equal(isDue(t, twoDaysLate), true);
});

test('nothing is due before its time', () => {
    const t = timingFor(template({ days_offset: 3, send_hour: 9 }), booking(), LISTING);
    assert.equal(isDue(t, new Date('2026-08-17T07:59:00.000Z')), false, 'a minute early');
    assert.equal(isDue(t, new Date('2026-08-17T08:00:00.000Z')), true, 'on the hour');
});

test('no timing means not due', () => {
    assert.equal(isDue(null, new Date()), false);
});

/* ------------------------------------------------- what gets sent, and to whom */

test('a template that is only the stock greeting is not sent', () => {
    assert.equal(hasRealContent('Hi {guest_name},'), false);
    assert.equal(hasRealContent('  Hi {guest_name}  '), false);
    assert.equal(hasRealContent(''), false);
    assert.equal(hasRealContent(null), false);
    assert.equal(
        hasRealContent('Hi {guest_name},\n\nThe code is 1234.'),
        true,
        'a real message is sent even though it opens with the greeting'
    );
});

test('an empty listing selection means every listing', () => {
    assert.equal(appliesToListing(template({ listing_ids: null }), 'l1'), true);
    assert.equal(appliesToListing(template({ listing_ids: [] }), 'l1'), true);
    assert.equal(appliesToListing(template({ listing_ids: ['l1'] }), 'l1'), true);
    assert.equal(
        appliesToListing(template({ listing_ids: ['l2'] }), 'l1'),
        false,
        'a template set up for one cottage must not go to guests at another'
    );
});

test('placeholders are filled, including repeats', () => {
    const out = fillPlaceholders(
        'Hi {guest_name}, {listing} is ready. {check_in} to {check_out}. See you {check_in}.',
        { guestName: 'Alex', listing: 'Bookshop Flat', checkIn: 'Thursday 20 August', checkOut: 'Monday 24 August' }
    );
    assert.equal(
        out,
        'Hi Alex, Bookshop Flat is ready. Thursday 20 August to Monday 24 August. See you Thursday 20 August.'
    );
    assert.doesNotMatch(out, /\{/, 'no placeholder is left showing to a guest');
});

/* -------------------------------------- which bookings the run even looks at */

// The bug this covers: the run only queried stays within 40 days either side
// of today, but a booking-anchored template counts from when the host
// accepted, not from the dates of the stay. Somebody accepting a booking for a
// stay six months out would never have got their welcome message — the stay
// was outside the window, so the booking was never looked at.

import { stubModule, clearModule } from './helpers/stub';

const ROUTE = '@/app/api/cron/scheduled-messages/route';

function loadRoute(opts: { templates: any[]; farFutureBooking: any }) {
    const queries: any[] = [];
    const claims: any[] = [];
    const messages: any[] = [];

    function builder(table: string) {
        const state: any = { table, ops: [] };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') {
                    const filters: Record<string, any> = {};
                    state.ops.forEach((o: any) => {
                        if (o.op === 'gte' || o.op === 'lte') filters[o.op + ':' + o.args[0]] = o.args[1];
                    });

                    if (table === 'message_templates') {
                        return (r: any) => r({ data: opts.templates, error: null });
                    }
                    if (table === 'bookings') {
                        queries.push(filters);
                        // The stay-date query must not find it; only the
                        // confirmed_at sweep may.
                        const byConfirmedAt = Object.keys(filters).some(
                            (k) => k.indexOf('confirmed_at') !== -1
                        );
                        return (r: any) => r({
                            data: byConfirmedAt ? [opts.farFutureBooking] : [],
                            error: null,
                        });
                    }
                    if (table === 'listings') {
                        return (r: any) => r({
                            data: [{ id: 'l1', title: 'Bookshop Flat', check_in_time: '15:00:00', check_out_time: '11:00:00' }],
                            error: null,
                        });
                    }
                    if (table === 'profiles') {
                        return (r: any) => r({ data: [{ id: 'g1', full_name: 'Alex Guest' }], error: null });
                    }
                    if (table === 'sent_scheduled_messages') {
                        const insert = state.ops.find((o: any) => o.op === 'insert');
                        if (insert) claims.push(insert.args[0]);
                        return (r: any) => r({ data: null, error: null });
                    }
                    if (table === 'messages') {
                        const insert = state.ops.find((o: any) => o.op === 'insert');
                        if (insert) messages.push(insert.args[0]);
                        return (r: any) => r({ data: null, error: null });
                    }
                    return (r: any) => r({ data: [], error: null });
                }
                return (...args: any[]) => { state.ops.push({ op: prop, args }); return chain; };
            },
        });
        return chain;
    }

    process.env.CRON_SECRET = 'test-secret';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: (t: string) => builder(t) }) });
    stubModule('next/server', {
        NextResponse: { json: (b: any, i?: any) => ({ body: b, status: (i && i.status) || 200 }) },
    });
    stubModule('@/lib/logError', { logError: async () => undefined });

    clearModule(ROUTE);
    return { route: require(ROUTE.replace('@/', '../')), queries, claims, messages };
}

const authorised = () =>
    new Request('http://example.invalid/api/cron/scheduled-messages', {
        headers: { authorization: 'Bearer test-secret' },
    });

const bookingAnchoredTemplate = {
    user_id: 'h1', template_type: 'booking_confirmation',
    body: 'Hi {guest_name}, thanks for booking {listing}.',
    enabled: true, anchor: 'booking', days_offset: 0, send_hour: 9,
    minutes_after: 15, hours_after: 0, hours_before: 0, listing_ids: [],
};

// Confirmed an hour ago, for a stay far outside the stay-date window.
const farFuture = {
    id: 'b-far', host_id: 'h1', guest_id: 'g1', listing_id: 'l1',
    check_in: '2027-03-01', check_out: '2027-03-05', status: 'confirmed',
    confirmed_at: new Date(Date.now() - 3600000).toISOString(),
};

test('a booking accepted today for a stay months away still gets its welcome message', async () => {
    const { route, queries, messages } = loadRoute({
        templates: [bookingAnchoredTemplate],
        farFutureBooking: farFuture,
    });

    const res: any = await route.GET(authorised());
    assert.equal(res.status, 200);

    assert.ok(
        queries.some((f) => Object.keys(f).some((k) => k.indexOf('confirmed_at') !== -1)),
        'the run must ask about recently accepted bookings, not only about stay dates'
    );
    assert.equal(messages.length, 1, 'the stay is in March; the message is due now');
    assert.match(messages[0].body, /thanks for booking Bookshop Flat/);
});

test('the extra query is only made when a booking-anchored template is live', async () => {
    const { route, queries } = loadRoute({
        templates: [{ ...bookingAnchoredTemplate, anchor: 'check_in', days_offset: 3 }],
        farFutureBooking: farFuture,
    });

    await route.GET(authorised());

    assert.equal(
        queries.some((f) => Object.keys(f).some((k) => k.indexOf('confirmed_at') !== -1)),
        false,
        'nothing keys off acceptance, so there is no reason to ask'
    );
});

/* ----------------------------------------------------------- the door code */

test('the code is filled in, and repeats are all filled', () => {
    const out = fillPlaceholders(
        'Hi {guest_name}, the code for {listing} is {lockbox_code}. Again: {lockbox_code}.',
        { guestName: 'Alex', listing: 'Bookshop Flat', checkIn: 'x', checkOut: 'y', lockboxCode: '1860' }
    );
    assert.equal(out, 'Hi Alex, the code for Bookshop Flat is 1860. Again: 1860.');
    assert.doesNotMatch(out, /\{lockbox_code\}/);
});

test('a message wanting a code it has not got is held back', () => {
    const withCode = 'Hi {guest_name}, the code is {lockbox_code}.';
    const without = 'Hi {guest_name}, see you soon.';

    assert.equal(needsLockboxCode(withCode, null), true, 'no code set at all');
    assert.equal(needsLockboxCode(withCode, ''), true, 'empty is not a code');
    assert.equal(needsLockboxCode(withCode, '   '), true, 'nor is whitespace');
    assert.equal(needsLockboxCode(withCode, '1860'), false, 'a real code sends');
    assert.equal(
        needsLockboxCode(without, null),
        false,
        'a template that never asks for a code is unaffected by not having one'
    );
});

// The two must not fight. `listing_ids` decides *whether* a template applies;
// the code is resolved from the booking's own listing. Narrowing a template to
// some properties must not make it send another property's code.
test('narrowing a template to some listings still resolves each booking’s own code', () => {
    const narrowed = template({ listing_ids: ['l1', 'l2'] });
    const codes: Record<string, string> = { l1: '1111', l2: '2222', l3: '3333' };

    assert.equal(appliesToListing(narrowed, 'l1'), true);
    assert.equal(appliesToListing(narrowed, 'l2'), true);
    assert.equal(appliesToListing(narrowed, 'l3'), false, 'not targeted, so nothing is sent at all');

    // Each targeted booking gets its own code, not the first one found.
    const body = 'The code is {lockbox_code}.';
    assert.equal(
        fillPlaceholders(body, { guestName: 'a', listing: 'b', checkIn: 'c', checkOut: 'd', lockboxCode: codes['l1'] }),
        'The code is 1111.'
    );
    assert.equal(
        fillPlaceholders(body, { guestName: 'a', listing: 'b', checkIn: 'c', checkOut: 'd', lockboxCode: codes['l2'] }),
        'The code is 2222.'
    );
});

test('one template left open to all listings still gives each property its own code', () => {
    const openToAll = template({ listing_ids: [] });
    assert.equal(appliesToListing(openToAll, 'l1'), true);
    assert.equal(appliesToListing(openToAll, 'l9'), true);
    // Which is the whole point of the placeholder: one message, right code.
    assert.equal(usesLockboxCode('code: {lockbox_code}'), true);
    assert.equal(usesLockboxCode('no code here'), false);
});
