// Where the two admin-facing emails actually go.
//
// Both used to pick their recipients by reading `profiles.is_admin` and then
// taking that user's own account address. On production that resolved to two
// personal Hotmail accounts — including for `charge.dispute.created`, the one
// email that carries an evidence deadline with the money already taken back.
//
// They go to aliases now, from the environment, so the address can change
// without a deploy and is not tied to who happens to be an admin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

// ---------------------------------------------------------------------------
// Chargebacks.
// ---------------------------------------------------------------------------

const WEBHOOK = '@/app/api/stripe/webhook/route';

function loadWebhook(options: { alertTo?: string | null; delivered?: boolean } = {}) {
    if (options.alertTo === null) delete process.env.DISPUTES_ALERT_EMAIL;
    else process.env.DISPUTES_ALERT_EMAIL = options.alertTo || 'disputes@gallowaygetaways.co.uk';

    const emails: any[] = [];
    const logged: any[] = [];
    const adminLookups: string[] = [];

    const admin: any = {
        from(table: string) {
            return {
                select() {
                    const chain: any = {
                        eq: (col: string, val: any) => { adminLookups.push(table + '.' + col + '=' + val); return chain; },
                        maybeSingle: async () => ({ data: { id: 'b-1' }, error: null }),
                        then: (r: any) => r({ data: [{ id: 'director-1' }], error: null }),
                    };
                    return chain;
                },
                update() { return { eq: async () => ({ data: null, error: null }) }; },
                insert: async () => ({ data: null, error: null }),
                // The dispute branch upserts on Stripe's own id. Without this
                // the branch throws and the outer catch swallows it, which
                // looks exactly like "no email was sent".
                upsert: async () => ({ data: null, error: null }),
            };
        },
        auth: {
            admin: {
                getUserById: async (id: string) => {
                    adminLookups.push('getUserById:' + id);
                    return { data: { user: { email: 'liamworrall18@hotmail.com' } } };
                },
            },
        },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@/lib/stripe', {
        verifyStripeSignature: async () => true,
        stripeRequest: async () => ({}),
    });
    stubModule('@/lib/disputes', {
        guidanceFor: () => ({ meaning: 'The guest says they did not do this.', evidence: ['the booking'], weHold: ['the emails'] }),
    });
    stubModule('@/lib/logError', {
        logError: async (message: string, detail?: any) => { logged.push({ message, detail }); },
    });
    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string, html: string) => {
            emails.push({ to, subject, html });
            return options.delivered !== false;
        },
        emailLayout: (body: string) => body,
        escapeHtml: (x: string) => String(x),
        formatDate: () => '1 January',
        button: () => '',
        SITE_URL: 'http://example.invalid',
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule(WEBHOOK);
    return { route: require('../app/api/stripe/webhook/route'), emails, logged, adminLookups };
}

const disputeOpened = () =>
    new Request('http://example.invalid/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=x' },
        body: JSON.stringify({
            id: 'evt_dispute_1',
            type: 'charge.dispute.created',
            data: {
                object: {
                    id: 'dp_1',
                    amount: 42000,
                    reason: 'fraudulent',
                    status: 'needs_response',
                    evidence_details: { due_by: 1790000000 },
                    metadata: { booking_id: 'b-1' },
                },
            },
        }),
    });

test('a chargeback alert goes to the disputes alias', async () => {
    const { route, emails } = loadWebhook({ alertTo: 'disputes@gallowaygetaways.co.uk' });
    await route.POST(disputeOpened());

    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, 'disputes@gallowaygetaways.co.uk');
    assert.match(emails[0].subject, /Chargeback opened/);
});

test('a chargeback alert never resolves an admin’s personal account address', async () => {
    const { route, emails, adminLookups } = loadWebhook();
    await route.POST(disputeOpened());

    assert.equal(emails.length, 1);
    assert.doesNotMatch(emails[0].to, /hotmail/,
        'this is the email with the deadline on it — it must not go to a personal inbox');
    assert.equal(
        adminLookups.filter((c) => c.indexOf('getUserById') === 0).length, 0,
        'and it must not be keyed on the admin table at all'
    );
});

test('the address comes from the environment, not the code', async () => {
    const { route, emails } = loadWebhook({ alertTo: 'somewhere.else@example.invalid' });
    await route.POST(disputeOpened());
    assert.equal(emails[0].to, 'somewhere.else@example.invalid');
});

