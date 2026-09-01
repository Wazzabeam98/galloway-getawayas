// The moment the address is proved, and therefore the moment the account exists.
//
// Everything /api/services/apply used to do on its first press happens here
// instead — the auth user, the profile, the service_providers row and its
// children, and the alert. So every security property the old apply tests
// asserted has moved here with it, and is asserted again: an applicant cannot
// approve themselves, cannot arrive with a verified registration, and cannot
// choose whose row it is.
//
// The refusals are the other half. A token that does not work must not tell
// its holder WHICH kind of not-working it is — "expired", "already used" and
// "no such token" answering differently is an enumeration oracle over every
// token ever issued.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/services/finish/route';

const NOW = Date.now();
const days = (n: number) => new Date(NOW - n * 24 * 3600 * 1000).toISOString();

function load(row: any | null, options: { createError?: string; insertError?: string } = {}) {
    const inserted: Record<string, any[]> = {};
    const updates: any[] = [];
    const created: any[] = [];
    const announced: any[] = [];
    const logged: any[] = [];

    const provider = { id: 'prov-new', owner_id: 'user-new', business_name: 'Kirkcudbright Joinery' };

    function builder(table: string) {
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') {
                    if (table === 'service_skills') {
                        return (r: any) => r({ data: [{ id: 'sk-1', label: 'Sash windows' }], error: null });
                    }
                    return (r: any) => r({ data: null, error: null });
                }
                if (prop === 'maybeSingle') return async () => ({ data: row, error: null });
                if (prop === 'insert') {
                    return (rows: any) => {
                        inserted[table] = (inserted[table] || []).concat(rows);
                        return chain;
                    };
                }
                if (prop === 'upsert') {
                    return (rows: any) => {
                        inserted[table] = (inserted[table] || []).concat(rows);
                        return chain;
                    };
                }
                if (prop === 'update') {
                    return (patch: any) => {
                        updates.push({ table, patch });
                        return { eq: async () => ({ data: null, error: null }) };
                    };
                }
                if (prop === 'single') {
                    if (options.insertError) return async () => ({ data: null, error: { message: options.insertError } });
                    return async () => ({ data: provider, error: null });
                }
                return () => chain;
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', {
        supabaseUrl: () => 'http://example.invalid',
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
    return { route, inserted, updates, created, announced, logged };
}

const PAYLOAD = {
    provider: {
        business_name: 'Kirkcudbright Joinery',
        trade: 'joiner',
        description: 'Second fix and sash windows.',
        contact_email: 'joiner@example.com',
        callout_fee: 45,
    },
    areas: [{ label: 'Kirkcudbright', centre_lat: 54.8, centre_lng: -4.05, radius_miles: 10 }],
    registrations: [{ scheme: 'gas_safe', number: '123456' }],
    prices: [{ band_key: 'beds_1_2', price: 80, typical_hours: 3 }],
    extras: [{ extra_key: 'linen', offered: true, price: null, notes: null }],
    skills: ['Sash windows'],
};

const LIVE = {
    id: 'app-1',
    email: 'joiner@example.com',
    name: 'Morag Kerr',
    trade: 'joiner',
    business_name: 'Kirkcudbright Joinery',
    contact_phone: '07700 900412',
    payload: PAYLOAD,
    token_sent_at: days(1),
    created_at: days(1),
    claimed_at: null,
    provider_id: null,
};

