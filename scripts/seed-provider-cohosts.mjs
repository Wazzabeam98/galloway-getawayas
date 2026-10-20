// Two co-host accounts for walking a business (an experience or a trade) as
// somebody who is NOT the owner. They are only accounts: the grant itself is
// made the real way — the owner invites from /services/dashboard/people and the
// co-host accepts from the banner — so a walk proves the invite flow too.
//
//   node scripts/seed-provider-cohosts.mjs           # create/refresh the accounts, print sign-in links
//   node scripts/seed-provider-cohosts.mjs --reset   # remove their grants and the accounts
//   SITE=<local dev server> node scripts/seed-provider-cohosts.mjs   # links for that site
//
// Owns @gallowaycohost.test and nothing else (CLAUDE.md: one domain per seed).
// TEST PROJECT ONLY — seed-lib refuses any other database.

import { loadEnv, assertTestEnvironment, supabaseClient } from './seed-lib.mjs';
import { LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const reset = process.argv.includes('--reset');
const SITE = process.env.SITE || LOCAL_URL; // only for the printed sign-in links

const DOMAIN = 'gallowaycohost.test';
const PW = 'cohost-seed-2026';
const PEOPLE = [
    { email: 'cohost-full@' + DOMAIN, first: 'Jamie', last: 'Fairley' },
    { email: 'cohost-cal@' + DOMAIN, first: 'Rowan', last: 'Kerr' },
];
// The owners whose businesses the walk invites them to (other seeds' accounts —
// signed in only, never changed here).
const OWNERS = ['seed-sauna@gallowayexp.test', 'seed-plumber@gallowaytrade.test'];

async function findUser(email) {
    for (let page = 1; page <= 10; page++) {
        const res = await db.auth('GET', '/admin/users?per_page=200&page=' + page);
        const users = (res && res.users) || [];
        const hit = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
        if (hit) return hit;
        if (users.length < 200) return null;
    }
    return null;
}

async function signInLink(email, next) {
    const r = await db.auth('POST', '/admin/generate_link', { type: 'magiclink', email });
    const token = r && (r.hashed_token || (r.properties && r.properties.hashed_token));
    return token ? SITE + '/auth/callback?type=magiclink&next=' + encodeURIComponent(next) + '&token_hash=' + encodeURIComponent(token) : '(no link)';
}

async function main() {
    for (const p of PEOPLE) {
        const u = await findUser(p.email);
        if (reset) {
            if (u) {
                await db.remove('provider_access', '?user_id=eq.' + u.id).catch(() => {});
                await db.remove('provider_access', '?email=eq.' + encodeURIComponent(p.email)).catch(() => {});
                await db.remove('service_providers', '?owner_id=eq.' + u.id + '&status=eq.draft').catch(() => {});
                await db.remove('profiles', '?id=eq.' + u.id).catch(() => {});
                await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
            }
            continue;
        }
        let id = u && u.id;
        if (!id) {
            const made = await db.auth('POST', '/admin/users', { email: p.email, password: PW, email_confirm: true });
            id = made.id;
        }
        const profile = { first_name: p.first, last_name: p.last, full_name: p.first + ' ' + p.last, email: p.email };
        await db.insert('profiles', [{ id, ...profile }])
            .catch(async () => { await db.update('profiles', '?id=eq.' + id, profile).catch(() => {}); });
    }
    if (reset) { console.log('Removed the co-host accounts and their grants.'); return; }

    console.log('\n  Co-host accounts (password ' + PW + '):');
    for (const p of PEOPLE) console.log('    ' + p.email + '\n      ' + (await signInLink(p.email, '/services/dashboard')));
    console.log('\n  Owners:');
    for (const o of OWNERS) console.log('    ' + o + '\n      ' + (await signInLink(o, '/services/dashboard/people')));
    console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
