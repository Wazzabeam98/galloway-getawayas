import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostResponsiveness } from '../lib/hostResponsiveness';

// A tiny stand-in for the Supabase admin client. Each table resolves to a fixed
// dataset; every builder method returns the same thenable so any chain the code
// uses (.select().eq().order().limit(), .select().in().eq(), …) just awaits the
// data. We don't emulate filtering — the datasets are already the rows the real
// queries would return for one host.
function fakeAdmin(tables: Record<string, any[]>) {
    const make = (rows: any[]) => {
        const builder: any = {
            select: () => builder,
            eq: () => builder,
            in: () => builder,
            order: () => builder,
            limit: () => builder,
            then: (resolve: any) => resolve({ data: rows, error: null }),
        };
        return builder;
    };
    return { from: (table: string) => make(tables[table] || []) };
}

const HOST = 'host-liam';
const COHOST = 'cohost-jamie';
const GUEST = 'guest-real';
const LISTING = 'listing-townhouse';
const MINUTE = 60 * 1000;
const t = (base: number, mins: number) => new Date(base + mins * MINUTE).toISOString();
const BASE = Date.parse('2026-10-01T09:00:00Z');

const access = [{ listing_id: LISTING, user_id: COHOST, status: 'active' }];

test('a co-host reply counts as the host side answering (the 0% bug)', async () => {
    const admin = fakeAdmin({
        bookings: [{ id: 'b1', guest_id: GUEST, host_id: HOST, listing_id: LISTING }],
        listing_access: access,
        // Guest asks; only the CO-HOST replies, 30 minutes later.
        messages: [
            { booking_id: 'b1', sender_id: GUEST, created_at: t(BASE, 0) },
            { booking_id: 'b1', sender_id: COHOST, created_at: t(BASE, 30) },
        ],
    });
    const r = await hostResponsiveness(admin, HOST);
    assert.equal(r.responseRatePercent, 100, 'co-host reply should make it 100%, not 0%');
    assert.equal(r.typicalLabel, 'within an hour');
    assert.equal(r.sampleSize, 1);
});

test("the host's own/test booking is not counted", async () => {
    const admin = fakeAdmin({
        // The "guest" is the host themselves — a test booking on their own place.
        bookings: [{ id: 'b2', guest_id: HOST, host_id: HOST, listing_id: LISTING }],
        listing_access: access,
        messages: [{ booking_id: 'b2', sender_id: HOST, created_at: t(BASE, 0) }],
    });
    const r = await hostResponsiveness(admin, HOST);
    assert.equal(r.responseRatePercent, 100);
    assert.equal(r.sampleSize, 0, 'own booking excluded, so nothing is measured');
});

test('a booking whose guest is a co-host is also excluded', async () => {
    const admin = fakeAdmin({
        bookings: [{ id: 'b3', guest_id: COHOST, host_id: HOST, listing_id: LISTING }],
        listing_access: access,
        messages: [{ booking_id: 'b3', sender_id: COHOST, created_at: t(BASE, 0) }],
    });
    const r = await hostResponsiveness(admin, HOST);
    assert.equal(r.sampleSize, 0);
    assert.equal(r.responseRatePercent, 100);
});

test('a thread that opens with a host-side message is not a guest inquiry', async () => {
    const admin = fakeAdmin({
        bookings: [{ id: 'b4', guest_id: GUEST, host_id: HOST, listing_id: LISTING }],
        listing_access: access,
        // Host-side message first (an automated send / outreach), then the guest
        // replies — nothing after. Not guest-initiated → not counted.
        messages: [
            { booking_id: 'b4', sender_id: HOST, created_at: t(BASE, 0) },
            { booking_id: 'b4', sender_id: GUEST, created_at: t(BASE, 10) },
        ],
    });
    const r = await hostResponsiveness(admin, HOST);
    assert.equal(r.sampleSize, 0, 'guest only replied, so it never needed a reply');
    assert.equal(r.responseRatePercent, 100);
});

