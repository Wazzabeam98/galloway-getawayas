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

const { TRADES, requiredSchemes, planForTrade } = require('@/lib/serviceProviders');

const ADMIN_ID = 'admin-1';
const PROVIDER_ID = 'prov-1';

// `delivered` is what the stubbed sendEmail hands back — true for a send that
// reached Resend, false for the preview environment with no API key.
function load(options: {
    delivered?: boolean;
    isAdmin?: boolean;
    status?: string;
    approvedDigest?: string | null;
    changesPendingAt?: string | null;
    trade?: string;
    doesGas?: boolean;
    doesOil?: boolean;
    registrations?: any[];
    trialEndsAt?: string | null;
    kind?: string;
    pricingChoice?: string | null;
    bandPrices?: any[];
    stripeMcc?: string | null;
    customLabel?: string | null;
} = {}) {
    const delivered = options.delivered !== false;
    const sent: any[] = [];
    const logged: any[] = [];
    const updates: any[] = [];

    const provider = {
        id: PROVIDER_ID,
        business_name: 'Solway Sparkle',
        logo: null,
        contact_email: 'hello@solwaysparkle.test',
        status: options.status || 'pending_review',
        trade: options.trade || 'sponge',
        does_gas: options.doesGas === true,
        does_oil: options.doesOil === true,
        description: 'Changeover cleans for holiday cottages across the Stewartry.',
        audience: 'host',
        photos: ['providers/a.jpg'],
        approved_digest: options.approvedDigest === undefined ? null : options.approvedDigest,
        changes_pending_at: options.changesPendingAt === undefined ? null : options.changesPendingAt,
        trial_ends_at: options.trialEndsAt === undefined ? null : options.trialEndsAt,
        kind: options.kind || 'external',
        pricing_choice: options.pricingChoice === undefined ? null : options.pricingChoice,
        billable_hourly_rate: options.pricingChoice === 'hourly' ? 18 : null,
        covered_bands: options.pricingChoice === 'hourly' ? ['beds_1_2'] : [],
        // A guest provider needs a payout category — a code AND the word guests
        // read — before approval; supplied here so a test about some other gate
        // is not held up by it.
        stripe_mcc: options.stripeMcc === undefined ? null : options.stripeMcc,
        custom_label: options.customLabel === undefined ? null : options.customLabel,
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
                    if (table === 'service_provider_prices') {
                        return (resolve: any) => resolve({ data: options.bandPrices || [], error: null });
                    }
                    if (table === 'service_provider_registrations') {
                        return (resolve: any) => resolve({ data: options.registrations || [], error: null });
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


// ---------------------------------------------------------------------------
// Deciding a live provider's edits.
//
// The rule the whole thing exists for: an edit must never take a live business
// off the site. `status` used to do two jobs, so asking for another look meant
// taking them down, and somebody fixing a typo vanished without knowing why.
// ---------------------------------------------------------------------------

const { reviewDigest } = require('../lib/serviceProviders');

const CHANGED = 'stale-digest-from-before-the-edit';

test('accepting a live provider’s changes leaves them live', async () => {
    const { route, updates } = load({
        status: 'approved', approvedDigest: CHANGED, changesPendingAt: '2026-08-25T09:00:00.000Z',
    });
    const res: any = await route.POST(call('approve_changes'));

    assert.equal(res.status, 200);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].patch.status, undefined,
        'status must not be touched — they were live and they stay live');
    assert.equal(updates[0].patch.changes_pending_at, null, 'and they leave the queue');
});

test('accepting changes moves the digest, so they do not come round again', async () => {
    const { route, updates } = load({
        status: 'approved', approvedDigest: CHANGED, changesPendingAt: '2026-08-25T09:00:00.000Z',
    });
    await route.POST(call('approve_changes'));

    assert.notEqual(updates[0].patch.approved_digest, CHANGED);
    assert.equal(typeof updates[0].patch.approved_digest, 'string');
});

test('turning changes down without hiding leaves the listing up', async () => {
    const { route, updates } = load({
        status: 'approved', approvedDigest: CHANGED, changesPendingAt: '2026-08-25T09:00:00.000Z',
    });
    const res: any = await route.POST(call('decline_changes', 'That is not what we listed you for.'));

    assert.equal(res.status, 200);
    assert.equal(updates[0].patch.status, undefined, 'not hidden unless asked');
    assert.equal(updates[0].patch.review_note, 'That is not what we listed you for.');
});

test('turning changes down with hide takes them off the site', async () => {
    const { route, updates } = load({
        status: 'approved', approvedDigest: CHANGED, changesPendingAt: '2026-08-25T09:00:00.000Z',
    });
    const res: any = await route.POST(
        new Request('http://example.invalid/api/admin/providers', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: PROVIDER_ID, decision: 'decline_changes', note: 'No.', hide: true }),
        })
    );

    assert.equal(res.status, 200);
    assert.equal(updates[0].patch.status, 'hidden');
});