test('a chargeback alert that did not send is logged', async () => {
    const { route, logged } = loadWebhook({ delivered: false });
    await route.POST(disputeOpened());

    const hit = logged.filter((l) => /dispute alert did not send/.test(l.message));
    assert.equal(hit.length, 1,
        'silence here costs the evidence window and the money with it');
});

test('an unset DISPUTES_ALERT_EMAIL is logged rather than passing quietly', async () => {
    const { route, emails, logged } = loadWebhook({ alertTo: null });
    await route.POST(disputeOpened());

    assert.equal(emails.length, 0);
    const hit = logged.filter((l) => /DISPUTES_ALERT_EMAIL is not set/.test(l.message));
    assert.equal(hit.length, 1);
});

// ---------------------------------------------------------------------------
// The daily error digest.
// ---------------------------------------------------------------------------

const DIGEST = '@/app/api/cron/error-digest/route';

function loadDigest(options: { alertTo?: string | null; delivered?: boolean; errors?: any[] } = {}) {
    if (options.alertTo === null) delete process.env.ACCOUNTS_ALERT_EMAIL;
    else process.env.ACCOUNTS_ALERT_EMAIL = options.alertTo || 'accounts@gallowaygetaways.co.uk';

    process.env.CRON_SECRET = 'cron-test';

    const emails: any[] = [];
    const logged: any[] = [];
    const adminLookups: string[] = [];

    const errors = options.errors === undefined
        ? [{ message: 'something broke', source: 'server', created_at: '2026-08-24T10:00:00.000Z', path: '/x' }]
        : options.errors;

    const admin: any = {
        from() {
            const chain: any = {
                select: () => chain,
                eq: () => chain,
                gte: () => chain,
                order: () => chain,
                limit: () => chain,
                then: (r: any) => r({ data: errors, error: null }),
            };
            return chain;
        },
        auth: {
            admin: {
                getUserById: async (id: string) => {
                    adminLookups.push('getUserById:' + id);
                    return { data: { user: { email: 'liamworrall18@hotmail.com' } } };
                },
            },
        },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@/lib/logError', {
        logError: async (message: string, detail?: any) => { logged.push({ message, detail }); },
    });
    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string, html: string) => {
            emails.push({ to, subject, html });
            return options.delivered !== false;
        },
        emailLayout: (body: string) => body,
        escapeHtml: (x: string) => String(x),
        button: () => '',
        SITE_URL: 'http://example.invalid',
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule(DIGEST);
    return { route: require('../app/api/cron/error-digest/route'), emails, logged, adminLookups };
}

const cronCall = () =>
    new Request('http://example.invalid/api/cron/error-digest', {
        method: 'GET',
        headers: { authorization: 'Bearer cron-test' },
    });

test('the digest goes to the accounts alias', async () => {
    const { route, emails } = loadDigest();
    await route.GET(cronCall());

    assert.equal(emails.length, 1, 'one email to an alias, not one per director');
    assert.equal(emails[0].to, 'accounts@gallowaygetaways.co.uk');
});

test('the digest never resolves an admin’s personal account address', async () => {
    const { route, emails, adminLookups } = loadDigest();
    await route.GET(cronCall());

    assert.doesNotMatch(emails[0].to, /hotmail/);
    assert.equal(adminLookups.filter((c) => c.indexOf('getUserById') === 0).length, 0);
});

test('a digest that did not send is logged', async () => {
    const { route, logged } = loadDigest({ delivered: false });
    const res: any = await route.GET(cronCall());

    assert.equal(res.body.sent, 0, 'it must not count a send that did not happen');
    const hit = logged.filter((l) => /digest did not send/.test(l.message));
    assert.equal(hit.length, 1,
        'the thing that tells us something is broken must not break quietly');
});

test('an unset ACCOUNTS_ALERT_EMAIL is logged rather than passing quietly', async () => {
    const { route, emails, logged } = loadDigest({ alertTo: null });
    const res: any = await route.GET(cronCall());

    assert.equal(emails.length, 0);
    assert.equal(res.body.sent, 0);
    const hit = logged.filter((l) => /ACCOUNTS_ALERT_EMAIL is not set/.test(l.message));
    assert.equal(hit.length, 1);
});
