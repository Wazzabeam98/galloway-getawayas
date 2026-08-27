// Asking again for the confirmation email.
//
// The capability is already public — /auth/v1/resend takes the anon key and the
// anon key ships in the client bundle — so this route does not open a door. The
// job is to avoid building a wider one, and what makes it wider would be a free
// text email field, a service-role send, or an answer that varies with what was
// found.
//
// The sharp edge is that the built-in mail quota is PROJECT-WIDE: a brand-new
// address was refused 429 on its first ever send because the project's
// allowance was spent (27 Aug 2026). Anyone who can trigger sends can stop
// every real confirmation and password reset. So most of this file is about
// what the route refuses to do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const ROUTE = '@/app/api/services/resend-verification/route';
const PROVIDER = 'prov-1';
const OWNER = 'owner-1';

function load(options: {
    provider?: any;
    user?: any;
    mailError?: string;
} = {}) {
    const resent: any[] = [];
    const updated: any[] = [];
    const logged: any[] = [];
    const anonKeysUsed: string[] = [];

    const provider = options.provider === undefined
        ? { id: PROVIDER, owner_id: OWNER }
        : options.provider;

    const user = options.user === undefined
        ? { id: OWNER, email: 'applicant@example.test', email_confirmed_at: null, confirmation_sent_at: null, user_metadata: {} }
        : options.user;

    function builder() {
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'maybeSingle') return async () => ({ data: provider, error: null });
                if (prop === 'then') return (r: any) => r({ data: provider, error: null });
                return () => chain;
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', {
        supabaseUrl: () => 'http://example.invalid',
        serviceRoleKey: () => 'test-service-key',
        adminClient: () => ({
            from: () => builder(),
            auth: {
                admin: {
                    getUserById: async () => (user ? { data: { user }, error: null } : { data: null, error: { message: 'no user' } }),
                    updateUserById: async (id: string, attrs: any) => { updated.push({ id, attrs }); return { data: null, error: null }; },
                },
            },
        }),
    });

    stubModule('@supabase/supabase-js', {
        createClient: (_url: string, key: string) => {
            anonKeysUsed.push(key);
            return {
                auth: {
                    resend: async (args: any) => {
                        resent.push(args);
                        return options.mailError ? { error: { message: options.mailError } } : { error: null };
                    },
                },
            };
        },
    });

    stubModule('@/lib/logError', {
        logError: async (message: string, detail?: any) => { logged.push({ message, detail }); },
    });

    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, resent, updated, logged, anonKeysUsed };
}

const call = (body: any) =>
    new Request('http://example.invalid/api/services/resend-verification', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

/* ------------------------------------------------------- it does the job */

test('a lodged application can ask again, and the email goes to its owner', async () => {
    const { route, resent } = load();
    const res: any = await route.POST(call({ providerId: PROVIDER }));

    assert.equal(res.body.ok, true);
    assert.equal(res.body.sent, true);
    assert.equal(resent.length, 1);
    assert.equal(resent[0].email, 'applicant@example.test');
    assert.equal(resent[0].type, 'signup');
});

test('it sends with the ANON key, so Supabase throttle is still above it', async () => {
    // The service role would step over the one limit that exists.
    const { route, anonKeysUsed } = load();
    await route.POST(call({ providerId: PROVIDER }));

    assert.equal(anonKeysUsed.includes('test-anon-key'), true);
    assert.equal(anonKeysUsed.includes('test-service-key'), false);
});

/* ------------------------------------------------------ it cannot be aimed */

test('an email address in the body is ignored entirely', async () => {
    // The whole design. There is no way to point this at somebody.
    const { route, resent } = load();
    await route.POST(call({ providerId: PROVIDER, email: 'victim@example.test' }));

    assert.equal(resent[0].email, 'applicant@example.test');
});

test('with no application id, nothing is sent', async () => {
    const { route, resent } = load();
    const res: any = await route.POST(call({ email: 'victim@example.test' }));

    assert.equal(res.body.ok, true);
    assert.equal(resent.length, 0);
});

test('an application that does not exist is answered the same as one that does', async () => {
    // No oracle. A caller cannot learn whether an id is real.
    const real = await load().route.POST(call({ providerId: PROVIDER }));
    const fake = await load({ provider: null }).route.POST(call({ providerId: 'made-up' }));

    assert.equal(real.body.ok, true);
    assert.equal(fake.body.ok, true);
    assert.equal(fake.status, real.status);
});

/* --------------------------------------------------------------- the limits */

test('a second ask inside the cooldown does not send', async () => {
    const justNow = new Date(Date.now() - 5000).toISOString();
    const { route, resent } = load({
        user: { id: OWNER, email: 'applicant@example.test', email_confirmed_at: null, confirmation_sent_at: justNow, user_metadata: {} },
    });
    const res: any = await route.POST(call({ providerId: PROVIDER }));

    assert.equal(resent.length, 0);
    assert.equal(typeof res.body.wait, 'number');
    assert.ok(res.body.wait > 0 && res.body.wait <= 60);
});

test('once the cooldown has passed it sends again', async () => {
    const agesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { route, resent } = load({
        user: { id: OWNER, email: 'applicant@example.test', email_confirmed_at: null, confirmation_sent_at: agesAgo, user_metadata: {} },
    });
    await route.POST(call({ providerId: PROVIDER }));

    assert.equal(resent.length, 1);
});

test('the daily ceiling stops it, and says to talk to us instead', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { route, resent } = load({
        user: {
            id: OWNER, email: 'applicant@example.test', email_confirmed_at: null, confirmation_sent_at: null,
            user_metadata: { resend_day: today, resend_count: 5 },
        },
    });
    const res: any = await route.POST(call({ providerId: PROVIDER }));

    assert.equal(resent.length, 0);
    assert.equal(res.body.capped, true);
});

test('yesterday does not count against today', async () => {
    const { route, resent } = load({
        user: {
            id: OWNER, email: 'applicant@example.test', email_confirmed_at: null, confirmation_sent_at: null,
            user_metadata: { resend_day: '2020-01-01', resend_count: 99 },
        },
    });
    await route.POST(call({ providerId: PROVIDER }));

    assert.equal(resent.length, 1);
});

test('a refused send does not spend the allowance', async () => {
    // Otherwise a rate-limited evening burns somebody's five and they cannot
    // try when the quota comes back.
    const { route, updated, logged } = load({ mailError: 'email rate limit exceeded' });
    const res: any = await route.POST(call({ providerId: PROVIDER }));

    assert.equal(res.body.sent, false);
    assert.equal(updated.length, 0, 'the counter was not moved');
    assert.equal(logged.some((l) => l.message === 'service-resend-verification'), true);
});

test('a successful send is counted', async () => {
    const { route, updated } = load();
    await route.POST(call({ providerId: PROVIDER }));

    assert.equal(updated.length, 1);
    assert.equal(updated[0].attrs.user_metadata.resend_count, 1);
});

test('an already-confirmed account is not emailed', async () => {
    const { route, resent } = load({
        user: { id: OWNER, email: 'applicant@example.test', email_confirmed_at: '2026-08-01T00:00:00Z', user_metadata: {} },
    });
    const res: any = await route.POST(call({ providerId: PROVIDER }));

    assert.equal(resent.length, 0);
    assert.equal(res.body.ok, true);
});