test('turning changes down still needs a reason', async () => {
    const { route, updates } = load({
        status: 'approved', approvedDigest: CHANGED, changesPendingAt: '2026-08-25T09:00:00.000Z',
    });
    const res: any = await route.POST(call('decline_changes'));

    assert.equal(res.status, 400);
    assert.equal(updates.length, 0, 'nothing is written without one');
});

test('a decision has to match the state it was made against', async () => {
    // Approving an application on a row that has since gone live.
    const live = load({ status: 'approved', approvedDigest: CHANGED, changesPendingAt: '2026-08-25T09:00:00.000Z' });
    const a: any = await live.route.POST(call('approve'));
    assert.equal(a.status, 409);
    assert.equal(live.updates.length, 0);

    // Accepting changes on a row that is actually a fresh application.
    const fresh = load({ status: 'pending_review' });
    const b: any = await fresh.route.POST(call('approve_changes'));
    assert.equal(b.status, 409);
    assert.equal(fresh.updates.length, 0);
});

test('there is nothing to accept when no changes are outstanding', async () => {
    const { route, updates } = load({ status: 'approved', approvedDigest: CHANGED, changesPendingAt: null });
    const res: any = await route.POST(call('approve_changes'));

    assert.equal(res.status, 409);
    assert.equal(updates.length, 0);
});

test('approving an application stamps the digest so later edits are noticed', async () => {
    const { route, updates } = load();
    await route.POST(call('approve'));

    assert.equal(updates[0].patch.status, 'approved');
    assert.equal(typeof updates[0].patch.approved_digest, 'string');
    assert.ok(updates[0].patch.approved_digest.length > 0,
        'without this, nothing they change afterwards can ever be detected');
});

test('both changes decisions email the provider', async () => {
    const ok = load({ status: 'approved', approvedDigest: CHANGED, changesPendingAt: '2026-08-25T09:00:00.000Z' });
    await ok.route.POST(call('approve_changes'));
    assert.equal(ok.sent.length, 1, 'we promised to come back to them');
    assert.match(ok.sent[0].html, /stayed on the site/);

    const no = load({ status: 'approved', approvedDigest: CHANGED, changesPendingAt: '2026-08-25T09:00:00.000Z' });
    await no.route.POST(call('decline_changes', 'Not that.'));
    assert.equal(no.sent.length, 1);
    assert.match(no.sent[0].html, /still up/, 'and it says whether they are still up');
});

// ---------------------------------------------------------------------------
// Restricted work does not go live unchecked.
//
// The admin screen disables the Approve button off the same function, but a
// disabled button is a courtesy. This is the control: a stale tab, a second
// click, or a provider who edited their number since the page loaded all
// arrive here, and here is where it has to be refused.
// ---------------------------------------------------------------------------

test('a gas plumber whose number has not been checked cannot be approved', async () => {
    const { route, sent, updates } = load({
        trade: 'plumber',
        doesGas: true,
        registrations: [{ provider_id: PROVIDER_ID, scheme: 'gas_safe', number: '123456' }],
    });

    const res: any = await route.POST(call('approve'));

    assert.equal(res.status, 409);
    assert.match(res.body.error, /not been checked/);
    assert.equal(updates.length, 0, 'nothing is written');
    assert.equal(sent.length, 0, 'and they are not told they are live');
});

