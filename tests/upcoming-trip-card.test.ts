// The home-page upcoming-trip card, its window and its countdown.
//
// The bug this pins down: a booking that ran 30 Aug -> 1 Sep 2026, viewed on
// 2 Sep, showed under "Your upcoming trip" reading "-3 days to go". The card
// carried its own definition of upcoming — a `check_out >= todayKey` filter
// where todayKey was local midnight run through toISOString, which slips a day
// west of UTC — so a finished stay survived the filter and then counted down
// past zero. Both the window and the countdown now live in lib/bookingWindows,
// and neither can render a finished stay as upcoming or print a negative day.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveForGuestCard, stayCountdown } from '../lib/bookingWindows';

// The reported failure, to the hour: BST, so local midnight on the 2nd is
// 23:00 UTC on the 1st — exactly the instant that made toISOString drift.
const REPORTED_NOW = new Date('2026-09-02T10:00:00+01:00');

test('the reported finished stay is NOT live for the card', () => {
    const booking = { status: 'confirmed', check_out: '2026-09-01' };
    assert.equal(liveForGuestCard(booking, REPORTED_NOW), false);
});

test('a stay that checked out yesterday is never live, timezone drift and all', () => {
    const now = new Date('2026-09-02T00:30:00+01:00'); // just past local midnight
    assert.equal(liveForGuestCard({ status: 'confirmed', check_out: '2026-09-01' }, now), false);
});

test('a stay still under way is live until checkout', () => {
    const now = new Date('2026-08-31T10:00:00+01:00'); // mid-stay
    assert.equal(liveForGuestCard({ status: 'confirmed', check_out: '2026-09-01' }, now), true);
});

test('E2: still live at 01:30 on checkout morning, while the guest is in the cottage', () => {
    // 01:30 BST on checkout day. The old `new Date(check_out) >= now` went false
    // at 01:00 (check_out's UTC midnight), so the card vanished mid-stay — just
    // when a guest might open it to check the checkout time.
    const morning = new Date('2026-07-01T01:30:00+01:00');
    assert.equal(liveForGuestCard({ status: 'confirmed', check_out: '2026-07-01' }, morning), true);
});

test('over once checkout day itself has passed', () => {
    const nextDay = new Date('2026-07-02T00:30:00+01:00');
    assert.equal(liveForGuestCard({ status: 'confirmed', check_out: '2026-07-01' }, nextDay), false);
});

// The trips list files a booking under "Past trips" when it is over, and over
// is the exact negative of liveForGuestCard. So this is also the test for the
// trips split: a stay checking out today, viewed on the last morning, must not
// be filed as past while the home card still says "You're there now".
test('trips split: a checkout-today booking is not "over" on the last morning', () => {
    const lastMorning = new Date('2026-07-01T09:00:00+01:00');
    const isOver = (b: { status: string; check_out: string }) => !liveForGuestCard(b, lastMorning);
    assert.equal(isOver({ status: 'confirmed', check_out: '2026-07-01' }), false, 'still upcoming');
    assert.equal(isOver({ status: 'confirmed', check_out: '2026-06-30' }), true, 'yesterday is past');
    assert.equal(isOver({ status: 'cancelled', check_out: '2026-08-01' }), true, 'cancelled is past');
});

test('a confirmed stay yet to start is live', () => {
    const now = new Date('2026-09-02T10:00:00+01:00');
    assert.equal(liveForGuestCard({ status: 'confirmed', check_out: '2026-09-20' }, now), true);
});

test('a pending request counts until its dates pass, then does not', () => {
    const now = new Date('2026-09-02T10:00:00+01:00');
    assert.equal(liveForGuestCard({ status: 'pending', check_out: '2026-09-20' }, now), true);
    assert.equal(liveForGuestCard({ status: 'pending', check_out: '2026-09-01' }, now), false);
});

test('a cancelled or declined booking is never live', () => {
    const now = new Date('2026-09-02T10:00:00+01:00');
    assert.equal(liveForGuestCard({ status: 'cancelled', check_out: '2026-09-20' }, now), false);
    assert.equal(liveForGuestCard({ status: 'declined', check_out: '2026-09-20' }, now), false);
});

// ---- the countdown itself ----------------------------------------------------

test('the reported stay is "over", never a negative day count', () => {
    const c = stayCountdown({ check_in: '2026-08-30', check_out: '2026-09-01' }, REPORTED_NOW);
    assert.equal(c.phase, 'over');
});

test('two or more days out counts down in whole days', () => {
    const now = new Date('2026-09-02T10:00:00+01:00');
    const c = stayCountdown({ check_in: '2026-09-05', check_out: '2026-09-09' }, now);
    assert.equal(c.phase, 'before');
    assert.equal(c.daysUntilCheckIn, 3);
});

test('the day before check-in is "tomorrow"', () => {
    const now = new Date('2026-09-04T21:00:00+01:00');
    assert.equal(stayCountdown({ check_in: '2026-09-05', check_out: '2026-09-09' }, now).phase, 'tomorrow');
});

test('check-in day is "today"', () => {
    const now = new Date('2026-09-05T08:00:00+01:00');
    assert.equal(stayCountdown({ check_in: '2026-09-05', check_out: '2026-09-09' }, now).phase, 'today');
});

test('a day into the stay is "during"', () => {
    const now = new Date('2026-09-06T10:00:00+01:00');
    assert.equal(stayCountdown({ check_in: '2026-09-05', check_out: '2026-09-09' }, now).phase, 'during');
});

test('checkout day is still "during", not yet over', () => {
    const now = new Date('2026-09-09T09:00:00+01:00');
    assert.equal(stayCountdown({ check_in: '2026-09-05', check_out: '2026-09-09' }, now).phase, 'during');
});

test('the only phase that prints a number is always >= 2', () => {
    // Sweep a fortnight around a stay; whenever the phase is "before", the
    // printed number is two or more — so a negative never reaches the headline.
    const stay = { check_in: '2026-09-10', check_out: '2026-09-14' };
    for (let day = 1; day <= 20; day++) {
        const now = new Date(`2026-09-${String(day).padStart(2, '0')}T10:00:00+01:00`);
        const c = stayCountdown(stay, now);
        if (c.phase === 'before') assert.ok(c.daysUntilCheckIn >= 2, `day ${day} printed ${c.daysUntilCheckIn}`);
    }
});
