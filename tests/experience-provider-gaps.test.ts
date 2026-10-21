// The guest-experience provider gaps from walking the seeded TEST provider
// (Eilidh, 21 Oct 2026): the gap between sessions, Custom cancellation, the
// hosting menu, the admin's preview of a listing in review.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const { generateSessions } = require('../lib/serviceSlots');
const { daySlots } = require('../lib/slotDay');
const { experienceCancellationOption, EXPERIENCE_CANCELLATION_OPTIONS } = require('../lib/serviceProviders');
const { experienceCustomDaysProblem, experienceCustomDaysOf, experienceCustomWords } = require('../lib/experienceCancellation');
const { termsToStamp, orderCancelTerms } = require('../lib/orderCancelTerms');
const { guestMayCancelFree } = require('../lib/serviceSlots');
const { cancellationSentence, cancellationBadge } = require('../components/marketplace/present');

// ---------------------------------------------------------------------------
// THE GAP BETWEEN SESSIONS
//
// 90-minute sessions with a 30-minute gap, Thursday 11:00–17:00: a session
// every two hours — 11:00, 13:00, 15:00. Guests were shown 11:00, 12:30, 14:00
// and 15:30 (the gap ignored), three of which the booking route then refused.

const THURSDAY = '2026-10-22';
const OPEN = [{ day_of_week: 4, open_time: '11:00', close_time: '17:00' }];

test('a 90-minute session with a 30-minute gap offers 11am, 1pm and 3pm', () => {
    // The booking route's own grid (slots/book): step = duration + gap, fit = duration.
    const server = generateSessions(OPEN, [], 90 + 30, THURSDAY, THURSDAY, 90).map((s: any) => s.time);
    assert.deepEqual(server, ['11:00', '13:00', '15:00']);

    // The provider's calendar draws the same grid.
    const day = daySlots(THURSDAY, { availabilityRows: OPEN, slotLen: 90, turnaround: 30, blockedDates: [], partialBlocks: [], sessions: [], declared: [], freeCapacity: 10 });
    assert.deepEqual(day.rows.map((r: any) => r.time), ['11:00', '13:00', '15:00']);
});

test('the guest grid steps by length + gap, the same grid the booking route accepts', () => {
    const src = read('lib/experiencesData.ts');
    assert.match(src, /\(Number\(p\.slot_length_minutes\) \|\| 60\) \+ turnaround, fromKey, provToKey,\s*Number\(p\.slot_length_minutes\) \|\| 60, providerPartialBlocks/,
        'step = length + gap, fit = length — never the length alone');
    const book = read('app/api/services/slots/book/route.ts');
    assert.match(book, /durationMinutes \+ turnaround,\s*sessionDate,\s*sessionDate,\s*durationMinutes/,
        'the route the guest grid has to agree with');
});

test('with no gap the grid is unchanged', () => {
    const times = generateSessions(OPEN, [], 90, THURSDAY, THURSDAY, 90).map((s: any) => s.time);
    assert.deepEqual(times, ['11:00', '12:30', '14:00', '15:30']);
    const day = daySlots(THURSDAY, { availabilityRows: OPEN, slotLen: 90, blockedDates: [], partialBlocks: [], sessions: [], declared: [], freeCapacity: 10 });
    assert.deepEqual(day.rows.map((r: any) => r.time), ['11:00', '12:30', '14:00', '15:30']);
});

test('a part-day block drops a start whose gap would run into it, as the server does', () => {
    // Blocked 14:30–15:00: the 13:00 session ends 14:30 but its gap runs to 15:00.
    const blocks = [{ date: THURSDAY, startMin: 14 * 60 + 30, endMin: 15 * 60 }];
    const times = generateSessions(OPEN, [], 120, THURSDAY, THURSDAY, 90, blocks).map((s: any) => s.time);
    assert.deepEqual(times, ['11:00', '15:00']);
});

// ---------------------------------------------------------------------------
// CUSTOM CANCELLATION — the holiday-let's Custom, for an experience