test('a gas plumber with no number at all cannot be approved', async () => {
    const { route, updates } = load({ trade: 'plumber', doesGas: true, registrations: [] });

    const res: any = await route.POST(call('approve'));

    assert.equal(res.status, 409);
    assert.match(res.body.error, /Gas Safe/);
    assert.equal(updates.length, 0);
});

test('a checked number lets the approval through', async () => {
    const { route, sent, updates } = load({
        trade: 'plumber',
        doesGas: true,
        registrations: [{
            provider_id: PROVIDER_ID,
            scheme: 'gas_safe',
            number: '123456',
            verified_at: '2026-08-01T00:00:00.000Z',
            verified_number: '123456',
        }],
    });

    const res: any = await route.POST(call('approve'));

    assert.equal(res.status, 200);
    assert.equal(updates[0].patch.status, 'approved');
    assert.equal(sent.length, 1);
});

// The sequence the whole design exists to stop: checked in March, number
// edited in June, still wearing the tick. It is not wearing the tick, because
// "verified" is the two values agreeing rather than a flag on its own.
test('a number edited since it was checked is refused again', async () => {
    const { route, updates } = load({
        trade: 'plumber',
        doesGas: true,
        registrations: [{
            provider_id: PROVIDER_ID,
            scheme: 'gas_safe',
            number: '999999',
            verified_at: '2026-03-01T00:00:00.000Z',
            verified_number: '123456',
        }],
    });

    const res: any = await route.POST(call('approve'));

    assert.equal(res.status, 409);
    assert.match(res.body.error, /not been checked/);
    assert.equal(updates.length, 0);
});

// This named the joiner alone. The rule covers every trade the law does not
// restrict -- the guest trade and every host trade but the electrician -- and a
// single name would have gone on passing if any one of the others had started
// demanding paperwork it does not need. Derived from requiredSchemes so a new
// trade is covered the day it is added.
test('a trade that needs no registration is unaffected', async () => {
    const unregulated = TRADES
        .map((t: any) => t.key)
        .filter((trade: string) => requiredSchemes({ trade, does_gas: false, does_oil: false }).length === 0);

    assert.equal(unregulated.indexOf('electrician'), -1, 'the electrician always needs one');
    assert.equal(unregulated.length > 1, true, 'this is a rule about many trades, not one');

    for (const trade of unregulated) {
        // 'guest' needs no registration either, but it does need a payout
        // category — code and word, a separate gate. Supply both so this test
        // exercises only the registration rule it is about.
        const { route, updates } = load({
            trade, registrations: [],
            stripeMcc: trade === 'guest' ? '7299' : null,
            customLabel: trade === 'guest' ? 'Massage & wellbeing' : null,
        });

        const res: any = await route.POST(call('approve'));

        assert.equal(res.status, 200, trade + ' is approvable with no paperwork');
        assert.equal(updates[0].patch.status, 'approved', trade + ' is written as approved');
    }
});

// ---------------------------------------------------------------------------
// The other two regulated concepts, through the route.
//
// Only Gas Safe was ever exercised here. OFTEC and Part P were covered in the
// lib tests and nowhere else, so the route could have refused to enforce
// either of them and every test would still have passed -- and most of
// Dumfries & Galloway is off the gas grid, which makes oil the commoner case
// of the two, not the exotic one.
// ---------------------------------------------------------------------------

test('an oil plumber whose OFTEC number has not been checked cannot be approved', async () => {
    const { route, sent, updates } = load({
        trade: 'plumber',
        doesOil: true,
        registrations: [{ provider_id: PROVIDER_ID, scheme: 'oftec', number: 'C12345' }],
    });

    const res: any = await route.POST(call('approve'));

    assert.equal(res.status, 409);
    assert.match(res.body.error, /not been checked/);
    assert.equal(updates.length, 0, 'nothing is written');
    assert.equal(sent.length, 0, 'and they are not told they are live');
});

test('an electrician with no competent person scheme cannot be approved', async () => {
    const { route, updates } = load({ trade: 'electrician', registrations: [] });

    const res: any = await route.POST(call('approve'));

    assert.equal(res.status, 409);
    assert.match(res.body.error, /competent person scheme/);
    assert.equal(updates.length, 0);
});

