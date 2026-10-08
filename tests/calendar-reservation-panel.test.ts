// The host calendar's reservation panel and its short-gap explanation.
//
// The panel (lib/hostReservation via /api/host/reservations/[id]) must keep
// the booking page's walls: no money without can_earnings, no booking detail
// or actions without can_bookings, the phone only when lib/stayWindow released
// it. And a "Short gap" night must explain itself in terms of the rule that
// marked it (lib/stayRules unsellableNights), never as something the host did.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reservationPanel, askToCancelDraft, paymentStage } from '../lib/hostReservation';
import { shortGapAt, shortGapWords } from '../lib/shortGap';
import { unsellableNights, addDaysKey } from '../lib/stayRules';

const booking = {
    id: 'abcdef12-0000-0000-0000-000000000000',
    listing_id: 'l1',
    check_in: '2026-10-30',
    check_out: '2026-11-02',
    status: 'confirmed',
    payment_status: 'paid',
    guests: 2, adults: 2, children: 0, pets: 0,
    total_price: 360, amount_paid: 360, amount_refunded: 0,
};
const owner = { isOwner: true, can_bookings: true, can_earnings: true, can_messages: true };
const base = {
    booking,
    listing: { title: 'Millburn Cottage', image: null, max_guests: 4, petsAllowed: false },
    guest: { name: 'Rhona', first: 'Rhona', avatarUrl: null },
    access: owner,
    phone: null,
    started: false,
    ended: false,
    guestWouldGet: 180,
    openChange: null,
};

test('the owner sees the guest, the stay, the money and the actions', () => {
    const p = reservationPanel(base);
    assert.equal(p.heading, 'Rhona’s group of 2');
    assert.equal(p.nights, 3);
    assert.ok(p.detail);
    assert.equal(p.detail!.party, '2 adults');
    assert.equal(p.detail!.money!.stage, 'Everything paid');
    assert.equal(p.detail!.messagesHref, '/messages?b=' + booking.id);
    assert.equal(p.detail!.manage.totalPrice, 360);
    assert.match(p.detail!.manage.askToCancelHref || '', /draft=/);
    assert.equal(p.detail!.confirmation, 'GG-ABCDEF12');
});

test('a co-host without earnings gets no figures at all, not just hidden ones', () => {
    const p = reservationPanel({ ...base, access: { ...owner, isOwner: false, can_earnings: false } });
    assert.equal(p.detail!.money, null);
    assert.equal(p.detail!.manage.totalPrice, 0);
    assert.equal(p.detail!.manage.amountPaid, 0);
    // Not the owner: no ask-to-cancel (never delegated).
    assert.equal(p.detail!.manage.askToCancelHref, null);
});

test('calendar-only access shows the dates and name on the bar, and nothing else', () => {
    const p = reservationPanel({ ...base, access: { isOwner: false, can_bookings: false, can_earnings: true, can_messages: true } });
    assert.equal(p.detail, null);
    assert.equal(p.checkIn, '2026-10-30');
    assert.equal(p.guestFirst, 'Rhona');
});

test('no messages link without can_messages', () => {
    const p = reservationPanel({ ...base, access: { ...owner, isOwner: false, can_messages: false } });
    assert.equal(p.detail!.messagesHref, null);
});

test('the phone is shown only when released, and the host is told when it will be', () => {
    assert.equal(reservationPanel(base).detail!.phoneNote, 'Shown from the day before they arrive');
    const released = reservationPanel({ ...base, phone: '+447700900000' });
    assert.equal(released.detail!.phone, '+447700900000');
    assert.equal(released.detail!.phoneNote, null);
    assert.equal(reservationPanel({ ...base, ended: true }).detail!.phoneNote, 'No longer shown — the stay has ended');
    // A cancelled stay has no phone and no note.
    assert.equal(reservationPanel({ ...base, booking: { ...booking, status: 'cancelled' } }).detail!.phoneNote, null);
});

test('a guest with no shared name is "Group of N"', () => {
    const p = reservationPanel({ ...base, guest: { name: 'Guest', first: 'there', avatarUrl: null } });
    assert.equal(p.heading, 'Group of 2');
});

test('the ask-to-cancel draft and payment words are the booking page’s', () => {
    const draft = askToCancelDraft({ guestFirst: 'Rhona', listingTitle: 'Millburn', checkIn: '2026-10-30', checkOut: '2026-11-02', guestWouldGet: 180 });
    assert.match(draft, /^Hi Rhona, /);
    assert.ok(!/\n/.test(draft), 'one line — the composer drops newlines');
    assert.equal(paymentStage('partially_refunded'), 'Paid, then partly refunded');
    assert.equal(paymentStage(null), 'Nothing paid yet');
});

// ---- short gaps ----

function nights(from: string, n: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(addDaysKey(from, i));
    return out;
}

test('a gap trapped against the first bookable night explains itself and its fix', () => {
    // Horizon starts 1 Nov; a booking takes 3–5 Nov; 3-night minimum.
    const horizon = nights('2026-11-01', 30);
    const unavailable = new Set(nights('2026-11-03', 3));
    const unsell = unsellableNights(horizon, unavailable, () => 3);
    assert.ok(unsell.has('2026-11-01') && unsell.has('2026-11-02'));

    const gap = shortGapAt('2026-11-02', unsell, unavailable, () => 3)!;
    assert.equal(gap.start, '2026-11-01');
    assert.equal(gap.end, '2026-11-02');
    assert.equal(gap.nights, 2);
    assert.equal(gap.openAtStart, true);
    assert.equal(gap.openAtEnd, false);

    const w = shortGapWords(gap);
    assert.equal(w.title, 'Nobody can book these nights');
    assert.match(w.why, /gap of 2 nights, shorter than your 3-night minimum stay/);
    assert.match(w.why, /first night guests can still book/);
    assert.match(w.fix, /set the minimum stay for them to 2 nights/);
    assert.match(w.fix, /isn’t something you blocked/);
});

test('a night that is not a short gap has no explanation', () => {
    const horizon = nights('2026-11-01', 30);
    const unavailable = new Set<string>();
    const unsell = unsellableNights(horizon, unavailable, () => 3);
    assert.equal(shortGapAt('2026-11-10', unsell, unavailable, () => 3), null);
});

test('one night against the end of the booking window', () => {
    const gap = { start: '2027-07-07', end: '2027-07-07', nights: 1, minNights: 2, openAtStart: false, openAtEnd: true };
    const w = shortGapWords(gap);
    assert.equal(w.title, 'Nobody can book this night');
    assert.match(w.why, /end of your booking window/);
    assert.match(w.fix, /To sell this night, set the minimum stay for them to 1 night/);
});
