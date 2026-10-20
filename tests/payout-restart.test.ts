// Changing who a payout account is for after Stripe's form was started.
// Christopher (19/10/2026) picked a different business type on /payouts/setup;
// Stripe refused ("does not have the required permissions for the parameter
// 'business_type'"), we logged an error and silently carried on with the old
// type. Now he is told plainly, and can start Stripe's form again as the type
// he wants — only while the old account was never usable.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { mayRestartPayoutAccount, restartMessage, isBusinessType } = require('../lib/payoutRestart');

test('a restart is only offered while the old account was never usable', () => {
    assert.equal(mayRestartPayoutAccount({ details_submitted: false, charges_enabled: false, payouts_enabled: false }), true);
    assert.equal(mayRestartPayoutAccount({ details_submitted: true, charges_enabled: false, payouts_enabled: false }), false);
    assert.equal(mayRestartPayoutAccount({ details_submitted: false, charges_enabled: true, payouts_enabled: false }), false);
    assert.equal(mayRestartPayoutAccount({ details_submitted: false, charges_enabled: false, payouts_enabled: true }), false);
    assert.equal(mayRestartPayoutAccount(null), false);
    assert.equal(isBusinessType('company'), true);
    assert.equal(isBusinessType('estate'), false);
});

test('the message says what happened and what to do, in plain words', () => {
    const m = restartMessage('individual', 'company', true);
    assert.match(m, /as an individual/);
    assert.match(m, /start Stripe’s form again/);
    assert.match(m, /Nothing on Galloway Getaways changes/);
    assert.match(restartMessage('individual', 'company', false), /contact us/);
});

test('the route asks before restarting, restarts only on yes, and changes only the account pointer', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/api/stripe/connect/route.ts'), 'utf8');
    assert.match(src, /if \(action !== 'restart' \|\| !canRestart\)/, 'never without the host saying so');
    assert.match(src, /needsRestart: canRestart/);
    assert.match(src, /\.eq\('stripe_account_id', accountId\)/, 'swaps only the account it read');
    assert.doesNotMatch(src, /could not change business_type on an unfinished account/, 'no longer reported as an error');
    const block = src.slice(src.indexOf('const fresh = await createPayoutAccount'), src.indexOf('accountId = fresh.id;'));
    assert.doesNotMatch(block, /from\('(listings|bookings|payments|payouts)'\)/, 'nothing else on our side is touched');
    const page = fs.readFileSync(path.join(ROOT, 'app/payouts/setup/page.tsx'), 'utf8');
    assert.match(page, /start\('restart'\)/);
});

/* ---------------- the route, with Stripe and the database stood in for ---------------- */

import { installAliases, stubModule, clearModule } from './helpers/stub';

function harness(account: any) {
    installAliases();
    const calls: string[] = [];
    const updates: any[] = [];
    let profile: any = { stripe_account_id: 'acct_old', full_name: 'Christopher', stripe_payouts_enabled: false, stripe_details_submitted: false };
    stubModule('@supabase/auth-helpers-nextjs', { createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'c@example.com' } } }) } }) });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('next/server', { NextResponse: { json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }) } });
    stubModule('@/lib/logError', { logError: async () => {}, logInfo: async (m: string) => { calls.push('info:' + m); } });
    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: () => {
        const b: any = { _patch: null,
            select: () => b, eq: () => b,
            maybeSingle: async () => ({ data: profile }),
            update: (p: any) => { b._patch = p; return b; },
            then: (res: any) => { if (b._patch) { updates.push(b._patch); profile = { ...profile, ...b._patch }; } res({ data: null, error: null }); },
        };
        return b;
    } }) });
    stubModule('@/lib/stripe', { stripeRequest: async (method: string, p: string, body?: any) => {
        calls.push(method + ' ' + p + (body && body.business_type ? ' ' + body.business_type : ''));
        if (method === 'GET' && p === '/accounts/acct_old') return account;
        if (method === 'POST' && p === '/accounts/acct_old') { const e: any = new Error("This application does not have the required permissions for the parameter 'business_type'"); throw e; }
        if (method === 'POST' && p === '/accounts') return { id: 'acct_new' };
        if (method === 'POST' && p === '/account_links') return { url: 'https://connect.stripe.test/onboard/' + body.account };
        throw new Error('unexpected ' + method + ' ' + p);
    } });
    clearModule('@/app/api/stripe/connect/route');
    const route = require('../app/api/stripe/connect/route');
    const post = (body: any) => route.POST(new Request('http://x/api/stripe/connect', { method: 'POST', body: JSON.stringify(body) }));
    return { post, calls, updates, getProfile: () => profile };
}

test('refused by Stripe: a clear message, nothing changed, until they say start again', async () => {
    const h = harness({ id: 'acct_old', business_type: 'individual', details_submitted: false, charges_enabled: false, payouts_enabled: false });
    const first = await h.post({ action: 'onboard', businessType: 'company' });
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, false);
    assert.equal(first.body.needsRestart, true);
    assert.match(first.body.message, /as an individual/);
    assert.equal(h.updates.length, 0, 'nothing changed yet');
    assert.ok(!h.calls.includes('POST /accounts company'), 'no new account without a yes');

    const second = await h.post({ action: 'restart', businessType: 'company' });
    assert.equal(second.body.ok, true);
    assert.equal(second.body.url, 'https://connect.stripe.test/onboard/acct_new', 'straight into Stripe, on the new account');
    assert.ok(h.calls.includes('POST /accounts company'), 'a fresh account, as a company');
    assert.equal(h.getProfile().stripe_account_id, 'acct_new');
    assert.deepEqual(Object.keys(h.updates[0]).sort(), ['stripe_account_id', 'stripe_charges_enabled', 'stripe_details_submitted', 'stripe_payouts_enabled', 'stripe_requirements_due', 'stripe_updated_at'], 'only the payout-account fields on our side');
});

test('an account that was ever usable is never replaced', async () => {
    const h = harness({ id: 'acct_old', business_type: 'individual', details_submitted: false, charges_enabled: true, payouts_enabled: false });
    const r = await h.post({ action: 'restart', businessType: 'company' });
    assert.equal(r.body.ok, false);
    assert.equal(r.body.needsRestart, false);
    assert.match(r.body.message, /contact us/);
    assert.equal(h.updates.length, 0);
});

test('same type as before: straight to Stripe, nothing asked', async () => {
    const h = harness({ id: 'acct_old', business_type: 'company', details_submitted: false, charges_enabled: false, payouts_enabled: false });
    const r = await h.post({ action: 'onboard', businessType: 'company' });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.url, 'https://connect.stripe.test/onboard/acct_old');
});