// One rural plumber, two bodies, both required at once. This is the ordinary
// case here rather than the awkward one, and it is the case a single pair of
// columns on the row could never have held.
test('a plumber who does gas and oil is blocked until both are checked', async () => {
    const { route, updates } = load({
        trade: 'plumber',
        doesGas: true,
        doesOil: true,
        registrations: [{
            provider_id: PROVIDER_ID,
            scheme: 'gas_safe',
            number: '123456',
            verified_at: '2026-08-01T00:00:00.000Z',
            verified_number: '123456',
        }],
    });

    const res: any = await route.POST(call('approve'));

    assert.equal(res.status, 409, 'the checked gas number does not carry the oil work');
    assert.match(res.body.error, /OFTEC/);
    assert.equal(updates.length, 0);
});

test('a decline is never blocked by a missing number', async () => {
    // Declining somebody because their paperwork is missing is exactly what
    // the queue is for. Refusing the decline as well would leave no way out.
    const { route, updates } = load({ trade: 'plumber', doesGas: true, registrations: [] });

    const res: any = await route.POST(call('decline', 'We need your Gas Safe number before we can list you.'));

    assert.equal(res.status, 200);
    assert.equal(updates[0].patch.status, 'declined');
});

// ---------------------------------------------------------------------------
// WHAT APPROVAL STAMPS — AND WHAT IT DELIBERATELY DOES NOT
//
// Approval fixes the plan. It does NOT start the free period any more, and the
// tests below are mostly here to keep it that way.
//
// It used to. The reasoning was that approval is where the promise is made,
// which is true and is not the same as where the value arrives: a tradesman
// approved in September who hears nothing until January would have spent his
// whole free period waiting for us to find him work. The clock now starts when
// the first enquiry is sent to him — app/api/services/enquiries/route.ts —
// which is the only place in the codebase that may start one.
//
// The original failure these guard against is unchanged and still worth
// naming: a clock measured somewhere nobody looks, running against somebody
// who was never told. The answer to it is not "stamp it at approval", it is
// "stamp it where somebody is told" — and the enquiry email is now that place.
// ---------------------------------------------------------------------------

test('approving a maintenance trade fixes the plan and starts no clock', async () => {
    const { route, updates } = load({ trade: 'plumber' });

    const res: any = await route.POST(call('approve'));
    assert.equal(res.status, 200);

    const patch = updates[0].patch;
    assert.equal(patch.plan, 'subscription');
    assert.equal(patch.commission_rate, 0, 'no commission on top of a subscription');

    // The whole point of the change. A date here would be a bill for our own
    // silence — he has been approved, not sent any work.
    assert.equal('trial_ends_at' in patch, false,
        'approval fixes what he pays, not when he starts paying it');
});

test('every subscription trade gets the same treatment, not just the plumber', async () => {
    const subscription = TRADES
        .map((t: any) => t.key)
        .filter((trade: string) => planForTrade(trade) === 'subscription');

    // Eight: every host trade but cleaning and waste. Not a list of names --
    // service-providers.test.ts owns the rule, and this only needs to know
    // that it is exercising all of them.
    assert.equal(subscription.length, 8, 'every subscription trade, not a sample');

    for (const trade of subscription) {
        // The electrician needs a checked Part P scheme before anything else
        // is decided, so give it one — this test is about the plan, not the
        // paperwork.
        const registrations = trade === 'electrician'
            ? [{
                provider_id: PROVIDER_ID, scheme: 'part_p_niceic', number: 'N123',
                verified_at: '2026-08-01T00:00:00.000Z', verified_number: 'N123',
            }]
            : [];

        const { route, updates } = load({ trade, registrations });

        const res: any = await route.POST(call('approve'));

        assert.equal(res.status, 200, trade + ' is approvable');
        assert.equal(updates[0].patch.plan, 'subscription', trade + ' is on the subscription');
        assert.equal('trial_ends_at' in updates[0].patch, false, trade + ' starts no clock here');
        assert.equal(updates[0].patch.commission_rate, 0, trade + ' pays no commission');
    }
});

