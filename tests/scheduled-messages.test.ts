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
