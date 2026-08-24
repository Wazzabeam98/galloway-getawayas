// Telling us that a business is waiting.
//
// A decision within 48 hours was promised on the sign-up page, and until this
// route existed the only record of a submission was a database row — so the
// clock ran down unless somebody happened to open /admin/providers.
//
// The address is an environment variable rather than a constant so it can
// change without a deploy, which means "nobody set it" is a live failure mode
// and is tested here like any other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/services/submitted/route';

const OWNER = 'owner-1';
const PROVIDER_ID = 'prov-1';

function load(options: {
    delivered?: boolean;
    alertTo?: string | null;
    status?: string;
    ownerId?: string;
    declinedAt?: string | null;
    areas?: any[];
} = {}) {
    const delivered = options.delivered !== false;
    const sent: any[] = [];
    const logged: any[] = [];

    if (options.alertTo === null) delete process.env.SERVICES_ALERT_EMAIL;
    else process.env.SERVICES_ALERT_EMAIL = options.alertTo || 'support@gallowaygetaways.co.uk';

    const provider = {
        id: PROVIDER_ID,
        owner_id: options.ownerId || OWNER,
        business_name: 'Solway Sparkle',
        trade: 'sponge',
        audience: 'host',
        contact_email: 'hello@solwaysparkle.test',
        contact_phone: null,
        status: options.status || 'pending_review',
        declined_at: options.declinedAt === undefined ? null : options.declinedAt,
    };

    const areas = options.areas === undefined
        ? [{ label: 'Kirkcudbright', radius_miles: 10 }, { label: 'Castle Douglas', radius_miles: 5 }]
        : options.areas;

    function builder(table: string) {
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') {
                    if (table === 'service_providers') return (r: any) => r({ data: provider, error: null });
                    if (table === 'service_areas') return (r: any) => r({ data: areas, error: null });
                    return (r: any) => r({ data: null, error: null });
                }
                return () => chain;
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: (t: string) => builder(t) }) });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: { id: OWNER } } }) },
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
        detailRows: (rows: any[]) => rows.map((r) => r.label + ': ' + r.value).join('\n'),
        button: (url: string, label: string) => '[' + label + '](' + url + ')',
        SITE_URL: 'http://example.invalid',
    });
    stubModule('next/server', {
        NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) },
    });

    clearModule(ROUTE);
    const route = require(ROUTE.replace('@/', '../'));
    return { route, sent, logged };
}

const call = (id?: string) =>
    new Request('http://example.invalid/api/services/submitted', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: id === undefined ? PROVIDER_ID : id }),
    });

test('a submission emails whoever SERVICES_ALERT_EMAIL names', async () => {
    const { route, sent } = load({ alertTo: 'support@gallowaygetaways.co.uk' });
    const res: any = await route.POST(call());

    assert.equal(res.status, 200);
    assert.equal(res.body.emailed, true);
    assert.equal(sent.length, 1, 'somebody has to be told');
    assert.equal(sent[0].to, 'support@gallowaygetaways.co.uk');
});

test('the address comes from the environment, not from the code', async () => {
    const { route, sent } = load({ alertTo: 'somebody.else@example.invalid' });
    await route.POST(call());
    assert.equal(sent[0].to, 'somebody.else@example.invalid',
        'changing the variable has to change where it goes, with no deploy');
});

test('it carries enough to triage without opening the site', async () => {
    const { route, sent } = load();
    await route.POST(call());

    const { subject, html } = sent[0];

    assert.match(subject, /Solway Sparkle/, 'the name is in the subject, for a phone');
    assert.match(html, /Category: Cleaning/, 'the trade, in words');
    assert.match(html, /Sells to: owners/);
    assert.match(html, /Kirkcudbright \+ 10 miles/, 'coverage, with the radius');
    assert.match(html, /Castle Douglas \+ 5 miles/, 'every area, not just the first');
    assert.match(html, /hello@solwaysparkle\.test/, 'how to reach them');
    assert.match(html, /\[Open the queue\]\(http:\/\/example\.invalid\/admin\/providers\)/,
        'a link straight to the queue');
    assert.match(html, /48 hours/, 'what was promised');
});

test('covering nowhere says so rather than leaving a gap', async () => {
    const { route, sent } = load({ areas: [] });
    await route.POST(call());
    assert.match(sent[0].html, /Covers: .*nowhere/);
});

// The question Liam asked: a re-submission after a decline is a new
// submission. declined_at survives the re-send, so a waiting row that carries
// one has been round before — and that is worth saying, because it is a
// different job to triage.
test('a re-submission after a decline is announced, and says it has been back', async () => {
    const { route, sent } = load({ declinedAt: '2026-08-24T05:27:50.000Z' });
    await route.POST(call());

    assert.equal(sent.length, 1, 'somebody who fixed what was asked is still waiting on a decision');
    assert.match(sent[0].subject, /Sent back for review/,
        'it should not read as a brand new application');
    assert.match(sent[0].html, /changed what you asked about/);
});

test('a first submission does not claim to have been back', async () => {
    const { route, sent } = load({ declinedAt: null });
    await route.POST(call());

    assert.match(sent[0].subject, /New business waiting/);
    assert.doesNotMatch(sent[0].html, /changed what you asked about/);
});

// The failures that must not be silent.

test('a send that did not happen is reported and logged', async () => {
    const { route, logged } = load({ delivered: false });
    const res: any = await route.POST(call());

    assert.equal(res.body.emailed, false);
    assert.equal(logged.length, 1);
    assert.match(logged[0].message, /service-provider-submitted-email/);
});

test('an unset SERVICES_ALERT_EMAIL is logged rather than shrugged off', async () => {
    const { route, sent, logged } = load({ alertTo: null });
    const res: any = await route.POST(call());

    assert.equal(sent.length, 0, 'there is nowhere to send it');
    assert.equal(res.body.emailed, false);
    assert.equal(logged.length, 1, 'a missing address is the whole failure this route exists to avoid');
    assert.match(String(logged[0].detail.problem), /SERVICES_ALERT_EMAIL/);
});

// Guards.

test('a draft that was only saved does not ring the bell', async () => {
    const { route, sent } = load({ status: 'draft' });
    const res: any = await route.POST(call());

    assert.equal(sent.length, 0, 'nothing is waiting on us');
    assert.equal(res.body.emailed, false);
});

test('somebody else’s application cannot be announced', async () => {
    const { route, sent } = load({ ownerId: 'someone-else' });
    const res: any = await route.POST(call());

    assert.equal(res.status, 403);
    assert.equal(sent.length, 0);
});
