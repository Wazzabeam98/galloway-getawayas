// The provider sign-up wizard writes nothing straight from the browser.
//
// Every save — the service_providers row, its child tables, the submit, removing
// a draft — goes through /api/services/signup/save, which checks ownership and
// writes with the service role, the way the listing editor saves. Because the
// service role skips the column grants, the route's own allow-list is the gate,
// so it must never be wider than what a provider could write before: the
// PROVIDER_WRITABLE decision in provider-writable-columns-guard (less owner_id,
// which the route always sets to the caller).
//
// PROVE IT FAILS FIRST: put a `supabase.from('service_areas').insert(...)` back
// in ProviderSignUp.tsx, or add 'status' or 'commission_rate' to ROW_WRITABLE in
// the route, and this goes red.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the wizard makes no direct database write', () => {
    const form = read('components/services/ProviderSignUp.tsx');
    const writes = form.match(/\.(insert|update|upsert|delete|rpc)\(/g) || [];
    assert.deepEqual(writes, [], 'ProviderSignUp.tsx must save through /api/services/signup/save');
    assert.match(form, /\/api\/services\/signup\/save/);
});

test('the route writes only the columns a provider could already write', () => {
    const route = read('app/api/services/signup/save/route.ts');
    const guard = read('tests/provider-writable-columns-guard.test.ts');
    const list = (src: string, name: string) => {
        const m = src.match(new RegExp(name + '\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)'));
        assert.ok(m, name + ' not found');
        return new Set((m![1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')));
    };
    const routeCols = list(route, 'ROW_WRITABLE');
    const decided = list(guard, 'PROVIDER_WRITABLE');
    decided.delete('owner_id');
    for (const c of Array.from(routeCols)) assert.ok(decided.has(c), c + ' is not provider-writable');
    for (const never of ['status', 'submitted_at', 'review_note', 'commission_rate', 'plan', 'owner_id', 'cancellation_window_hours']) {
        assert.ok(!routeCols.has(never), never + ' must not be writable through the sign-up route');
    }
    // The caller is always the owner, and status moves only through the RPC on
    // the caller's own client.
    assert.match(route, /row\.owner_id = user\.id/);
    assert.match(route, /supabase\.rpc\('submit_service_provider'/);
});
