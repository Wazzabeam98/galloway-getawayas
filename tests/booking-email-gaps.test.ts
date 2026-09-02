// The two booking emails that had no home, and the guest cancellation receipt.
//
// Three gaps, each a case of a guest or host silently getting nothing:
//
//   1. notify('booking_created') had no callers, so the host was never told a
//      booking had come in.
//   2. an Instant-Book guest confirms in the webhook with no host click, so the
//      "You're booked" email — only ever sent on host acceptance — never went,
//      though /booking-confirmed promised it.
//   3. a guest who cancels their own stay got an on-screen toast and no email.
//
// These assert the CODE PATH fires — the builder wiring, and the webhook's
// instant-vs-request branch — because a builder nobody calls is exactly the
// shape gap #1 already was. Builder content is asserted directly too, so the
// wording a guest keeps cannot rot unseen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

// ---------------------------------------------------------------------------
// Builder content — the words themselves.
// ---------------------------------------------------------------------------
const emails = require('../lib/bookingEmails');

test("the guest confirmation says they're booked and carries the money", () => {
    const mail = emails.guestBookedEmail({
        guestFirst: 'Morag',
        listingTitle: 'Harbour Cottage',
        checkIn: '2026-12-30', checkOut: '2027-01-03',
        arrivalLine: 'Arrive from 3pm. Leave by 11am',
        guests: 4, total: 620,
        amountPaid: 155, amountRefunded: 0,
        balanceAmount: 465, balanceDueDate: '2026-11-30',
        freeCancelUntil: '2026-12-23',
    });
    assert.equal(mail.subject, "You're booked — Galloway Getaways");
    assert.match(mail.html, /You&#39;re booked|You're booked/);
    assert.match(mail.html, /Still to pay/);
    assert.match(mail.html, /&pound;465\.00/, 'the balance, not the total');
    assert.match(mail.html, /Free cancellation/);
    assert.match(mail.html, /Harbour Cottage/);
});

test('the host alert differs for Instant Book and for a request', () => {
    const instant = emails.hostNewBookingEmail({
        hostFirst: 'Liam', guestFirst: 'Morag', listingTitle: 'Harbour Cottage',
        checkIn: '2026-12-30', checkOut: '2027-01-03', guests: 4, total: 620,
        instant: true, bookingId: 'b-1',
    });
    assert.match(instant.subject, /^New booking —/);
    assert.match(instant.html, /Instant Book/);
    assert.match(instant.html, /View the booking/);

    const request = emails.hostNewBookingEmail({
        hostFirst: 'Liam', guestFirst: 'Morag', listingTitle: 'Harbour Cottage',
        checkIn: '2026-12-30', checkOut: '2027-01-03', guests: 4, total: 620,
        instant: false, bookingId: 'b-1',
    });
    assert.match(request.subject, /^New booking request —/);
    assert.match(request.html, /confirm or decline/);
    assert.match(request.html, /Review this request/);
});

// ---------------------------------------------------------------------------
// Webhook wiring — the route actually sends them, and picks the right ones.
// ---------------------------------------------------------------------------
const ROUTE = '@/app/api/stripe/webhook/route';

function loadWebhook(instantBook: boolean) {
    const booking = {
        id: 'b-1', status: 'pending_payment', total_price: 620, listing_id: 'l-1',
        amount_paid: 0, amount_refunded: 0, guests: 4,
        balance_amount: 0, balance_due_date: null, free_cancel_until: null,
        guest_id: 'g-1', host_id: 'h-1', check_in: '2099-01-01', check_out: '2099-01-05',
    };
    const sent: any[] = [];

    const admin: any = {
        from(table: string) {
            return {
                select() {
                    const chain: any = {
                        eq: () => chain,
                        in: () => chain,
                        maybeSingle: async () => ({
                            data: table === 'listings'
                                ? { instant_book: instantBook, title: 'Harbour Cottage' }
                                : booking,
                            error: null,
                        }),
                        // profiles .in() resolves to a list via then
                        then: (resolve: any) => resolve({
                            data: table === 'profiles'
                                ? [
                                    { id: 'h-1', full_name: 'Liam Host', preferred_name: null, show_full_name: true },
                                    { id: 'g-1', full_name: 'Morag Guest', preferred_name: null, show_full_name: true },
                                ]
                                : [],
                            error: null,
                        }),
                    };
                    return chain;
                },
                update() { return { eq: async () => ({ data: null, error: null }) }; },
                insert: async () => ({ data: null, error: null }),
            };
        },
    };
    admin.auth = {
        admin: {
            getUserById: async (id: string) => ({
                data: { user: { email: id === 'h-1' ? 'host@example.invalid' : 'guest@example.invalid' } },
            }),
        },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@/lib/stripe', {
        verifyStripeSignature: async () => true,
        stripeRequest: async () => ({ payment_method: 'pm_1', customer: 'cus_1' }),
    });
    stubModule('@/lib/logError', { logError: async () => {} });
    // The real builders run — the subjects they produce are what we assert on,
    // so this proves the wiring AND that the route reaches the right builder.
    // The email helpers they call are stubbed to inert versions.
    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string, html: string) => {
            sent.push({ to, subject, html });
            return true;
        },
        emailLayout: (b: string) => b, escapeHtml: (x: string) => x, formatDate: () => '1 Jan',
        button: () => '', detailRows: () => '', SITE_URL: 'http://example.invalid',
        sendEmailToAll: async () => {}, recipients: () => [],
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    clearModule('@/lib/bookingEmails');
    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    const route = require('../app/api/stripe/webhook/route');
    return { route, sent };
}

