import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { listingNotifyCopies, withListingUnsubscribe, listingUnsubscribeUrl } = require('@/lib/listingNotifyEmail');
const { isValidNotificationEmail, normalizeNotificationEmail, MAX_NOTIFICATION_EMAILS } = require('@/lib/notificationEmails');

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

test('notification email validation and normalisation', () => {
    assert.equal(MAX_NOTIFICATION_EMAILS, 3);
    assert.equal(normalizeNotificationEmail('  Foo@Bar.COM '), 'foo@bar.com');
    assert.ok(isValidNotificationEmail('a@b.co'));
    assert.ok(!isValidNotificationEmail('nope'));
    assert.ok(!isValidNotificationEmail('a@b'));
    assert.ok(!isValidNotificationEmail('a @b.co'));
    assert.ok(!isValidNotificationEmail(''));
});