test('Custom days: the holiday-let limits and messages, worded for an experience', () => {
    assert.equal(experienceCustomDaysProblem('30'), null);
    assert.equal(experienceCustomDaysProblem(1), null);
    assert.equal(experienceCustomDaysProblem(365), null);
    assert.match(experienceCustomDaysProblem('') || '', /days before the experience/);
    assert.match(experienceCustomDaysProblem('2.5') || '', /whole number/);
    assert.match(experienceCustomDaysProblem('0') || '', /between 1 and 365/);
    assert.match(experienceCustomDaysProblem('366') || '', /between 1 and 365/);
    assert.equal(experienceCustomWords(30), 'Full refund up to 30 days before the experience. No refund after that.');
    assert.equal(experienceCustomWords(1), 'Full refund up to 1 day before the experience. No refund after that.');
});

test('Custom reads back as Custom, never the nearest preset', () => {
    // 2 days is 48 hours — the Standard preset's window. The flag decides.
    assert.equal(experienceCancellationOption(48, false, true).key, 'custom');
    assert.equal(experienceCancellationOption(48, false, false).key, 'standard');
    assert.equal(experienceCancellationOption(720, true, true).key, 'none', 'No refund still wins');
    assert.equal(experienceCustomDaysOf(720), 30);
    assert.equal(experienceCustomDaysOf(0), 30, 'nothing usable → the default 30');
    assert.equal(EXPERIENCE_CANCELLATION_OPTIONS[0].key, 'custom', 'first, as on a holiday let');
});

test('Custom is stamped on the order and refunds read it like any window', () => {
    // 30 days → 720 hours in the window column; the order stamps exactly that.
    const provider = { cancellation_window_hours: 30 * 24, guest_details: { cancellation_custom: true } };
    const stamp = termsToStamp(provider);
    assert.deepEqual(stamp, { cancellation_window_hours: 720, no_refund: false });
    // A later change of policy doesn't move a booked order's terms.
    const terms = orderCancelTerms(stamp, { cancellation_window_hours: 24, guest_details: { no_refund: true } });
    assert.deepEqual(terms, { windowHours: 720, noRefund: false });
    // Full refund before the cutoff, none after — no 50% band.
    const session = '2026-12-01';
    assert.equal(guestMayCancelFree('slot', session, '11:00', 720, new Date('2026-10-31T10:00:00Z')), true, '31 days before');
    assert.equal(guestMayCancelFree('slot', session, '11:00', 720, new Date('2026-11-02T10:00:00Z')), false, '29 days before');
});

test('the booking panel says "Free cancellation"; the full rule stays in the Cancellation section', () => {
    assert.equal(cancellationBadge(48, false), 'Free cancellation');
    assert.equal(cancellationBadge(720, false), 'Free cancellation');
    assert.equal(cancellationBadge(48, true), 'No refunds');
    // The section's sentence: hours for a short window, days for a long one.
    assert.equal(cancellationSentence('slot', 48, 'Eilidh'), 'Free to cancel up to 48 hours before your time.');
    assert.equal(cancellationSentence('slot', 168, 'Eilidh'), 'Free to cancel up to 7 days before your time.');
    assert.equal(cancellationSentence('slot', 720, 'Eilidh'), 'Free to cancel up to 30 days before your time.');
});

test('the save route runs the same Custom rule and stores days as the window', () => {
    const src = read('app/api/services/listing/save/route.ts');
    assert.match(src, /experienceCustomDaysProblem\(data\.custom_days\)/, 'the server mirror of the picker\'s check');
    assert.match(src, /cancellation_window_hours: Number\(data\.custom_days\) \* 24/);
    assert.match(src, /cancellation_custom: true/);
});

