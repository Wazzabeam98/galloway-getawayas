// What the four enquiry emails actually contain.
//
// WHY THIS IS THE GAP WORTH CLOSING FIRST
//
// Withholding contact details until somebody accepts is not a feature of this
// flow, it IS the flow — the accept is the only event the platform can charge
// for, and the only thing standing between it and nothing is what these emails
// put in front of people. Every rule about it was enforced by prose in a
// template and nothing else.
//
// A phone number leaking into the wrong message would not fail anything. It
// would send perfectly, look right, and quietly give away the product.
//
// The assertions below are therefore mostly NEGATIVE: not "the email says the
// right thing" but "the email does not contain the thing it must not". That is
// the direction the failure runs in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

const ALERT = '@/lib/serviceEnquiryAlert';

// NOT a reserved TLD. .test, .example, .invalid and .localhost are all
// suppressed by lib/testAddresses, so a fixture on one of those sends nothing
// at all and every assertion below passes vacuously — which is how a test
// written against them would sit green while asserting nothing.
const HOST_PHONE = '07700900123';
const HOST_EMAIL = 'host@example.com';
const PROVIDER_PHONE = '01557555117';
const PROVIDER_EMAIL = 'baxter@example.com';
const TOKEN = 'a-reply-token-value';

const provider = {
    id: 'p-1',
    business_name: 'Baxter Plumbing',
    contact_email: PROVIDER_EMAIL,
    contact_phone: PROVIDER_PHONE,
    sms_opt_out: true,       // the text is covered by tests/sms.test.ts
};

const listing = { id: 'l-1', title: 'Anchorlee', location: 'Gatehouse of Fleet, Dumfries and Galloway' };

function enquiry(over: any = {}) {
    return {
        id: 'e-1',
        reference: 'GG-7K2M',
        trade: 'plumber',
        business_name: 'Baxter Plumbing',
        provider_id: 'p-1',
        listing_id: 'l-1',
        status: 'sent',
        urgency: 'soon',
        summary: 'No hot water since Sunday, combi boiler.',
        fault_keys: ['plumb_no_hot_water'],
        price_snapshot: { callout_fee: 45, hourly_rate: 55 },
        access_note: 'Key safe by the back door',
        host_name: 'Liam Worrall',
        host_phone: HOST_PHONE,
        host_email: HOST_EMAIL,
        expires_at: '2026-09-01T21:20:00Z',
        area_key: 'Gatehouse of Fleet',
        ...over,
    };
}

function load(alertTo = 'one@example.com') {
    const sent: Array<{ to: string; subject: string; html: string }> = [];
    const logged: any[] = [];

    process.env.SERVICES_ALERT_EMAIL = alertTo;

    stubModule('@/lib/supabaseAdmin', {
        adminClient: () => ({
            from: () => ({ update: () => ({ eq: () => ({ eq: async () => ({}) }) }) }),
        }),
    });
    stubModule('@/lib/logError', {
        logError: async (message: string, detail?: any) => { logged.push({ message, detail }); },
    });
    stubModule('@/lib/sms', {
        sendSms: async () => ({ ok: true, sid: 'SM1' }),
        emergencySms: () => 'text body',
        toE164: () => null,
    });
    stubModule('@/lib/email', {
        recipients: (v: string) => String(v || '').split(',').map((a: string) => a.trim()).filter(Boolean),
        sendEmailToAll: async (list: string[], subject: string, html: string) => {
            for (const to of list) sent.push({ to, subject, html });
            return { sent: list, failed: [] };
        },
        sendEmail: async (to: string, subject: string, html: string) => {
            sent.push({ to, subject, html });
            return true;
        },
        emailLayout: (body: string, footnote: string) => body + ' ' + footnote,
        escapeHtml: (s: string) => String(s),
        detailRows: (rows: any[]) => rows.map((r) => r.label + ': ' + r.value).join('\n'),
        button: (url: string, label: string) => '[' + label + '](' + url + ')',
        SITE_URL: 'http://example.invalid',
    });

    const mod = require(ALERT);
    return { mod, sent, logged };
}

const to = (sent: any[], address: string) => sent.filter((e) => e.to === address);
const body = (sent: any[], address: string) => to(sent, address).map((e) => e.html).join('\n');

test.afterEach(() => {
    clearModule('@/lib/email');
    clearModule('@/lib/supabaseAdmin');
    clearModule('@/lib/logError');
    clearModule('@/lib/sms');
    clearModule(ALERT);
});

// --- the enquiry going out --------------------------------------------------

test('the tradesman is asked without being given anything to identify the host', async () => {
    const { mod, sent } = load();
    await mod.announceEnquiry(enquiry(), provider, listing, TOKEN);

    const his = body(sent, PROVIDER_EMAIL);
    assert.ok(his, 'the tradesman was emailed');

    // The whole product. He decides on the job, not on the person, and the
    // details arrive only if he says yes.
    assert.equal(his.indexOf(HOST_PHONE), -1, 'his email must not carry the host phone');
    assert.equal(his.indexOf(HOST_EMAIL), -1, 'his email must not carry the host address');
    assert.equal(his.indexOf('Key safe'), -1, 'his email must not carry the access note');
    assert.equal(his.indexOf('Liam Worrall'), -1, 'his email must not name the host');

    // What he does get: the job, the town, and a way to answer.
    assert.ok(his.indexOf('Gatehouse of Fleet') !== -1, 'he is told where');
    assert.ok(his.indexOf(TOKEN) !== -1, 'he is given a way to answer');
});

