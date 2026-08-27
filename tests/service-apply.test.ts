// One press: the account is made and the application is lodged.
//
// This replaced a two-step shape — make an account, get a confirmation email,
// come back, press send again — which lost applications whenever anything went
// wrong in between, because no row had been written to lose. It did: the first
// real walk through ended with no service_providers row at all.
//
// So what is asserted here is mostly about what must NOT be possible to lose,
// and what an applicant must NOT be able to decide for themselves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const ROUTE = '@/app/api/services/apply/route';

function load(options: { createError?: string; insertError?: string; mailError?: string } = {}) {
    const inserted: Record<string, any[]> = {};
    const created: any[] = [];
    const announced: any[] = [];
    const resent: any[] = [];
    const logged: any[] = [];

    const provider = { id: 'prov-new', owner_id: 'user-new', business_name: 'Kirkcudbright Joinery' };

    function builder(table: string) {
        const state: any = { table };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') {
                    if (table === 'service_skills') {
                        return (r: any) => r({ data: [{ id: 'sk-1', label: 'Sash windows', slug: 'sash-windows' }], error: null });
                    }
                    return (r: any) => r({ data: null, error: null });
                }
                if (prop === 'insert') {
                    return (rows: any) => {
                        inserted[table] = (inserted[table] || []).concat(rows);
                        state.rows = rows;
                        return chain;
                    };
                }
                if (prop === 'single') {
                    if (options.insertError) {
                        return async () => ({ data: null, error: { message: options.insertError } });
                    }
                    return async () => ({ data: provider, error: null });
                }
                if (prop === 'upsert') {
                    return (rows: any) => {
                        inserted[table] = (inserted[table] || []).concat(rows);
                        return chain;
                    };
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
                    createUser: async (attrs: any) => {
                        created.push(attrs);
                        if (options.createError) return { data: null, error: { message: options.createError } };
                        return { data: { user: { id: 'user-new', email: attrs.email } }, error: null };
                    },
                },
            },
        }),
    });

    stubModule('@supabase/supabase-js', {
        createClient: () => ({
            auth: {
                resend: async (args: any) => {
                    resent.push(args);
                    return options.mailError ? { error: { message: options.mailError } } : { error: null };
                },
            },
        }),
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

    // Note: the alert is STUBBED above, so it must not be cleared here — that
    // would drop the stub straight back out of the cache and the route would
    // load the real one.
    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, inserted, created, announced, resent, logged };
}

