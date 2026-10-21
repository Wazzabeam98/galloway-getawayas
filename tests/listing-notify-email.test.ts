import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { listingNotifyCopies, withListingUnsubscribe, listingUnsubscribeUrl, stripOwnerMoney } = require('@/lib/listingNotifyEmail');
const { isValidNotificationEmail, normalizeNotificationEmail, MAX_NOTIFICATION_EMAILS, confirmResendBlocked, CONFIRM_RESEND_THROTTLE_MS } = require('@/lib/notificationEmails');
const { hostNewBookingEmail } = require('@/lib/bookingEmails');
const { emailLayout, button, SITE_URL } = require('@/lib/email');

// A money figure in any of its email shapes: £ or an HTML entity, then digits.
const HAS_MONEY = /(?:£|&pound;|&#163;|&#x0*a3;)\s*\d/i;

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const OWNER = 'owner@example.com';
const LISTING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fakeAdmin({ booking, ownerEmail, subs }: any) {
    return {
        from(table: string) {
            if (table === 'bookings') {
                return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: booking }) };
            }
            if (table === 'listing_notification_subscribers') {
                return { select() { return this; }, eq() { return this; }, not() { return Promise.resolve({ data: subs }); } };
            }
            return {};
        },
        auth: { admin: { getUserById: async () => ({ data: { user: { email: ownerEmail } } }) } },
    };
}

const bookingHtml = (id = BOOKING_ID) =>
    '<a href="https://gallowaygetaways.co.uk/dashboard/bookings/' + id + '">View the booking</a>';
const messageHtml = (id = BOOKING_ID) =>
    '<a href="https://gallowaygetaways.co.uk/messages/' + id + '">Read and reply</a>' +
    '<a href="https://gallowaygetaways.co.uk/unsubscribe?token=OWNERTOKEN&type=new_message">Unsubscribe from these emails</a>';

const client = () => fakeAdmin({
    booking: { listing_id: LISTING, host_id: 'host-1' },
    ownerEmail: OWNER,
    subs: [{ email: 'cleaner@x.com', unsubscribe_token: 'tok-1' }],
});

test('a new-booking email to the owner copies the listing subscribers', async () => {
    const copies = await listingNotifyCopies(OWNER, 'New booking — Millburn Cottage', bookingHtml(), client());
    assert.deepEqual(copies, [{ email: 'cleaner@x.com', unsubscribeToken: 'tok-1' }]);
});

test('a cancellation email to the owner copies the subscribers', async () => {
    const copies = await listingNotifyCopies(OWNER, 'Reservation cancelled — Millburn Cottage', bookingHtml(), client());
    assert.equal(copies.length, 1);
});

test('a payout email is never copied — wrong kind, no DB touched', async () => {
    // The fake would throw if it reached the DB with no booking, so [] here also
    // proves the kind check short-circuits before any lookup.
    const copies = await listingNotifyCopies(OWNER, 'You’ve been paid £50', bookingHtml(), fakeAdmin({ booking: null, ownerEmail: OWNER, subs: [] }));
    assert.deepEqual(copies, []);
});

test('a new-message email to the owner is copied', async () => {
    const copies = await listingNotifyCopies(OWNER, 'New message from Sam — Galloway Getaways', messageHtml(), client());
    assert.equal(copies.length, 1);
});

test('a new-message email to a GUEST is not copied (recipient is not the owner)', async () => {
    const copies = await listingNotifyCopies('guest@x.com', 'New message from Sam — Galloway Getaways', messageHtml(), client());
    assert.deepEqual(copies, []);
});

test('the owner is never copied to themselves', async () => {
    const admin = fakeAdmin({
        booking: { listing_id: LISTING, host_id: 'host-1' },
        ownerEmail: OWNER,
        subs: [{ email: OWNER.toUpperCase(), unsubscribe_token: 't' }, { email: 'cleaner@x.com', unsubscribe_token: 'tok-1' }],
    });
    const copies = await listingNotifyCopies(OWNER, 'New booking — Millburn Cottage', bookingHtml(), admin);
    assert.deepEqual(copies.map((c: any) => c.email), ['cleaner@x.com']);
});

test('no booking link in the html means no copy', async () => {
    const copies = await listingNotifyCopies(OWNER, 'New booking — Millburn Cottage', '<p>no link</p>', client());
    assert.deepEqual(copies, []);
});

test('withListingUnsubscribe appends a per-listing link to a transactional email', () => {
    const out = withListingUnsubscribe(bookingHtml(), 'tok-1');
    assert.ok(out.includes(bookingHtml()), 'keeps the original');
    assert.ok(out.includes(listingUnsubscribeUrl('tok-1')), 'adds the listing unsubscribe');
});

