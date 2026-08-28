// Talking to the test database from a Playwright test, so an assertion can be
// about what was actually written rather than about what the screen said.
//
// Guarded to the test project the same way every other script here is: an
// invented tradesman must never land in the real queue.

import fs from 'node:fs';
import path from 'node:path';

export const TEST_PROJECT_REF = 'yefoqcabuijcowoqewtc';

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

const E = env();
export const SUPABASE_URL = E.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = E.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_URL.includes(TEST_PROJECT_REF)) {
    throw new Error('refusing to run: .env.local is not pointed at the test project');
}

const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
};

async function api(path: string, init: any = {}) {
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