const APPLICATION = {
    email: 'JOINER@example.test',
    password: 'a-long-enough-password',
    name: 'Kirkcudbright Joinery',
    provider: {
        business_name: 'Kirkcudbright Joinery',
        trade: 'joiner',
        description: 'Second fix and sash windows.',
        contact_email: 'joiner@example.test',
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

/* ------------------------------------------------- the press does everything */

test('one press writes the account and the application', async () => {
    const { route, created, inserted } = load();
    const res: any = await route.POST(call(APPLICATION));

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(created.length, 1);
    assert.equal(inserted.service_providers.length, 1);
});

test('the row is lodged, not left as a draft', async () => {
    // The whole fault this replaced: an application that was never sent.
    const { route, inserted } = load();
    await route.POST(call(APPLICATION));

    assert.equal(inserted.service_providers[0].status, 'pending_review');
    assert.ok(inserted.service_providers[0].submitted_at, 'it carries the moment it was lodged');
});

test('the account is created UNCONFIRMED, so the badge can tell the truth', async () => {
    const { route, created } = load();
    await route.POST(call(APPLICATION));

    assert.equal(created[0].email_confirm, false);
});

test('the address is lower-cased, so a capital does not make a second account', async () => {
    const { route, created } = load();
    await route.POST(call(APPLICATION));

    assert.equal(created[0].email, 'joiner@example.test');
});

test('the children are written against the new row', async () => {
    const { route, inserted } = load();
    await route.POST(call(APPLICATION));

    assert.equal(inserted.service_areas[0].provider_id, 'prov-new');
    assert.equal(inserted.service_provider_prices[0].provider_id, 'prov-new');
    assert.equal(inserted.service_provider_extras[0].provider_id, 'prov-new');
    assert.equal(inserted.service_provider_registrations[0].provider_id, 'prov-new');
    assert.equal(inserted.service_provider_skills[0].skill_id, 'sk-1');
});

/* ----------------------------------------- what an applicant may not decide */

test('an applicant cannot approve themselves through this route', async () => {
    // The payload is a stranger's by definition. Anything not on the whitelist
    // is dropped rather than trusted — the same rule the column grants enforce
    // for the browser, said again where the service role is doing the writing
    // and the grants therefore do not apply.
    const { route, inserted } = load();
    await route.POST(call({
        ...APPLICATION,
        provider: {
            ...APPLICATION.provider,
            status: 'approved',
            approved_digest: 'forged',
            commission_rate: 0,
            approved_at: '2020-01-01',
        },
    }));

    const row = inserted.service_providers[0];
    assert.equal(row.status, 'pending_review', 'status is the platform\'s, not theirs');
    assert.equal(row.approved_digest, undefined);
    assert.equal(row.commission_rate, undefined);
    assert.equal(row.approved_at, undefined);
});

test('a registration cannot arrive already verified', async () => {
    const { route, inserted } = load();
    await route.POST(call({
        ...APPLICATION,
        registrations: [{ scheme: 'gas_safe', number: '123456', verified_at: '2020-01-01', verified_number: '123456' }],
    }));

    const reg = inserted.service_provider_registrations[0];
    assert.equal(reg.verified_at, undefined);
    assert.equal(reg.verified_number, undefined);
});

test('the owner is the account just made, whatever the payload says', async () => {
    const { route, inserted } = load();
    await route.POST(call({ ...APPLICATION, provider: { ...APPLICATION.provider, owner_id: 'somebody-else' } }));

    assert.equal(inserted.service_providers[0].owner_id, 'user-new');
});

/* ------------------------------------------------------------ what it needs */

test('a trade that does not exist is refused', async () => {
    const { route } = load();
    const res: any = await route.POST(call({ ...APPLICATION, provider: { ...APPLICATION.provider, trade: 'wizard' } }));
    assert.equal(res.status, 400);
});

test('a short password is refused before an account is made', async () => {
    const { route, created } = load();
    const res: any = await route.POST(call({ ...APPLICATION, password: 'short' }));
    assert.equal(res.status, 400);
    assert.equal(created.length, 0, 'nothing was created');
});

test('an address already in use is offered the way in, not an error', async () => {
    const { route } = load({ createError: 'User already registered' });
    const res: any = await route.POST(call(APPLICATION));

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'account_exists');
    assert.match(res.body.error, /already an account/i);
});

/* --------------------------------------------------- verification and telling us */

test('the confirmation email is asked for, and does not hold the row up', async () => {
    const { route, resent, inserted } = load();
    await route.POST(call(APPLICATION));

    // Sent after the row exists, so a mail failure cannot cost them the
    // application.
    assert.equal(inserted.service_providers.length, 1);
    assert.equal(resent.length, 1);
    assert.equal(resent[0].type, 'signup');
    assert.equal(resent[0].email, 'joiner@example.test');
});

test('we are told a business is waiting', async () => {
    const { route, announced } = load();
    await route.POST(call(APPLICATION));

    assert.equal(announced.length, 1);
    assert.equal(announced[0].id, 'prov-new');
});

test('a failed insert says the account survived rather than pretending it worked', async () => {
    const { route, logged } = load({ insertError: 'boom' });
    const res: any = await route.POST(call(APPLICATION));

    assert.equal(res.status, 500);
    assert.match(res.body.error, /sign in and it will be waiting/i);
    assert.equal(logged.some((l) => l.message === 'service-apply-insert'), true);
});

/* ------------------------------------ what the applicant is told about email */

test('a sent confirmation is reported as sent', async () => {
    const { route } = load();
    const res: any = await route.POST(call(APPLICATION));

    assert.equal(res.body.verificationEmailed, true);
});

test('a REFUSED confirmation is reported as refused, and the application still stands', async () => {
    // Two real ways this fails on test alone: the built-in SMTP is rate limited
    // to a handful an hour for the whole project, and a reserved TLD like
    // .test is rejected outright as invalid. Both were observed on 27 Aug.
    //
    // The panel used to say "we have also sent a link" whatever happened, which
    // leaves somebody watching an inbox for a message that was never accepted.
    const { route, inserted, logged } = load({ mailError: 'email rate limit exceeded' });
    const res: any = await route.POST(call(APPLICATION));

    assert.equal(res.body.ok, true, 'the application is in regardless');
    assert.equal(inserted.service_providers.length, 1);
    assert.equal(res.body.verificationEmailed, false, 'and the caller is told the email did not go');
    assert.equal(logged.some((l) => l.message === 'service-apply-verification-email'), true);
});

test('the email is asked for AFTER the row, so a mail failure cannot cost the application', async () => {
    const { route, inserted, resent } = load({ mailError: 'email rate limit exceeded' });
    await route.POST(call(APPLICATION));

    assert.equal(inserted.service_providers.length, 1);
    assert.equal(resent.length, 1);
});