test('a real guest inquiry nobody answered drops the rate below 100%', async () => {
    const admin = fakeAdmin({
        bookings: [
            { id: 'b5', guest_id: GUEST, host_id: HOST, listing_id: LISTING },
            { id: 'b6', guest_id: 'guest-two', host_id: HOST, listing_id: LISTING },
        ],
        listing_access: access,
        messages: [
            // b5 answered by the host; b6 opened by the guest and ignored.
            { booking_id: 'b5', sender_id: GUEST, created_at: t(BASE, 0) },
            { booking_id: 'b5', sender_id: HOST, created_at: t(BASE, 20) },
            { booking_id: 'b6', sender_id: 'guest-two', created_at: t(BASE, 0) },
        ],
    });
    const r = await hostResponsiveness(admin, HOST);
    assert.equal(r.sampleSize, 2);
    assert.equal(r.responseRatePercent, 50, 'one of two guest inquiries went unanswered');
});

test('an automated send is not a reply — a guest left on auto-messages only drops the rate', async () => {
    const admin = fakeAdmin({
        bookings: [{ id: 'b7', guest_id: GUEST, host_id: HOST, listing_id: LISTING }],
        listing_access: access,
        // Guest asks; the only host-side message after is an automated send.
        messages: [
            { booking_id: 'b7', sender_id: GUEST, created_at: t(BASE, 0) },
            { booking_id: 'b7', sender_id: HOST, created_at: t(BASE, 20), automated: true },
        ],
    });
    const r = await hostResponsiveness(admin, HOST);
    assert.equal(r.sampleSize, 1);
    assert.equal(r.responseRatePercent, 0, 'an automated send does not answer the guest');
});

test('a human reply still counts even when an automated send went out too', async () => {
    const admin = fakeAdmin({
        bookings: [{ id: 'b8', guest_id: GUEST, host_id: HOST, listing_id: LISTING }],
        listing_access: access,
        messages: [
            { booking_id: 'b8', sender_id: GUEST, created_at: t(BASE, 0) },
            { booking_id: 'b8', sender_id: HOST, created_at: t(BASE, 15), automated: true },
            { booking_id: 'b8', sender_id: COHOST, created_at: t(BASE, 40) }, // a person
        ],
    });
    const r = await hostResponsiveness(admin, HOST);
    assert.equal(r.responseRatePercent, 100);
    assert.equal(r.typicalLabel, 'within an hour', 'reply time is to the human reply');
});

test('a guest merely replying to an automated message is not a counted inquiry', async () => {
    const admin = fakeAdmin({
        bookings: [{ id: 'b9', guest_id: GUEST, host_id: HOST, listing_id: LISTING }],
        listing_access: access,
        // Automated check-in message first, then the guest says thanks. Nothing
        // needed a reply.
        messages: [
            { booking_id: 'b9', sender_id: HOST, created_at: t(BASE, 0), automated: true },
            { booking_id: 'b9', sender_id: GUEST, created_at: t(BASE, 30) },
        ],
    });
    const r = await hostResponsiveness(admin, HOST);
    assert.equal(r.sampleSize, 0);
    assert.equal(r.responseRatePercent, 100);
});

test('an automated guest-side notice opening a thread is not a counted inquiry', async () => {
    const admin = fakeAdmin({
        bookings: [{ id: 'b10', guest_id: GUEST, host_id: HOST, listing_id: LISTING }],
        listing_access: access,
        // The system-composed "guest updated the booking" notice (sent AS the
        // guest) opens the thread; nobody replies. It must not count.
        messages: [
            { booking_id: 'b10', sender_id: GUEST, created_at: t(BASE, 0), automated: true },
        ],
    });
    const r = await hostResponsiveness(admin, HOST);
    assert.equal(r.sampleSize, 0);
    assert.equal(r.responseRatePercent, 100);
});

test('no bookings at all starts at 100% / within 24 hours', async () => {
    const admin = fakeAdmin({ bookings: [], listing_access: [], messages: [] });
    const r = await hostResponsiveness(admin, HOST);
    assert.deepEqual(r, { responseRatePercent: 100, typicalLabel: 'within 24 hours', sampleSize: 0 });
});

test('no hostId returns the safe default', async () => {
    const r = await hostResponsiveness(fakeAdmin({}), '');
    assert.equal(r.responseRatePercent, 100);
    assert.equal(r.typicalLabel, 'within 24 hours');
});
