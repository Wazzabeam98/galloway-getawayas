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
const ALERT = '@/lib/serviceSubmittedAlert';

const OWNER = 'owner-1';
const PROVIDER_ID = 'prov-1';

function load(options: {
    delivered?: boolean;
    alertTo?: string | null;
    status?: string;
    ownerId?: string;
    contactEmail?: string;
    declinedAt?: string | null;
    areas?: any[];
    approvedDigest?: string | null;
    registrations?: any[];
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
        logo: null,
        // A real-looking domain on purpose. `.test` is reserved, and
        // announceSubmission now reads it as an automated run and sends
        // nothing — so a fixture sitting on one would make every assertion
        // below pass for the wrong reason, or fail for one. The suppression
        // has its own tests at the bottom of this file.
        contact_email: options.contactEmail || 'hello@solwaysparkle.co.uk',
        contact_phone: null,
        trade: 'sponge',
        audience: 'host',
        does_gas: false,
        does_oil: false,
        status: options.status || 'pending_review',
        declined_at: options.declinedAt === undefined ? null : options.declinedAt,
        description: 'Changeover cleans for holiday cottages across the Stewartry.',
        photos: ['providers/a.jpg'],
        approved_digest: options.approvedDigest === undefined ? null : options.approvedDigest,
        changes_pending_at: null,
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
                    if (table === 'service_provider_registrations') {
                        return (r: any) => r({ data: options.registrations || [], error: null });
                    }
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
        // Additive: the callers moved to the comma-splitting pair so that a
        // second admin address reaches a second person. It pushes into the same
        // array as sendEmail, so every existing assertion about `to` still
        // holds and a two-address run simply produces two entries.
        recipients: (value: string) =>
            String(value || '').split(',').map((a: string) => a.trim()).filter(Boolean),
        sendEmailToAll: async (list: string[], subject: string, html: string) => {
            const ok: string[] = [];
            const bad: string[] = [];
            for (const address of list) {
                sent.push({ to: address, subject, html });
                if (delivered) ok.push(address); else bad.push(address);
            }
            return { sent: ok, failed: bad };
        },
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

    // The alert itself lives in a lib now, shared with /api/services/apply,
    // which has no session to authenticate and so cannot come through the
    // route above. It caches the modules stubbed here at first require, so it
    // has to be cleared alongside the route or the second load in this file
    // would quietly keep the first one's stubs.
    clearModule(ALERT);
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
    assert.match(html, /hello@solwaysparkle\.co\.uk/, 'how to reach them');
    assert.match(html, /\[Review application\]\(http:\/\/example\.invalid\/admin\/providers\)/,
        'the button says what he is about to do, not the name of a page');
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


// ---------------------------------------------------------------------------
// A live provider editing their shop window.
//
// Not the same job as an application: they are on the site either way, so it
// is never urgent in the way a waiting business is — but it is still a job,
// and nothing announced it before.
// ---------------------------------------------------------------------------

const STALE = 'business_name=Solway Sparkle|trade=sponge|description=Something else entirely.|audience=host|photos=providers/a.jpg';

test('a live provider changing their description is announced', async () => {
    const { route, sent } = load({ status: 'approved', approvedDigest: STALE });
    const res: any = await route.POST(call());

    assert.equal(res.body.emailed, true);
    assert.equal(sent.length, 1, 'nothing announced this before');
    assert.match(sent[0].subject, /Changes to look at/);
});

test('the alert names what changed, so it can be triaged from a phone', async () => {
    const { route, sent } = load({ status: 'approved', approvedDigest: STALE });
    await route.POST(call());

    assert.match(sent[0].html, /has changed description/,
        '"something changed" sends you to the site to find out; naming it does not');
    assert.match(sent[0].html, /stayed on the site/, 'and says they did not vanish');
    assert.match(sent[0].html, /\[Review the changes\]/);
});

test('a live provider who changed nothing reviewable is not announced', async () => {
    // approved_digest matches the row exactly — a contact detail or a coverage
    // area moved, and neither is anybody's business but theirs.
    const { route, sent } = load({
        status: 'approved',
        approvedDigest: 'business_name=Solway Sparkle|trade=sponge|description=Changeover cleans for holiday cottages across the Stewartry.|audience=host|photos=providers/a.jpg',
    });
    const res: any = await route.POST(call());

    assert.equal(sent.length, 0, 'this is the case that must stay quiet');
    assert.equal(res.body.emailed, false);
    assert.equal(res.body.skipped, 'nothing to look at');
});

test('a live provider approved before the digest existed is not announced', async () => {
    const { route, sent } = load({ status: 'approved', approvedDigest: null });
    await route.POST(call());
    assert.equal(sent.length, 0, 'no baseline means no way to tell, and flagging everything is noise');
});

test('a changes alert that did not send is logged as such', async () => {
    const { route, logged } = load({ status: 'approved', approvedDigest: STALE, delivered: false });
    await route.POST(call());

    assert.equal(logged.length, 1);
    assert.equal(logged[0].detail.kind, 'changes');
});

// ---------------------------------------------------------------------------
// Automated runs do not ring the bell.
//
// scripts/journeys.mjs and the Playwright suite both lodge real applications,
// and every one of them used to send a real "New business waiting" email to the
// services inbox. An alert that mostly fires for nobody is an alert that stops
// being read, which costs exactly the thing this route was built to protect:
// noticing the one application that is real.
//
// The suppression is on the address, not on an environment variable, so it
// cannot be got wrong per deployment and cannot swallow a genuine application —
// see lib/testAddresses.ts.
// ---------------------------------------------------------------------------

test('an application from a reserved test domain sends no alert', async () => {
    const { route, sent } = load({ contactEmail: 'e2e-joiner@gallowayauto.test' });
    const res: any = await route.POST(call());

    assert.equal(res.status, 200, 'the submission still succeeds');
    assert.equal(sent.length, 0, 'but nobody is emailed about a robot');
});

test('the suppression is reported, not silent', async () => {
    // The difference that matters: a skipped alert and a broken send must not
    // look the same from the outside. This is what lets the e2e suite assert
    // the stub is working rather than assume it.
    const { route, logged } = load({ contactEmail: 'e2e-joiner@gallowayauto.test' });
    const res: any = await route.POST(call());

    assert.equal(res.body.emailed, false);
    assert.equal(res.body.skipped, 'automated test address');
    assert.equal(logged.length, 0, 'a test account is not an error worth logging');
});

test('a real address on an ordinary domain is still announced', async () => {
    // The guard rail on the guard rail. A rule that suppresses too much is a
    // worse bug than the noise it was written to stop, so the ordinary path is
    // asserted right beside it.
    const { route, sent } = load({ contactEmail: 'jobs@solwaysparkle.co.uk' });
    await route.POST(call());
    assert.equal(sent.length, 1, 'a person applying is still worth an email');
});
