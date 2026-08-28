// Talking to the test database from a Playwright test, so an assertion can be
// about what was actually written rather than about what the screen said.
//
// Guarded to the test project the same way every other script here is: an
// invented tradesman must never land in the real queue.

import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore — CommonJS, shared with the runners and with the guard.
import { TEST_PROJECT_REF } from '../scripts/target.cjs';

export { TEST_PROJECT_REF };

function env(): Record<string, string> {
    const file = path.resolve(__dirname, '..', '.env.local');
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || !t.includes('=')) continue;
        const i = t.indexOf('=');
        out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
    return out;
}

// Read on first use, not on import.
//
// This used to run at module scope and throw when .env.local was missing or
// pointed anywhere but the test project. The guard is right; doing it on import
// was not. It made the whole spec file unloadable without a local env file, so
// `playwright test --list` — the cheapest possible check that the suite can
// still start — could not run anywhere the file was absent, CI included.
//
// Deferring changes nothing about safety: every call goes through api(), and
// api() reads this first. The refusal still happens before any request.
let cached: { url: string; key: string } | null = null;

function credentials(): { url: string; key: string } {
    if (cached) return cached;

    const E = env();
    const url = E.NEXT_PUBLIC_SUPABASE_URL;
    const key = E.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !url.includes(TEST_PROJECT_REF)) {
        throw new Error('refusing to run: .env.local is not pointed at the test project');
    }

    cached = { url, key };
    return cached;
}

/** Kept as a getter so importing this file still does not touch the disk. */
export function supabaseUrl(): string {
    return credentials().url;
}

async function api(path: string, init: any = {}) {
    const { url: SUPABASE_URL, key: SERVICE_KEY } = credentials();
    const headers = {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
    };
    const res = await fetch(SUPABASE_URL + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; }
    catch { return { status: res.status, body: text }; }
}

export async function findUser(email: string) {
    const { body } = await api('/auth/v1/admin/users?per_page=200');
    return (body.users || []).find((u: any) => (u.email || '').toLowerCase() === email.toLowerCase());
}

export async function providersOwnedBy(userId: string) {
    const { body } = await api(`/rest/v1/service_providers?owner_id=eq.${userId}&select=id,business_name,trade,status,submitted_at`);
    return Array.isArray(body) ? body : [];
}

export async function areasFor(providerId: string) {
    const { body } = await api(`/rest/v1/service_areas?provider_id=eq.${providerId}&select=label,radius_miles`);
    return Array.isArray(body) ? body : [];
}

/** Remove an applicant and everything they own. Safe to call when absent. */
export async function removeApplicant(email: string) {
    const user = await findUser(email);
    if (!user) return;
    for (const p of await providersOwnedBy(user.id)) {
        await api(`/rest/v1/service_areas?provider_id=eq.${p.id}`, { method: 'DELETE' });
        await api(`/rest/v1/service_provider_prices?provider_id=eq.${p.id}`, { method: 'DELETE' });
        await api(`/rest/v1/service_provider_extras?provider_id=eq.${p.id}`, { method: 'DELETE' });
        await api(`/rest/v1/service_provider_registrations?provider_id=eq.${p.id}`, { method: 'DELETE' });
        await api(`/rest/v1/service_provider_skills?provider_id=eq.${p.id}`, { method: 'DELETE' });
        await api(`/rest/v1/service_providers?id=eq.${p.id}`, { method: 'DELETE' });
    }
    await api(`/rest/v1/profiles?id=eq.${user.id}`, { method: 'DELETE' });
    await api(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
}