const call = (body: any) =>
    new Request('http://example.invalid/api/services/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

const GOOD = { token: 'a-token', password: 'a-long-enough-password' };

/* ------------------------------------------------------------ it works */

test('opening the link makes the account and lodges the application', async () => {
    const { route, created, inserted, announced } = load(LIVE);
    const res: any = await route.POST(call(GOOD));

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(created.length, 1);
    assert.equal(inserted.service_providers.length, 1);
    assert.equal(announced.length, 1, 'NOW the directors are told');
});

test('the account is created CONFIRMED, because the link is the proof', async () => {
    const { route, created } = load(LIVE);
    await route.POST(call(GOOD));

    assert.equal(created[0].email, 'joiner@example.com');
    assert.equal(created[0].email_confirm, true,
        'a second confirmation to an address that just received one is theatre');
});

test('the children are written against the new row', async () => {
    const { route, inserted } = load(LIVE);
    await route.POST(call(GOOD));

    assert.equal(inserted.service_areas[0].provider_id, 'prov-new');
    assert.equal(inserted.service_provider_prices[0].provider_id, 'prov-new');
    assert.equal(inserted.service_provider_extras[0].provider_id, 'prov-new');
    assert.equal(inserted.service_provider_registrations[0].provider_id, 'prov-new');
    assert.equal(inserted.service_provider_skills[0].skill_id, 'sk-1');
});

test('the application is marked claimed, so the link is single use', async () => {
    const { route, updates } = load(LIVE);
    await route.POST(call(GOOD));

    const claim = updates.find((u) => u.table === 'service_applications');
    assert.ok(claim, 'the row has to be closed off');
    assert.ok(claim.patch.claimed_at);
    assert.equal(claim.patch.provider_id, 'prov-new');
});

/* --------------------------------------- what an applicant cannot decide */

test('an applicant cannot approve themselves through this route', async () => {
    const { route, inserted } = load({
        ...LIVE,
        payload: { ...PAYLOAD, provider: { ...PAYLOAD.provider, status: 'approved', approved_digest: 'x' } },
    });
    await route.POST(call(GOOD));

    assert.equal(inserted.service_providers[0].status, 'pending_review');
});

test('the owner is the account just made, whatever the payload says', async () => {
    const { route, inserted } = load({
        ...LIVE,
        payload: { ...PAYLOAD, provider: { ...PAYLOAD.provider, owner_id: 'somebody-else' } },
    });
    await route.POST(call(GOOD));

    assert.equal(inserted.service_providers[0].owner_id, 'user-new');
});

test('a registration cannot arrive already verified', async () => {
    const { route, inserted } = load({
        ...LIVE,
        payload: {
            ...PAYLOAD,
            registrations: [{ scheme: 'gas_safe', number: '123456', verified: true, verified_at: '2020-01-01' }],
        },
    });
    await route.POST(call(GOOD));

    const reg = inserted.service_provider_registrations[0];
    assert.equal(reg.verified, undefined);
    assert.equal(reg.verified_at, undefined);
});

test('the trade decides the audience, not the payload', async () => {
    const { route, inserted } = load({
        ...LIVE,
        payload: { ...PAYLOAD, provider: { ...PAYLOAD.provider, audience: 'guest' } },
    });
    await route.POST(call(GOOD));

    assert.notEqual(inserted.service_providers[0].audience, 'guest');
});

/* ------------------------------------------------------------- refusals */

test('an unknown, an expired and a used token all answer identically', async () => {
    const unknown: any = await (async () => { const l = load(null); return l.route.POST(call(GOOD)); })();
    const expired: any = await (async () => {
        const l = load({ ...LIVE, token_sent_at: days(20) });
        return l.route.POST(call(GOOD));
    })();
    const used: any = await (async () => {
        const l = load({ ...LIVE, claimed_at: days(0) });
        return l.route.POST(call(GOOD));
    })();

    for (const res of [unknown, expired, used]) {
        assert.equal(res.status, 400);
        assert.equal(res.body.ok, false);
        assert.equal(res.body.code, 'link_unusable');
    }
    assert.equal(unknown.body.error, expired.body.error);
    assert.equal(expired.body.error, used.body.error);
});

test('a link inside fourteen days still works, one outside does not', async () => {
    const inside = load({ ...LIVE, token_sent_at: days(13) });
    const outside = load({ ...LIVE, token_sent_at: days(15) });

    assert.equal((await inside.route.POST(call(GOOD))).body.ok, true);
    assert.equal((await outside.route.POST(call(GOOD))).body.ok, false);
});

test('no account is made for a token that does not work', async () => {
    const { route, created } = load({ ...LIVE, token_sent_at: days(30) });
    await route.POST(call(GOOD));
    assert.deepEqual(created, []);
});

test('a short password is refused before an account is made', async () => {
    const { route, created } = load(LIVE);
    const res: any = await route.POST(call({ token: 'a-token', password: 'short' }));

    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /8 characters/);
    assert.deepEqual(created, []);
});

/* ----------------------------------------------------- the awkward middle */

test('an address that gained an account meanwhile is told plainly', async () => {
    // No oracle here: they are holding a live link to their own address, so
    // they have already proved it is theirs.
    const { route } = load(LIVE, { createError: 'A user with this email address has already been registered' });
    const res: any = await route.POST(call(GOOD));

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'account_exists');
    assert.match(String(res.body.error), /sign in/i);
});

test('a failed provider insert leaves the row unclaimed rather than lost', async () => {
    // They keep the account, and they stay on the chase list — which is
    // visible and wrong in the harmless direction.
    const { route, updates, logged } = load(LIVE, { insertError: 'connection reset' });
    const res: any = await route.POST(call(GOOD));

    assert.equal(res.status, 500);
    assert.equal(updates.find((u) => u.table === 'service_applications'), undefined);
    assert.ok(logged.some((l) => /service-finish-insert/.test(String(l.message))));
});