test('approving a commission trade starts no clock at all', async () => {
    const { route, updates } = load({ trade: 'sponge' });

    const res: any = await route.POST(call('approve'));
    assert.equal(res.status, 200);

    const patch = updates[0].patch;
    assert.equal(patch.plan, 'commission');
    assert.equal('trial_ends_at' in patch, false, 'a cleaner is not on a free period');
    assert.equal('commission_rate' in patch, false, 'the rate on their row is left as it is');
});

test('every commission trade is left on commission', async () => {
    const commission = TRADES
        .map((t: any) => t.key)
        .filter((trade: string) => planForTrade(trade) === 'commission');

    assert.equal(commission.length, 3, 'cleaning, waste and the one guest trade');

    for (const trade of commission) {
        // 'guest' needs a payout category before approval; the rest do not.
        const { route, updates } = load({
            trade, registrations: [],
            stripeMcc: trade === 'guest' ? '7299' : null,
            customLabel: trade === 'guest' ? 'Massage & wellbeing' : null,
        });

        const res: any = await route.POST(call('approve'));

        assert.equal(res.status, 200, trade + ' is approvable');
        assert.equal(updates[0].patch.plan, 'commission', trade + ' stays on commission');
        assert.equal('trial_ends_at' in updates[0].patch, false, trade + ' starts no clock');
    }
});

// The one that costs money if it is wrong. A plumber part-way through his free
// period who edits his description and is looked at again must not have the
// date moved — in either direction. Re-approval is silent about the clock now,
// which is a stronger guarantee than the guard this used to rely on.
test('re-approving does not hand out a second free period', async () => {
    const ORIGINAL = '2026-09-01T00:00:00.000Z';
    const { route, updates } = load({ trade: 'plumber', trialEndsAt: ORIGINAL });

    const res: any = await route.POST(call('approve'));
    assert.equal(res.status, 200);

    assert.equal('trial_ends_at' in updates[0].patch, false,
        'the date they were given already is the date that stands');
});

test('approving a change does not touch the plan or the clock', async () => {
    const { route, updates } = load({
        trade: 'plumber',
        status: 'approved',
        approvedDigest: 'business_name=Old',
        changesPendingAt: '2026-08-26T00:00:00.000Z',
        trialEndsAt: '2026-09-01T00:00:00.000Z',
    });

    const res: any = await route.POST(call('approve_changes'));
    assert.equal(res.status, 200);

    const patch = updates[0].patch;
    assert.equal('plan' in patch, false);
    assert.equal('trial_ends_at' in patch, false);
    assert.equal('commission_rate' in patch, false);
});

test('a declined provider is put on no plan and given no date', async () => {
    const { route, updates } = load({ trade: 'plumber' });

    const res: any = await route.POST(call('decline', 'We need more detail on the work you do.'));
    assert.equal(res.status, 200);

    const patch = updates[0].patch;
    assert.equal(patch.status, 'declined');
    assert.equal('plan' in patch, false, 'nothing is agreed with somebody who was turned down');
    assert.equal('trial_ends_at' in patch, false);
});

test('the email tells a subscription trade what it costs, and that it has not started', async () => {
    const { route, sent } = load({ trade: 'plumber' });

    await route.POST(call('approve'));

    assert.equal(sent.length, 1);
    const body = String(sent[0].html || '');

    assert.match(body, /90 days are free/);
    assert.match(body, /£20 a month/);
    assert.match(body, /no commission/);
    assert.match(body, /first enquiry/, 'he is told what actually starts the clock');

    // NO DATE, AND THIS IS THE ASSERTION THAT MATTERS.
    //
    // It used to be the exact opposite: this test demanded a date, because
    // approval stamped one. Nothing stamps one now until his first enquiry
    // goes out, so a date in this email could only have been invented here —
    // and an invented date is the promise-by-accident the whole trial design
    // has been trying to avoid twice over. Matched by shape rather than value
    // because there is no correct value.
    assert.equal(
        /\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/.test(body),
        false,
        'approval has no date to give, so it must not print one'
    );
});

test('the email tells a commission trade the opposite, and no date', async () => {
    const { route, sent } = load({ trade: 'sponge' });

    await route.POST(call('approve'));

    const body = String(sent[0].html || '');

    assert.match(body, /10% of a job/);
    assert.equal(/a month/.test(body), false, 'a cleaner is never told about a subscription');
    assert.equal(/days are free/.test(body), false);
});

