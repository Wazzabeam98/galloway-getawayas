// Finish-time guard — proving /api/services/finish REFUSES to materialise a
// misconfigured slot: a per-person item on a provider with no slot_capacity.
//
//   PORT=3190 npm run dev
//   SITE_URL=<that dev server> node scripts/finish-guard-scenarios.mjs
//   (SITE_URL is chosen and safety-checked by scripts/target.cjs.)
//
// This is the CREATION-side twin of the booking guard proven in
// scripts/slot-item-choice-scenarios.mjs (#4). /finish materialises the
// client-supplied application payload verbatim, so a crafted or malformed
// payload could otherwise write a per-person slot with no capacity — the state
// that sells a shared table as a one-seat private hire. It is intake, not a
// money path (the refusal is long before any account or Stripe), so it lives in
// its own runner rather than the payment scenarios, and needs no connected
// account. It seeds the application row directly (the token hash is sha256 of
// the token, as lib/serviceApplicationToken does) because /apply emails the
// token rather than returning it.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, assertTestEnvironment, supabaseClient, ROOT } from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const SITE = await resolveTarget({ runner: 'scripts/finish-guard-scenarios.mjs', envNames: ['SITE_URL'], fallback: LOCAL_URL });

const DOMAIN = 'gallowayfinishguard.test';
const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const results = [];
let current = null;
function scenario(n, title) { current = { number: n, title, checks: [], status: 'passed' }; results.push(current); console.log('\n── ' + n + '. ' + title); }
function check(desc, cond, detail) { const ok = !!cond; current.checks.push({ desc, ok, detail: detail || null }); if (!ok) current.status = 'failed'; console.log('   ' + (ok ? '✓' : '✗') + ' ' + desc + (detail && !ok ? '  — ' + detail : '')); }

async function finish(token, password) {
    const res = await fetch(SITE + '/api/services/finish', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}

// Seed a service_applications row with a crafted payload and a fresh, unexpired
// token. Returns the plaintext token the finish route expects.
async function seedApplication(email, provider, items) {
    const token = crypto.randomBytes(24).toString('base64url');
    await db.insert('service_applications', {
        email, name: 'Finish Guard', trade: 'guest', business_name: provider.business_name,
        contact_phone: null,
        payload: { provider, items, areas: [], extras: [], prices: [], registrations: [], skills: [], slotAvailability: [], slotBlocks: [] },
        token_hash: hashToken(token), token_sent_at: new Date().toISOString(),
    });
    return token;
}

async function resetSeed() {
    // Applications by the test domain, and any auth users / providers they made.
    await db.remove('service_applications', '?email=like.*@' + DOMAIN);
    const users = await db.auth('GET', '/admin/users?per_page=200');
    const seeded = (users.users || []).filter((u) => (u.email || '').endsWith('@' + DOMAIN));
    if (seeded.length) {
        const ids = '(' + seeded.map((u) => u.id).join(',') + ')';
        const provs = await db.select('service_providers', '?select=id&owner_id=in.' + ids);
        for (const p of provs) for (const t of ['service_provider_items', 'service_areas', 'slot_availability', 'slot_blocks']) await db.remove(t, '?provider_id=eq.' + p.id);
        await db.remove('service_providers', '?owner_id=in.' + ids);
        await db.remove('profiles', '?id=in.' + ids);
        for (const u of seeded) await db.auth('DELETE', '/admin/users/' + u.id);
    }
    console.log('  reset ' + seeded.length + ' user(s), applications cleared');
}

async function main() {
    console.log('project: ' + env.NEXT_PUBLIC_SUPABASE_URL + '\nsite:    ' + SITE + '\n\nseeding…');
    await resetSeed();

    /* ===== 1. the bad state is refused at creation — nothing is made ===== */
    scenario('1', 'A per-person slot item with no capacity is refused at /finish — no account, no provider, no items');
    {
        const email = 'nocap@' + DOMAIN;
        const provider = { business_name: 'No Cap Finish', trade: 'guest', shape: 'slot', custom_label: 'Tastings', contact_email: email };
        const items = [{ name: 'Seat, no seats set', description: 'per person, host set no capacity', price: 40, unit: 'person', active: true, sort_order: 0 }];
        const token = await seedApplication(email, provider, items);
        const r = await finish(token, 'seed-password-nocap');
        check('the finish is refused (400)', r.status === 400, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
        check('the applicant is told a per-person session needs a set number of people', /set number of people|couldn.t create this listing/i.test(r.body.error || ''), r.body.error || '');
        const users = await db.auth('GET', '/admin/users?per_page=200');
        const made = (users.users || []).some((u) => (u.email || '').toLowerCase() === email);
        check('no account was created', !made, made ? 'account exists' : 'none');
        const provs = await db.select('service_providers', '?select=id&business_name=eq.No%20Cap%20Finish');
        check('no provider row was written', provs.length === 0, provs.length + ' provider(s)');
    }

    /* ===== 2. the guard is scoped to missing capacity — a valid slot gets past it ===== */
    scenario('2', 'A per-person slot WITH a capacity is not blocked by the guard (it proceeds past it)');
    {
        // The email already has an account, so once PAST the capacity guard the
        // finish stops at the account-exists gate — proving it cleared the guard
        // without us having to create a real live provider (and its side effects).
        const email = 'hascap@' + DOMAIN;
        await db.auth('POST', '/admin/users', { email, password: 'seed-password-hascap', email_confirm: true, user_metadata: { name: 'Has Cap' } });
        const provider = { business_name: 'Has Cap Finish', trade: 'guest', shape: 'slot', slot_capacity: 8, custom_label: 'Tastings', contact_email: email };
        const items = [{ name: 'Join a tasting', price: 30, unit: 'person', active: true, sort_order: 0 }];
        const token = await seedApplication(email, provider, items);
        const r = await finish(token, 'seed-password-hascap');
        check('it is NOT refused with the capacity error (it got past the guard)', !/set number of people/i.test(r.body.error || ''), 'HTTP ' + r.status + ' ' + (r.body.error || ''));
        check('it stops instead at the account-exists gate (409)', r.status === 409, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
        const provs = await db.select('service_providers', '?select=id&business_name=eq.Has%20Cap%20Finish');
        check('still no provider written (blocked later, not by capacity)', provs.length === 0, provs.length + ' provider(s)');
    }

    const passed = results.filter((r) => r.status === 'passed').length, failed = results.filter((r) => r.status === 'failed').length;
    fs.writeFileSync(path.join(ROOT, 'SCENARIO-RESULTS-FINISH-GUARD.json'), JSON.stringify({ ranAt: new Date().toISOString(), target: SITE, passed, failed, scenarios: results }, null, 2) + '\n');
    console.log('\n' + '='.repeat(60) + '\n  passed ' + passed + '   failed ' + failed + '\n' + '='.repeat(60));
    console.log('\ncleaning up…'); await resetSeed(); console.log('done.');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('\nfinish-guard scenarios failed:', e && (e.stack || e.message)); process.exit(1); });