test('the host receipt does not carry the tradesman number, or the reply token', async () => {
    const { mod, sent } = load();
    await mod.announceEnquiry(enquiry(), provider, listing, TOKEN);

    const theirs = body(sent, HOST_EMAIL);
    assert.ok(theirs, 'the host was emailed');

    assert.equal(theirs.indexOf(PROVIDER_PHONE), -1, 'no number before an accept');
    assert.equal(theirs.indexOf(PROVIDER_EMAIL), -1, 'no address before an accept');

    // The token is the tradesman's alone. A host holding it could accept on
    // his behalf and hand themselves his number.
    assert.equal(theirs.indexOf(TOKEN), -1, 'the host must never see the reply token');
});

test('both admins get their own copy of an enquiry', async () => {
    const { mod, sent } = load('one@example.com, two@example.com');
    await mod.announceEnquiry(enquiry(), provider, listing, TOKEN);

    assert.equal(to(sent, 'one@example.com').length, 1);
    assert.equal(to(sent, 'two@example.com').length, 1);
});

test('an automated test address is not emailed at all', async () => {
    const { mod, sent } = load();
    const result = await mod.announceEnquiry(
        enquiry(), { ...provider, contact_email: 'e2e@gallowayauto.test' }, listing, TOKEN
    );

    assert.equal(result.skipped, 'automated test address');
    assert.equal(sent.length, 0, 'nothing at all, including the admin copy');
});

// --- the accept, which is the only thing that hands anything over ------------

test('accepting sends the host details to the REGISTERED address, not to the clicker', async () => {
    const { mod, sent } = load();
    await mod.announceResponse(enquiry({ status: 'accepted' }), provider, listing);

    // This is the line the whole forwarded-token defence rests on. Whoever
    // pressed the button in a forwarded email gets nothing; the business we
    // approved gets the details.
    const his = to(sent, PROVIDER_EMAIL);
    assert.equal(his.length, 1, 'exactly one, to the registered address');
    assert.ok(his[0].html.indexOf(HOST_PHONE) !== -1, 'now he gets the number');
    assert.ok(his[0].html.indexOf('Gatehouse of Fleet') !== -1, 'and where to go');
    assert.ok(his[0].html.indexOf('Key safe') !== -1, 'and how to get in');

    const theirs = body(sent, HOST_EMAIL);
    assert.ok(theirs.indexOf(PROVIDER_PHONE) !== -1, 'the host gets his number');
});

test('declining hands over nothing, in either direction', async () => {
    const { mod, sent } = load();
    await mod.announceResponse(
        enquiry({ status: 'declined', decline_reason: 'Booked up until March' }),
        provider, listing
    );

    const theirs = body(sent, HOST_EMAIL);
    assert.equal(theirs.indexOf(PROVIDER_PHONE), -1, 'a no is not an introduction');
    assert.equal(theirs.indexOf(PROVIDER_EMAIL), -1);
    assert.ok(theirs.indexOf('Booked up until March') !== -1, 'but they are told why');

    // Nothing goes to the tradesman on a decline. He said no; that is the end
    // of it for him.
    assert.equal(to(sent, PROVIDER_EMAIL).length, 0);
});

// --- nobody answered --------------------------------------------------------

test('an expiry tells the host to try elsewhere and hands over no number', async () => {
    const { mod, sent } = load();
    await mod.announceExpiry(enquiry({ status: 'viewed' }), listing);

    const theirs = body(sent, HOST_EMAIL);
    assert.ok(theirs.indexOf('opened your enquiry') !== -1, 'viewed is said out loud');
    assert.ok(theirs.indexOf('somebody else') !== -1);

    // There is no automatic release any more. If a number ever appears here
    // again, the accept has stopped being the only route to one.
    assert.equal(theirs.indexOf(PROVIDER_PHONE), -1, 'silence hands over nothing');

    // And he is not chased. Nothing further happens to him.
    assert.equal(to(sent, PROVIDER_EMAIL).length, 0);
});

test('an emergency still waiting promises the host no number and no countdown', async () => {
    const { mod, sent } = load();
    await mod.announceEnquiry(enquiry({ urgency: 'emergency' }), provider, listing, TOKEN);

    const theirs = body(sent, HOST_EMAIL);

    assert.equal(theirs.indexOf(PROVIDER_PHONE), -1, 'no number');
    for (const leak of ['20 minutes', 'their number', 'we will send you']) {
        assert.equal(
            theirs.toLowerCase().indexOf(leak.toLowerCase()), -1,
            'a waiting emergency must not promise "' + leak + '": ' + theirs
        );
    }

    // The tradesman's copy is louder and says what silence costs him, which is
    // a fact about his work rather than an offer to the host.
    const his = body(sent, PROVIDER_EMAIL);
    assert.ok(/emergency/i.test(his));
    assert.ok(/somebody\s+else/i.test(his), 'he is told they will go elsewhere');
});
