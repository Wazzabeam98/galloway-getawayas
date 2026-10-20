// The line under a name in the Messages list, worded the way Airbnb's inbox
// words it. These pin the wording a host or guest actually reads, so a change
// to it is a decision rather than an accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    bookingStatusLine,
    categoryOf,
    enquiryStatusLine,
    orderStatusLine,
    shortDayRange,
} from '../lib/conversationLabels';

const today = '2026-10-20';

test('a stay reads as a short range, with years only away from this one', () => {
    assert.equal(shortDayRange('2026-10-19', '2026-10-22', today), '19–22 Oct');
    assert.equal(shortDayRange('2026-10-30', '2026-11-02', today), '30 Oct – 2 Nov');
    assert.equal(shortDayRange('2026-12-30', '2027-01-02', today), '30 Dec 2026 – 2 Jan 2027');
    assert.equal(shortDayRange('2027-03-01', '2027-03-04', today), '1–4 Mar 2027');
});

test('a booking says where it has got to, from the viewer’s side', () => {
    const base = { checkIn: '2026-10-19', checkOut: '2026-10-22', todayKey: today };
    assert.equal(bookingStatusLine({ ...base, status: 'confirmed', viewerIsGuest: false }), 'Currently hosting · 19–22 Oct');
    assert.equal(bookingStatusLine({ ...base, status: 'confirmed', viewerIsGuest: true }), 'Currently staying · 19–22 Oct');
    assert.equal(
        bookingStatusLine({ status: 'confirmed', checkIn: '2026-12-19', checkOut: '2026-12-22', todayKey: today, viewerIsGuest: false }),
        'Confirmed · 19–22 Dec'
    );
    assert.equal(bookingStatusLine({ ...base, status: 'cancelled', viewerIsGuest: false }), 'Cancelled');
    assert.equal(
        bookingStatusLine({ status: 'confirmed', checkIn: '2026-10-01', checkOut: '2026-10-04', todayKey: today, viewerIsGuest: false }),
        'Past'
    );
    // Check-out day itself is over: the guest has gone.
    assert.equal(
        bookingStatusLine({ status: 'confirmed', checkIn: '2026-10-17', checkOut: today, todayKey: today, viewerIsGuest: false }),
        'Past'
    );
    assert.equal(
        bookingStatusLine({ status: 'pending', checkIn: '2026-11-19', checkOut: '2026-11-22', todayKey: today, viewerIsGuest: false }),
        'Request pending · 19–22 Nov'
    );
    assert.equal(bookingStatusLine({ ...base, status: 'pending', viewerIsGuest: false }), 'Expired');
});

test('an experience order and a trade job say the same kinds of thing', () => {
    assert.equal(orderStatusLine({ status: 'confirmed', serviceDate: '2026-10-24', todayKey: today }), 'Confirmed · 24 Oct');
    assert.equal(orderStatusLine({ status: 'authorised', serviceDate: '2026-10-24', todayKey: today }), 'Request pending · 24 Oct');
    assert.equal(orderStatusLine({ status: 'confirmed', serviceDate: today, todayKey: today }), 'Today · 20 Oct');
    assert.equal(orderStatusLine({ status: 'confirmed', serviceDate: '2026-10-02', todayKey: today }), 'Past');
    assert.equal(enquiryStatusLine({ status: 'accepted', date: '2026-11-03', todayKey: today }), 'Confirmed · 3 Nov');
    assert.equal(enquiryStatusLine({ status: 'cancelled', date: '2026-11-03', todayKey: today }), 'Cancelled');
});

test('each kind of thread sits under its own tab', () => {
    assert.equal(categoryOf('booking'), 'homes');
    assert.equal(categoryOf('order'), 'experiences');
    assert.equal(categoryOf('enquiry'), 'services');
});
