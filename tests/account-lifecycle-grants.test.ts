// The account-lifecycle functions must not be callable from the browser roles.
//
// `revoke all ... from public` is NOT enough on Supabase: its default privileges
// grant EXECUTE directly to anon and authenticated when a function is created,
// and revoking from PUBLIC leaves those direct grants in place. Until
// 20261004130329 that left admin_deactivate_account, admin_anonymise_account and
// reactivate_account callable with the public site key — anyone could suspend,
// erase or revive any account by id. This holds the explicit revokes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261004130329_reactivate_leaves_listings_down.sql'), 'utf8');

const SERVER_ONLY = [
    'reactivate_account(uuid)',
    'admin_deactivate_account(uuid)',
    'admin_anonymise_account(uuid)',
    'account_deactivation_blockers(uuid)',
];
// What 20261004130329 itself did. The live grants are now held by
// tests/function-grants-guard.test.ts — 20261004133346 later revoked
// my_account_deactivation_blockers from authenticated too (it has no caller).
const SIGNED_IN_ONLY = [
    'deactivate_own_account()',
    'anonymise_own_account()',
    'my_account_deactivation_blockers()',
];

const esc = (s: string) => s.replace(/[()]/g, '\\$&');

test('the admin-only account functions are revoked from anon AND authenticated', () => {
    for (const fn of SERVER_ONLY) {
        assert.match(SQL, new RegExp('revoke execute on function public\\.' + esc(fn) + '\\s+from anon, authenticated;'), fn);
        assert.doesNotMatch(SQL, new RegExp('grant execute on function public\\.' + esc(fn) + '[^;]*\\b(anon|authenticated)\\b'), fn + ' must not be granted to a browser role');
    }
});

test('the own-account functions are revoked from anon and stay with signed-in users', () => {
    for (const fn of SIGNED_IN_ONLY) {
        assert.match(SQL, new RegExp('revoke execute on function public\\.' + esc(fn) + '\\s+from anon;'), fn);
        assert.match(SQL, new RegExp('grant execute on function public\\.' + esc(fn) + '\\s+to authenticated, service_role;'), fn);
    }
});

test('reactivation leaves listings hidden and providers paused, and never lifts an admin take-down', () => {
    const body = SQL.slice(SQL.indexOf('create or replace function public.reactivate_account'), SQL.indexOf('$$;'))
        .split('\n').map((l: string) => l.replace(/--.*$/, '')).join('\n');   // code only, not comments
    assert.doesNotMatch(body, /status = 'published'/, 'listings are not republished');
    assert.match(body, /owner_paused = true/, 'providers come back paused');
    assert.doesNotMatch(body, /admin_hidden_at/, 'an admin take-down is never touched');
});

test('the Reactivate route is admin-only, needs a reason, logs it, and resets trade billing', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/api/admin/account/reactivate/route.ts'), 'utf8');
    assert.match(src, /isAdmin\(user\.id\)/, 'admin checked on the server');
    assert.match(src, /cleanReason\(/, 'a reason is required');
    assert.match(src, /action: 'account_reactivated'/, 'an admin_actions row is written');
    assert.match(src, /reactivationBillingPatches\(/, 'trade billing follows #295');
    // Stamped rows are read BEFORE the RPC clears the stamps.
    assert.ok(src.indexOf(".not('deactivated_at', 'is', null)") < src.indexOf("rpc('reactivate_account'"), 'read before the RPC');
    assert.ok(src.indexOf("rpc('reactivate_account'") < src.indexOf('sendEmail('), 'emailed after the account is back');
});
