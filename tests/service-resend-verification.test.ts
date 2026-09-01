// Asking again for the link on a lodged application.
//
// WHAT THIS ROUTE IS GUARDING
//
// The outbound mail allowance is shared with every password reset and booking
// confirmation on the site, so anything that can be made to send email can be
// made to stop all of it. A resend button with a free-text address field would
// be that attack with a friendly front end.
//
// WHAT CHANGED ON 1 SEPTEMBER 2026
//
// The cooldown and the ceiling used to be read off the auth account —
// `confirmation_sent_at` and `user_metadata`. There is no account at this point
// in the flow any more: that is the whole change, and the reason the state now
// lives on the application row. What did NOT change is the shape of the
// answer, which is the half that matters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/services/resend-verification/route';

const AGES_AGO = new Date(Date.now() - 3600 * 1000).toISOString();

function load(row: any | null, options: { mailSent?: boolean; updateError?: string } = {}) {
    const mailed: any[] = [];
    const updates: any[] = [];
    const logged: any[] = [];

    function builder() {
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') return (r: any) => r({ data: null, error: null });
                if (prop === 'maybeSingle') return async () => ({ data: row, error: null });
                if (prop === 'update') {
                    return (patch: any) => {
                        updates.push(patch);
                        return {
                            eq: async () => ({
                                data: null,
                                error: options.updateError ? { message: options.updateError } : null,
                            }),
                        };
                    };
                }
                return () => chain;
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', {
        supabaseUrl: () => 'http://example.invalid',
        adminClient: () => ({ from: () => builder() }),
    });

    stubModule('@/lib/email', {
        sendEmail: async (to: string, subject: string, html: string) => {
            mailed.push({ to, subject, html });
            return options.mailSent === false ? false : true;
        },
        emailLayout: (body: string, footer: string) => body + '|' + footer,
        escapeHtml: (v: string) => String(v),
        button: (url: string, label: string) => '<a href="' + url + '">' + label + '</a>',
        SITE_URL: 'https://gallowaygetaways.co.uk',
    });

    stubModule('@/lib/logError', {
        logError: async (message: string, detail?: any) => { logged.push({ message, detail }); },
    });

    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    clearModule('@/lib/serviceApplications');
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, mailed, updates, logged };
}

const LIVE = {
    id: 'app-1',
    email: 'joiner@example.com',
    business_name: 'Kirkcudbright Joinery',
    token_sent_at: AGES_AGO,
    resend_count: 0,
    last_resend_at: null,
    claimed_at: null,
    created_at: AGES_AGO,
};

const call = (body: any) =>
    new Request('http://example.invalid/api/services/resend-verification', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

/* ------------------------------------------------------------ it works */

test('a lodged application can ask again, and the email goes to its owner', async () => {
    const { route, mailed } = load(LIVE);
    const res: any = await route.POST(call({ applicationId: 'app-1' }));

    assert.equal(res.body.ok, true);
    assert.equal(mailed.length, 1);
    assert.equal(mailed[0].to, 'joiner@example.com');
    assert.match(String(mailed[0].html), /finish\//);
});

test('an email address in the body is ignored entirely', async () => {
    // There is no field for a stranger to type into, and no way to aim this
    // at somebody. The address comes off the row, always.
    const { route, mailed } = load(LIVE);
    await route.POST(call({ applicationId: 'app-1', email: 'attacker@example.com' }));

    assert.equal(mailed[0].to, 'joiner@example.com');
});

/* -------------------------------------------- a fresh token, every time */

test('a new link retires the old one', async () => {
    // Otherwise a chain of resends leaves a trail of live account-creating
    // credentials sitting in an inbox.
    const { route, updates } = load(LIVE);
    await route.POST(call({ applicationId: 'app-1' }));

    assert.equal(updates.length, 1);
    assert.match(updates[0].token_hash, /^[0-9a-f]{64}$/);
    assert.ok(updates[0].token_sent_at, 'the fourteen days start again');
    assert.equal(updates[0].resend_count, 1);
});

test('the token is written before the mail goes', async () => {
    // The other order emails a link that authenticates against nothing. This
    // order's worst case is a live token nobody was told about, which expires
    // on its own.
    const { route, mailed, logged } = load(LIVE, { updateError: 'connection reset' });
    const res: any = await route.POST(call({ applicationId: 'app-1' }));

    assert.equal(res.body.ok, true, 'the answer never varies');
    assert.deepEqual(mailed, [], 'nothing is sent if the token could not be stored');
    assert.ok(logged.length > 0);
});

/* ------------------------------------------------------ one answer, always */

test('a missing application answers exactly like a successful send', async () => {
    const good: any = await (async () => { const l = load(LIVE); return l.route.POST(call({ applicationId: 'app-1' })); })();
    const gone: any = await (async () => { const l = load(null); return l.route.POST(call({ applicationId: 'nope' })); })();

    assert.equal(good.body.ok, true);
    assert.equal(gone.body.ok, true);
    assert.equal(gone.status, 200);
});

test('an application already finished sends nothing and says nothing', async () => {
    const { route, mailed } = load({ ...LIVE, claimed_at: new Date().toISOString() });
    const res: any = await route.POST(call({ applicationId: 'app-1' }));

    assert.equal(res.body.ok, true);
    assert.deepEqual(mailed, []);
});

test('no id at all is not an error either', async () => {
    const { route, mailed } = load(LIVE);
    const res: any = await route.POST(call({}));

    assert.equal(res.body.ok, true);
    assert.deepEqual(mailed, []);
});

/* ------------------------------------------------- cooldown and ceiling */

test('a second ask inside the cooldown does not send', async () => {
    const { route, mailed } = load({
        ...LIVE,
        last_resend_at: new Date(Date.now() - 5 * 1000).toISOString(),
    });
    const res: any = await route.POST(call({ applicationId: 'app-1' }));

    assert.equal(res.body.ok, true);
    assert.ok(res.body.wait > 0, 'the caller already holds this id, so a wait tells them nothing new');
    assert.deepEqual(mailed, []);
});

test('once the cooldown has passed it sends again', async () => {
    const { route, mailed } = load({
        ...LIVE,
        last_resend_at: new Date(Date.now() - 120 * 1000).toISOString(),
    });
    await route.POST(call({ applicationId: 'app-1' }));
    assert.equal(mailed.length, 1);
});

test('the daily ceiling stops it, and says to talk to us instead', async () => {
    const { route, mailed } = load({ ...LIVE, resend_count: 5 });
    const res: any = await route.POST(call({ applicationId: 'app-1' }));

    assert.equal(res.body.ok, true);
    assert.equal(res.body.capped, true);
    assert.deepEqual(mailed, [], 'somebody on their sixth link has a different problem');
});

test('a refused send does not claim to have gone', async () => {
    const { route, logged } = load(LIVE, { mailSent: false });
    const res: any = await route.POST(call({ applicationId: 'app-1' }));

    assert.equal(res.body.ok, true);
    assert.equal(res.body.sent, false);
    assert.ok(logged.some((l) => /resend-verification/.test(String(l.message))));
});