function paidEvent() {
    return new Request('http://example.invalid/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=x' },
        body: JSON.stringify({
            id: 'evt_1', type: 'checkout.session.completed',
            data: { object: {
                payment_status: 'paid', amount_total: 62000, payment_intent: 'pi_1',
                customer: 'cus_1', client_reference_id: 'b-1',
                metadata: { booking_id: 'b-1', kind: 'full' },
            } },
        }),
    });
}

test('an Instant-Book payment emails BOTH the host and the guest', async () => {
    const { route, sent } = loadWebhook(true);
    const res: any = await route.POST(paidEvent());
    assert.equal(res.status, 200);
    const subjects = sent.map((s) => s.subject);
    assert.ok(subjects.some((s) => /^New booking —/.test(s)), 'the host is told (instant)');
    assert.ok(subjects.some((s) => /You're booked/.test(s)), 'the Instant-Book guest is told');
});

test('a request-booking payment emails the host only, not the guest yet', async () => {
    const { route, sent } = loadWebhook(false);
    const res: any = await route.POST(paidEvent());
    assert.equal(res.status, 200);
    const subjects = sent.map((s) => s.subject);
    assert.ok(subjects.some((s) => /^New booking request —/.test(s)), 'the host is told a request is waiting');
    assert.ok(
        !subjects.some((s) => /You're booked/.test(s)),
        'the guest is NOT told "you\'re booked" while it is still pending acceptance',
    );
});

// ---------------------------------------------------------------------------
// The guest's own cancellation receipt — the third gap.
// ---------------------------------------------------------------------------
const CANCEL_ROUTE = '@/app/api/bookings/cancel/route';

test('a guest who cancels their own stay is emailed a receipt', async () => {
    const booking = {
        id: 'b-1', listing_id: 'l-1', guest_id: 'g-1',
        check_in: '2099-06-01', status: 'confirmed', payment_status: 'paid',
        amount_paid: 400, amount_refunded: 0, cleaning_fee: 0,
        // No payment intent, so no Stripe refund is attempted — the receipt
        // must still go, saying no refund was due.
        stripe_payment_intent_id: null, balance_payment_intent_id: null, balance_amount: 0,
    };
    const rows: Record<string, any> = {
        bookings: booking,
        listings: { title: 'Harbour Cottage', cancellation_policy: 'Firm' },
        service_orders: [],
    };
    const sent: any[] = [];

    const admin: any = {
        from(table: string) {
            const chain: any = new Proxy({}, {
                get(_t, prop: string) {
                    if (prop === 'then') return (r: any) => r({ data: rows[table] ?? null, error: null });
                    if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: rows[table] ?? null, error: null });
                    if (prop === 'insert') return async () => ({ data: null, error: null });
                    if (prop === 'update') return () => chain;
                    return () => chain;
                },
            });
            return chain;
        },
        rpc: async () => ({ data: 0, error: null }),
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: { id: 'g-1', email: 'guest@example.invalid' } } }) },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('@/lib/refundSpread', { issueRefunds: async () => ({ refundedPence: 0, refunds: [], shares: [], charges: [] }) });
    stubModule('@/lib/stripe', { stripeRequest: async () => ({}) });
    stubModule('@/lib/logError', { logError: async () => {} });
    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string, html: string) => { sent.push({ to, subject, html }); return true; },
        emailLayout: (b: string) => b, escapeHtml: (x: string) => x,
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule('@/lib/refundSpread');
    clearModule(CANCEL_ROUTE);
    const route = require('../app/api/bookings/cancel/route');

    const req = new Request('http://example.invalid/api/bookings/cancel', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: 'b-1' }),
    });
    const res: any = await route.POST(req);
    assert.equal(res.status, 200);
    assert.ok(
        sent.some((s) => /has been cancelled/.test(s.subject) && s.to === 'guest@example.invalid'),
        'the guest gets their own cancellation receipt',
    );
});