test('withListingUnsubscribe repoints an existing owner unsubscribe link, dropping the owner token', () => {
    const out = withListingUnsubscribe(messageHtml(), 'tok-1');
    assert.ok(!out.includes('OWNERTOKEN'), 'the owner’s token is gone from the copy');
    assert.ok(out.includes(listingUnsubscribeUrl('tok-1')), 'points at the listing unsubscribe');
});

test('a subscriber copy of a new-booking email carries NO money — the owner’s earnings never leave', () => {
    // The real host email, with the net-payout "You earn" row.
    const { html } = hostNewBookingEmail({
        listingTitle: 'Millburn Cottage', hostFirst: 'Liam', guestFirst: 'Sam',
        checkIn: '2026-11-01', checkOut: '2026-11-04', guests: 2,
        hostEarns: 612.5, total: 720, instant: true, bookingId: BOOKING_ID,
    });
    // Sanity: the owner’s own email really does contain the money this test exists to strip.
    assert.ok(html.includes('You earn') && HAS_MONEY.test(html), 'precondition: the owner’s email shows the earnings');

    const copy = withListingUnsubscribe(html, 'tok-1');
    assert.ok(!HAS_MONEY.test(copy), 'no currency amount reaches the subscriber');
    assert.ok(!/You earn/i.test(copy), 'the "You earn" label is gone too');
    assert.ok(!/\bTotal\b/.test(copy), 'and no "Total" money row');
    // The booking FACTS a cleaner actually needs are still there.
    assert.ok(copy.includes('Millburn Cottage'), 'keeps the property');
    assert.ok(copy.includes('Sam'), 'keeps the guest first name');
    assert.ok(/Dates/.test(copy), 'keeps the dates row');
    assert.ok(copy.includes(listingUnsubscribeUrl('tok-1')), 'and the per-listing unsubscribe');
});

test('stripOwnerMoney removes an amount sitting inline in a sentence, keeping it readable', () => {
    const html = emailLayout(
        '<p style="margin:0 0 16px;font-size:16px;">Your guest accepted and paid &pound;45.00 for the change. '
        + 'The booking now runs 2026-11-01 to 2026-11-04.</p>'
        + button(SITE_URL + '/dashboard/bookings/' + BOOKING_ID, 'Open the booking'),
        'You’re receiving this because you host with Galloway Getaways.');
    assert.ok(HAS_MONEY.test(html), 'precondition: the figure is in the owner’s email');

    const copy = withListingUnsubscribe(html, 'tok-1');
    assert.ok(!HAS_MONEY.test(copy), 'the inline figure is gone');
    assert.ok(/accepted and paid for the change/.test(copy), 'the sentence still reads without the amount');
    assert.ok(/booking now runs 2026-11-01 to 2026-11-04/.test(copy), 'the dates fact survives');
});

test('stripOwnerMoney drops a whole "You earn"-style detail row but leaves fact rows', () => {
    const { detailRows } = require('@/lib/email');
    const table = detailRows([
        { label: 'Property', value: 'Millburn Cottage' },
        { label: 'Guest', value: 'Sam' },
        { label: 'You earn', value: '&pound;612.50' },
    ]);
    const out = stripOwnerMoney(table);
    assert.ok(!HAS_MONEY.test(out) && !/You earn/.test(out), 'the money row is gone');
    assert.ok(out.includes('Property') && out.includes('Guest') && out.includes('Sam'), 'the fact rows stay');
});

test('confirmation resend is throttled: too soon is blocked, never-sent and long-ago are allowed', () => {
    const now = Date.UTC(2026, 9, 21, 20, 0, 0);
    assert.equal(confirmResendBlocked(null, now), false, 'never sent — the first send is always allowed');
    assert.equal(confirmResendBlocked(undefined, now), false);
    // Sent one minute ago, inside the window → blocked.
    assert.equal(confirmResendBlocked(new Date(now - 60 * 1000).toISOString(), now), true);
    // Sent just over the window ago → allowed again.
    assert.equal(confirmResendBlocked(new Date(now - CONFIRM_RESEND_THROTTLE_MS - 1000).toISOString(), now), false);
    // A garbage timestamp never blocks (fail open — a resend is not a safety gate).
    assert.equal(confirmResendBlocked('not a date', now), false);
});

test('notification email validation and normalisation', () => {
    assert.equal(MAX_NOTIFICATION_EMAILS, 3);
    assert.equal(normalizeNotificationEmail('  Foo@Bar.COM '), 'foo@bar.com');
    assert.ok(isValidNotificationEmail('a@b.co'));
    assert.ok(!isValidNotificationEmail('nope'));
    assert.ok(!isValidNotificationEmail('a@b'));
    assert.ok(!isValidNotificationEmail('a @b.co'));
    assert.ok(!isValidNotificationEmail(''));
});
