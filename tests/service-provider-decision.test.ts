// What the approve/decline route does about the email.
//
// The existing service-provider tests cover lib/serviceProviders.ts — the
// validation and the distance maths — and nothing at all covers the route.
// That is how a decision that saved the row and sent no email passed 227
// tests: the row is written by code nobody was asserting on.
//
// Two different things are checked here, and they are not the same thing:
//
//   - that a send is attempted at all. This is the inbox-composer bug, where
//     the route simply never called out to email. It is not the bug we have.
//   - that a send which did not happen is not reported as a success. This is
//     the bug we have. sendEmail returns false rather than throwing, so a
//     missing RESEND_API_KEY produces a decision the admin is told went fine
//     and a business that never hears anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/admin/providers/route';

const ADMIN_ID = 'admin-1';
const PROVIDER_ID = 'prov-1';

// `delivered` is what the stubbed sendEmail hands back — true for a send that
// reached Resend, false for the preview environment with no API key.
function load(options: { delivered?: boolean; isAdmin?: boolean; status?: string } = {}) {
    const delivered = options.delivered !== false;
    const sent: any[] = [];
    const logged: any[] = [];
    const updates: any[] = [];

    const provider = {
        id: PROVIDER_ID,
        business_name: 'Solway Sparkle',
        contact_email: 'hello@solwaysparkle.test',
        status: options.status || 'pending_review',
    };

    function builder(table: string) {
        const state: any = { ops: [] };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') {
                    // The same table is read and then written, so what comes
                    // back depends on which was asked for.
                    const wrote = state.ops.indexOf('update') !== -1;
                    if (wrote) {
                        updates.push({ table, patch: state.patch });
                        return (resolve: any) => resolve({ data: null, error: null });
                    }
                    if (table === 'profiles') {
                        return (resolve: any) =>
                            resolve({ data: { is_admin: options.isAdmin !== false }, error: null });
                    }
                    if (table === 'service_providers') {
                        return (resolve: any) => resolve({ data: provider, error: null });
                    }
                    return (resolve: any) => resolve({ data: null, error: null });
                }
                return (...args: any[]) => {
                    state.ops.push(prop);
                    if (prop === 'update') state.patch = args[0];
                    return chain;
                };
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: (t: string) => builder(t) }) });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: { id: ADMIN_ID } } }) },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('@/lib/logError', {
        logError: async (message: string, detail?: any) => { logged.push({ message, detail }); },
    });
    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string, html: string) => {
            sent.push({ to, subject, html });
            return delivered;
        },
        emailLayout: (body: string) => body,
        escapeHtml: (s: string) => String(s),
        button: () => '',
        SITE_URL: 'http://example.invalid',
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, sent, logged, updates };
}

const call = (decision: string, note?: string) =>
    new Request('http://example.invalid/api/admin/providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: PROVIDER_ID, decision, note: note || '' }),
    });

// ---------------------------------------------------------------------------
// The send is attempted. These pass today — the call is there and it is
// awaited. They are a guard against it being lost, not a diagnosis.
// ---------------------------------------------------------------------------

test('approving attempts to send the business an email', async () => {
    const { route, sent, updates } = load();
    const res: any = await route.POST(call('approve'));

    assert.equal(res.status, 200);
    assert.equal(updates.length, 1, 'the row is written');
    assert.equal(updates[0].patch.status, 'approved');

    assert.equal(sent.length, 1, 'and an email is attempted — not just the row written');
    assert.equal(sent[0].to, 'hello@solwaysparkle.test');
    assert.match(sent[0].subject, /listed on Galloway Getaways/);
});

test('declining attempts to send the business the reason', async () => {
    const { route, sent, updates } = load();
    const res: any = await route.POST(call('decline', 'We need more detail about what you offer.'));

    assert.equal(res.status, 200);
    assert.equal(updates[0].patch.status, 'declined');

    assert.equal(sent.length, 1, 'a decline emails them too');
    assert.match(sent[0].html, /We need more detail about what you offer\./,
        'the reason the admin typed is what they read');
});

// ---------------------------------------------------------------------------
// The send did not happen. These are the ones that fail today.
// ---------------------------------------------------------------------------

test('an approval whose email did not send does not report plain success', async () => {
    const { route, updates } = load({ delivered: false });
    const res: any = await route.POST(call('approve'));

    // The decision must still stand. An email that failed must not undo a
    // write that already happened.
    assert.equal(res.status, 200);
    assert.equal(updates[0].patch.status, 'approved', 'the decision is kept');

    // But the admin must not be told it all went through.
    assert.equal(res.body.emailed, false,
        'the response has to say the email did not go, or the screen lies about it');
});

test('a decline whose email did not send does not report plain success', async () => {
    const { route } = load({ delivered: false });
    const res: any = await route.POST(call('decline', 'Not enough detail.'));

    assert.equal(res.status, 200);
    assert.equal(res.body.emailed, false);
});

test('an email that did not send is written to the error log', async () => {
    const { route, logged } = load({ delivered: false });
    await route.POST(call('approve'));

    assert.equal(logged.length, 1,
        'nothing reaches /admin/errors today, so the only trace is a console line in Vercel');
    assert.match(logged[0].message, /service-provider-decision-email/);
});

test('an email that did send reports so, and logs nothing', async () => {
    const { route, logged } = load({ delivered: true });
    const res: any = await route.POST(call('approve'));

    assert.equal(res.body.emailed, true);
    assert.equal(logged.length, 0);
});

// ---------------------------------------------------------------------------
// The reason is quoted, not run into our own sentence.
//
// On the join page "no" — a real reason somebody typed — rendered as
// "no Change what you need to and send it again.", one broken-looking line.
// The email never had that exact bug, because the reason was already its own
// <p>, but it was in the same size and colour as the sentences either side, so
// a one-word reason read as part of ours rather than as a quote of ours.
// ---------------------------------------------------------------------------

test('the reason is set apart from the sentence that follows it', async () => {
    const { route, sent } = load();
    await route.POST(call('decline', 'no'));

    const html = sent[0].html;

    assert.match(html, /border-left:4px solid/, 'the reason sits behind a rule');
    assert.doesNotMatch(html, /no You can change it/,
        'the reason must never run straight into our own sentence');
    assert.match(html, /<\/table><p[^>]*>You can change it/,
        'our sentence starts a new block after the quote closes');
});

test('a reason typed over several lines arrives as several lines', async () => {
    const { route, sent } = load();
    await route.POST(call('decline', 'Two things.\nThe photos are dark.\nThe description is one word.'));

    const html = sent[0].html;

    assert.match(html, /Two things\.<br>The photos are dark\.<br>The description is one word\./,
        'HTML collapses newlines, so they have to become <br> or the reason arrives as one line');
});
