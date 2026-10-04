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
