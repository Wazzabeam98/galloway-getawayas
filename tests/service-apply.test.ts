// One press lodges the application. Nothing is created that could be squatted.
//
// WHAT CHANGED, AND WHY THESE TESTS ARE MOSTLY ABOUT ABSENCES
//
// This route used to create a real Supabase auth user on the first press, from
// a public form, with nothing showing that the person filling it in owned the
// address they typed. So a stranger could put your address into it and you had
// an account you never made: you could not sign up later, because it was
// taken, and you got a confirmation email you never asked for.
//
// The account is now made by /api/services/finish, when the emailed link comes
// back — see tests/service-finish.test.ts. What is asserted here is therefore
// as much about what must NOT happen as about what must.
//
// The one thing kept from the old design on purpose: the application row is
// written BEFORE any email is sent. The two-press version this replaced lost
// people, because no row had been written to lose, and that failure is not
// being reintroduced — it is the reason the chase list on /admin/providers
// exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const ROUTE = '@/app/api/services/apply/route';

function load(options: { insertError?: string; mailSent?: boolean; existingEmails?: string[] } = {}) {
    const inserted: Record<string, any[]> = {};
    const created: any[] = [];
    const announced: any[] = [];
    const mailed: any[] = [];
    const logged: any[] = [];

    const application = { id: 'app-1', email: 'joiner@example.com', business_name: 'Kirkcudbright Joinery' };

    function builder(table: string) {
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') return (r: any) => r({ data: null, error: null });
                if (prop === 'insert') {
                    return (rows: any) => {
                        inserted[table] = (inserted[table] || []).concat(rows);
                        return chain;
                    };
                }
                if (prop === 'single') {
                    if (options.insertError) return async () => ({ data: null, error: { message: options.insertError } });
                    return async () => ({ data: application, error: null });
                }
                return () => chain;
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', {
        supabaseUrl: () => 'http://example.invalid',
        serviceRoleKey: () => 'test-service-key',
        adminClient: () => ({
            from: (t: string) => builder(t),
            auth: {
                admin: {
                    // If this is ever reached, the squat is back.
                    createUser: async (attrs: any) => {
                        created.push(attrs);
                        return { data: { user: { id: 'user-new', email: attrs.email } }, error: null };
                    },
                    listUsers: async () => ({
                        data: { users: (options.existingEmails || []).map((e) => ({ email: e })) },
                        error: null,
                    }),
                },
            },
        }),
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

    stubModule('@/lib/serviceSubmittedAlert', {
        announceSubmission: async (p: any) => { announced.push(p); return { ok: true, emailed: true }; },
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
    return { route, inserted, created, announced, mailed, logged };
}

const APPLICATION = {
    email: 'JOINER@example.com',
    name: 'Kirkcudbright Joinery',
    provider: {
        business_name: 'Kirkcudbright Joinery',
        trade: 'joiner',
        description: 'Second fix and sash windows.',
        contact_email: 'joiner@example.com',
        contact_phone: '07700 900412',
        callout_fee: 45,
    },
    areas: [{ label: 'Kirkcudbright', centre_lat: 54.8, centre_lng: -4.05, radius_miles: 10 }],
    registrations: [{ scheme: 'gas_safe', number: '123456' }],
    prices: [{ band_key: 'beds_1_2', price: 80, typical_hours: 3 }],
    extras: [{ extra_key: 'linen', offered: true, price: null, notes: null }],
    skills: ['Sash windows'],
};

const call = (body: any) =>
    new Request('http://example.invalid/api/services/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

/* ------------------------------------------------------ the squat, closed */

test('no account is created, however complete the application is', async () => {
    const { route, created, inserted } = load();
    const res: any = await route.POST(call(APPLICATION));

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(created, [], 'creating an auth user here is the squat');
    assert.equal(inserted.service_applications.length, 1);
    assert.equal(inserted.service_providers, undefined, 'nothing reaches the real table yet');
});

test('a password sent by an old client is ignored rather than used', async () => {
    // The wizard no longer asks for one. If a stale bundle still sends it, it
    // must not become an account, and it must certainly not be stored.
    const { route, created, inserted } = load();
    await route.POST(call({ ...APPLICATION, password: 'a-long-enough-password' }));

    assert.deepEqual(created, []);
    const row = inserted.service_applications[0];
    assert.equal(JSON.stringify(row).includes('a-long-enough-password'), false,
        'a password must never be written down outside Supabase');
});

/* ----------------------------------------------- the row, before the email */

test('the application is written before any email is sent', async () => {
    const { route, inserted, mailed } = load();
    await route.POST(call(APPLICATION));

    assert.equal(inserted.service_applications.length, 1);
    assert.equal(mailed.length, 1);
});

test('a failed write is reported and nothing is emailed', async () => {
    const { route, mailed, logged } = load({ insertError: 'connection reset' });
    const res: any = await route.POST(call(APPLICATION));

    assert.equal(res.status, 500);
    assert.equal(res.body.ok, false);
    assert.match(String(res.body.error), /nothing has been lost/i);
    assert.deepEqual(mailed, [], 'a link to an application that does not exist helps nobody');
    assert.ok(logged.some((l) => /service-apply-insert/.test(String(l.message))));
});

test('the address is lower-cased, so a capital does not make a second application', async () => {
    const { route, inserted } = load();
    await route.POST(call(APPLICATION));
    assert.equal(inserted.service_applications[0].email, 'joiner@example.com');
});

/* --------------------------------------------------- the token, never stored */

test('the token is stored as a hash and never in the clear', async () => {
    const { route, inserted, mailed } = load();
    await route.POST(call(APPLICATION));

    const row = inserted.service_applications[0];
    assert.match(row.token_hash, /^[0-9a-f]{64}$/, 'a sha256 hex digest');

    // The link in the email carries the real token. That token must not be
    // findable anywhere in the row — a read of this table must not be a set of
    // working links, every one of which creates an account on somebody's
    // address.
    const link = String(mailed[0].html).match(/finish\/([A-Za-z0-9_-]+)/);
    assert.ok(link, 'the email carries a link');
    assert.equal(JSON.stringify(row).includes(link![1]), false);
    assert.notEqual(row.token_hash, link![1]);
});

/* ------------------------------------------------ nothing is given away */

test('an address that already has an account answers exactly like one that does not', async () => {
    // The old route returned a 409 saying "there is already an account on that
    // address", which is an oracle any stranger could query for any address.
    const fresh: any = await (async () => {
        const { route } = load({ existingEmails: [] });
        return route.POST(call(APPLICATION));
    })();

    const taken: any = await (async () => {
        const { route } = load({ existingEmails: ['joiner@example.com'] });
        return route.POST(call(APPLICATION));
    })();

    assert.equal(fresh.status, taken.status);
    assert.equal(fresh.body.ok, taken.body.ok);
    assert.deepEqual(Object.keys(fresh.body).sort(), Object.keys(taken.body).sort());
    assert.equal(JSON.stringify(taken.body).toLowerCase().includes('already'), false);
});

test('the difference is carried in the email, which only its owner can read', async () => {
    const taken = load({ existingEmails: ['joiner@example.com'] });
    await taken.route.POST(call(APPLICATION));

    assert.match(String(taken.mailed[0].html), /already have a Galloway Getaways account/i);
    assert.equal(/finish\//.test(String(taken.mailed[0].html)), false,
        'no account-creating link to an address that already has one');
});

/* ------------------------------------------------ what the applicant cannot set */

test('an applicant cannot approve themselves, or set their own commission', async () => {
    const { route, inserted } = load();
    await route.POST(call({
        ...APPLICATION,
        provider: { ...APPLICATION.provider, status: 'approved', commission_rate: 0, owner_id: 'someone-else' },
    }));

    const payload = inserted.service_applications[0].payload;
    assert.equal(payload.provider.status, undefined);
    assert.equal(payload.provider.commission_rate, undefined);
    assert.equal(payload.provider.owner_id, undefined);
});

test('a registration cannot arrive already verified', async () => {
    const { route, inserted } = load();
    await route.POST(call({
        ...APPLICATION,
        registrations: [{ scheme: 'gas_safe', number: '123456', verified: true, verified_at: '2020-01-01' }],
    }));

    const reg = inserted.service_applications[0].payload.registrations[0];
    assert.deepEqual(Object.keys(reg).sort(), ['number', 'scheme']);
});

/* --------------------------------------------------------- nobody is told yet */

test('the directors are not told about an application nobody has proved', async () => {
    const { route, announced } = load();
    await route.POST(call(APPLICATION));

    assert.deepEqual(announced, [],
        'the review queue filling with unverified strangers is the noise this change prevents');
});

test('whether the email actually went is reported, not assumed', async () => {
    const { route, logged } = load({ mailSent: false });
    const res: any = await route.POST(call(APPLICATION));

    assert.equal(res.body.ok, true, 'the application is lodged either way');
    assert.equal(res.body.verificationEmailed, false, 'and the panel is told the truth about the email');
    assert.ok(logged.some((l) => /verification-email/.test(String(l.message))));
});
