// Account deactivation (reversible) — the invariants that must not quietly
// regress, checked statically so they hold on the web-editor paste path too.
//
// The dangerous mistakes this pins:
//   * reactivation becoming self-serve (a suspended user reviving their own
//     account) — reactivate_account must stay service_role-only;
//   * the deactivation tombstones becoming browser-readable or browser-writable;
//   * the route hiding/suspending the account BEFORE the money is resolved, or
//     skipping the block that protects other people's live reservations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MIGRATION = 'supabase/migrations/20261002091040_deactivate_and_reactivate_account_reversibly.sql';

test('the migration defines all four routines', () => {
    const sql = read(MIGRATION);
    for (const fn of [
        'function public.account_deactivation_blockers(target uuid)',
        'function public.admin_deactivate_account(target uuid)',
        'function public.deactivate_own_account()',
        'function public.reactivate_account(target uuid)',
    ]) {
        assert.ok(sql.includes('create or replace ' + fn), 'missing: ' + fn);
    }
});

test('reactivation is NOT self-serve — reactivate_account is service_role only', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /grant execute on function public\.reactivate_account\(uuid\) to service_role;/,
        'reactivate_account must be granted to service_role');
    // It must never be reachable by the browser roles: a suspended login could
    // otherwise revive itself, which defeats the whole "request to us" design.
    assert.doesNotMatch(sql, /grant execute on function public\.reactivate_account\(uuid\) to [^;]*\b(authenticated|anon)\b/,
        'reactivate_account must NOT be granted to authenticated/anon');
});

test('self-serve deactivation is available to a signed-in user', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /grant execute on function public\.deactivate_own_account\(\) to authenticated/,
        'deactivate_own_account must be callable by the signed-in user');
});

test('the blocker set can only be asked about YOUR OWN account from the browser', () => {
    const sql = read(MIGRATION);
    // The caller-supplied-id form is SECURITY DEFINER, so granting it to
    // `authenticated` would let any signed-in person pass someone else's id and
    // learn their listings, reservation counts, and that they are away from home
    // (mid-stay) until a date. It must stay server-only; the browser asks about
    // its own account through the no-arg wrapper, where auth.uid() is the identity
    // and there is no argument to spoof.
    assert.doesNotMatch(sql, /grant execute on function public\.account_deactivation_blockers\(uuid\) to [^;]*\b(authenticated|anon)\b/,
        'account_deactivation_blockers(uuid) must NOT be granted to authenticated/anon — it takes a caller-supplied id');
    assert.match(sql, /grant execute on function public\.account_deactivation_blockers\(uuid\) to service_role;/,
        'account_deactivation_blockers(uuid) stays the server/admin path');
    assert.match(sql, /create or replace function public\.my_account_deactivation_blockers\(\)/,
        'the self-only no-arg wrapper must exist');
    assert.match(sql, /grant execute on function public\.my_account_deactivation_blockers\(\) to authenticated/,
        'the wrapper is what the browser calls');
    // The wrapper must scope to the caller, not an argument.
    const wrapper = sql.slice(sql.indexOf('function public.my_account_deactivation_blockers'));
    assert.match(wrapper.slice(0, 400), /account_deactivation_blockers\(auth\.uid\(\)\)/,
        'the wrapper must call the blocker set with auth.uid(), never a passed-in id');
});

test('the deactivation worker checks blockers BEFORE it changes anything, and suspends the login', () => {
    const sql = read(MIGRATION);
    const worker = sql.slice(sql.indexOf('function public.admin_deactivate_account'));
    const blockerCheck = worker.indexOf('account_deactivation_blockers(uid)');
    const firstUpdate = worker.indexOf('update public.profiles set deactivated_at');
    assert.ok(blockerCheck > -1 && firstUpdate > -1, 'expected both the block check and the profile update');
    assert.ok(blockerCheck < firstUpdate, 'the block check must run before any row is changed');
    assert.match(worker, /banned_until = now\(\) \+ interval '100 years'/, 'the login must be suspended');
});

test('the tombstone columns are never granted to the browser roles', () => {
    const sql = read(MIGRATION);
    // No select/insert/update grant of deactivated_at to anon or authenticated.
    assert.doesNotMatch(sql, /grant[^;]*\(deactivated_at\)[^;]*to[^;]*\b(anon|authenticated)\b/i,
        'deactivated_at must stay server-only — no browser grant');
});

test('the deactivate route blocks before moving money, and moves money before suspending', () => {
    const src = read('app/api/account/deactivate/route.ts');
    const block = src.indexOf('deactivationBlockers');
    const cancelTrips = src.indexOf('cancelOwnUpcomingTrips');
    const stopSubs = src.indexOf('cancelProviderSubscription');
    const rpc = src.indexOf("rpc('deactivate_own_account')");
    assert.ok(block > -1 && cancelTrips > -1 && stopSubs > -1 && rpc > -1, 'expected all four steps present');
    // Order: block → cancel trips (money) → stop subscription (money) → suspend.
    assert.ok(block < cancelTrips, 'must check the block before cancelling any trip');
    assert.ok(cancelTrips < rpc, 'money (trip refunds) must move before the account is suspended');
    assert.ok(stopSubs < rpc, 'the subscription must be stopped before the account is suspended');
    // A 409 with the per-listing blockers is what the UI renders.
    assert.match(src, /status:\s*409/, 'blocked deactivation must answer 409 with the blockers');
});

test('cancelProviderSubscription is a no-op (not an error) when there is no subscription', async () => {
    // Pure path: a commission provider or a trade still in its free trial has no
    // subscription id, so nothing is sent to Stripe and that is success.
    const { cancelProviderSubscription } = require('@/lib/cancelSubscription');
    for (const empty of [null, undefined, '']) {
        const r = await cancelProviderSubscription(empty);
        assert.equal(r.ok, true);
        assert.equal(r.outcome, 'none');
    }
});