test('a no-refund order never shows the free-cancel sentence', () => {
    const src = read('app/experiences/order/[orderId]/page.tsx');
    assert.match(src, /\{terms\.noRefund[\s\S]{0,400}\? 'This booking is non-refundable[^']*'\s*: cancellationSentence\(order\.shape, windowHours, shortWho\)\}/);
});

// ---------------------------------------------------------------------------
// THE HOSTING MENU — the holiday-let host's, for an experience

test('an experience provider\'s menu is the host\'s, in order, with no "Your trips"', () => {
    const nav = read('components/base/NavMenu.tsx');
    const start = nav.indexOf('{isGuestProvider ? (');
    const end = nav.indexOf(') : (', start);
    const branch = nav.slice(start, end);
    // The host's order (NavMenu's hostView branch): Listings first, then
    // Reservations, Calendar, Reviews, Earnings, Co-hosts, Messages — with
    // "Your listing" where the host's Listings sits (Liam, 21 Oct 2026).
    const order = [
        "href='/services/dashboard/listings'>Your listing",
        "<RequestsLink label='Reservations' />",   // with the requests-to-confirm badge
        "href='/services/dashboard/calendar'>Calendar",
        "href='/services/dashboard/reviews'>Reviews",
        "href='/services/dashboard/earnings'>Earnings",
        "href='/services/dashboard/people'>Co-hosts",
        '<MessagesLink />',
    ];
    let at = -1;
    for (const item of order) {
        const i = branch.indexOf(item);
        assert.ok(i > at, item + ' is present, after the one before it');
        at = i;
    }
    assert.ok(!branch.includes("/trips"), 'no "Your trips" in the hosting menu');
});

test('the pages behind it open for an experience in review, not only after approval', () => {
    // Reservations and Calendar redirect only a trade that is not approved.
    for (const f of ['app/services/dashboard/page.tsx', 'app/services/dashboard/calendar/page.tsx']) {
        assert.match(read(f), /provider\.status !== 'approved' && mine\.isOwner && provider\.audience !== 'guest'\)/, f);
    }
    // Reviews exists, for the owner or a co-host with messages (the reply policy).
    const reviews = read('app/services/dashboard/reviews/page.tsx');
    assert.match(reviews, /dashboardProviders\(admin, user\.id, 'can_messages'/);
    assert.match(reviews, /loadExperienceReviews\(admin, provider\.id, user\.id\)/);
});

// ---------------------------------------------------------------------------
// THE ADMIN'S PREVIEW

test('the review queue title opens the experience page, which an admin may preview before approval', () => {
    const row = read('components/admin/ProviderReviewRow.tsx');
    assert.match(row, /href=\{'\/experiences\/browse\/' \+ provider\.id\}/);
    const page = read('app/experiences/browse/[providerId]/page.tsx');
    assert.match(page, /else if \(await isAdmin\(user\.id\)\)/, 'a server-side check of the viewer\'s own is_admin');
    assert.match(page, /viewer="admin"/);
});

test('the host\'s menu is in the order the provider\'s copies', () => {
    const nav = read('components/base/NavMenu.tsx');
    const branch = nav.slice(nav.indexOf('{hostView ? ('), nav.indexOf(') : providerView ? ('));
    const order = ["href='/dashboard'>Listings", '<BookingsLink />', "href='/dashboard/calendar'>Calendar",
        "href='/dashboard/reviews'>Reviews", "href='/dashboard/earnings'>Earnings", "href='/dashboard/people'>Co-hosts", '<MessagesLink />'];
    let at = -1;
    for (const item of order) {
        const i = branch.indexOf(item);
        assert.ok(i > at, item + ' is present, after the one before it — if the host menu moved, move the provider\'s to match');
        at = i;
    }
});

test('"Your listing" is a listings page with a + chooser, like the host\'s', () => {
    const page = read('app/services/dashboard/listings/page.tsx');
    assert.match(page, /Your listing<\/h1>/);
    assert.match(page, /<AddListingChooser/);
    assert.match(page, /redirect\('\/services\/dashboard\/edit'\)/, 'a trade is sent on to its business editor');
    const chooser = read('components/services/AddListingChooser.tsx');
    assert.match(chooser, /href="\/addhome"/, 'a holiday let');
    assert.match(chooser, /one per account/, 'one experience per account, said rather than refused later');
});