// ---------------------------------------------------------------------------
// WHOSE BUSINESS IT IS
//
// `kind` decides whether a cleaner may be paid by the hour and whether
// commission is taken at all. It was previously settable only by editing the
// row in production by hand, which is no check on who did it and no record
// that it happened.
// ---------------------------------------------------------------------------

test('an owner can mark a provider in-house', async () => {
    const { route, updates, sent } = load({ trade: 'sponge', kind: 'external' });

    const res: any = await route.POST(call('make_in_house'));

    assert.equal(res.status, 200);
    assert.equal(updates[0].patch.kind, 'in_house');
    assert.equal(sent.length, 0, 'nothing is emailed -- it says whose business this is, not what they agreed');
});

test('marking in-house does not touch anything else', async () => {
    const { route, updates } = load({ trade: 'sponge', kind: 'external' });

    await route.POST(call('make_in_house'));
    const patch = updates[0].patch;

    assert.equal('status' in patch, false, 'it is not a decision about their application');
    assert.equal('pricing_choice' in patch, false, 'and it does not choose a pricing model for them');
    assert.equal('plan' in patch, false);
});

test('somebody who is not an admin cannot change it', async () => {
    const { route, updates } = load({ trade: 'sponge', isAdmin: false });

    const res: any = await route.POST(call('make_in_house'));

    assert.equal(res.status, 403);
    assert.equal(updates.length, 0);
});

// The case worth getting right rather than discovering.
test('an hourly cleaner with band prices falls back onto them when made external', async () => {
    const { route, updates } = load({
        trade: 'sponge',
        kind: 'in_house',
        pricingChoice: 'hourly',
        bandPrices: [{ band_key: 'beds_1_2', price: 80 }],
    });

    const res: any = await route.POST(call('make_external'));

    assert.equal(res.status, 200);

    const patch = updates[0].patch;
    assert.equal(patch.kind, 'external');
    // One statement, because the check constraint is evaluated against the
    // finished row: moving kind without moving pricing_choice is refused.
    assert.equal(patch.pricing_choice, 'bands');
    assert.equal(patch.billable_hourly_rate, null, 'the rate goes with the permission to charge it');
    assert.deepEqual(patch.covered_bands, [], 'and coverage comes from her prices again');
});

test('an hourly cleaner with no band prices is refused rather than hidden', async () => {
    // Clearing the hourly fields anyway would land her on the banded model
    // with nothing priced -- and a banded provider with no prices covers no
    // size and disappears from every search while looking complete on screen.
    const { route, updates } = load({
        trade: 'sponge',
        kind: 'in_house',
        pricingChoice: 'hourly',
        bandPrices: [],
    });

    const res: any = await route.POST(call('make_external'));

    assert.equal(res.status, 409);
    assert.match(res.body.error, /no prices per house size/);
    assert.equal(updates.length, 0, 'nothing is written at all');
});

test('a band price of zero is not a price to fall back onto', async () => {
    const { route, updates } = load({
        trade: 'sponge',
        kind: 'in_house',
        pricingChoice: 'hourly',
        bandPrices: [{ band_key: 'beds_1_2', price: 0 }],
    });

    const res: any = await route.POST(call('make_external'));

    assert.equal(res.status, 409);
    assert.equal(updates.length, 0);
});

test('a banded cleaner made external needs no fallback and clears nothing', async () => {
    const { route, updates } = load({ trade: 'sponge', kind: 'in_house', pricingChoice: 'bands' });

    const res: any = await route.POST(call('make_external'));

    assert.equal(res.status, 200);
    assert.equal(updates[0].patch.kind, 'external');
    assert.equal('billable_hourly_rate' in updates[0].patch, false,
        'there is nothing hourly to clear, so nothing is written');
});

test('a non-cleaning provider is unaffected by any of it', async () => {
    const { route, updates } = load({ trade: 'plumber', kind: 'in_house' });

    const res: any = await route.POST(call('make_external'));

    assert.equal(res.status, 200);
    assert.equal(updates[0].patch.kind, 'external');
    assert.equal('pricing_choice' in updates[0].patch, false);
});
