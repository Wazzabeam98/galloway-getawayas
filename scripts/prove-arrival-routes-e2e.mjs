// End-to-end prober for the two APP-ROUTE surfaces of the arrival/PII fix:
//   - the arrival "Getting there" page  /arrival/[bookingId]
//   - the trips API                     /api/trips
//
// It sets up a victim (published listing + real arrival secrets: door code,
// wifi password, what3words, exact address), an attacker with NO relationship,
// and a legit guest. The attacker plants an unpaid pending_payment booking; the
// legit guest gets a confirmed one. Both check in tomorrow, so the arrival
// page's 3-day door-code window is open. It then fetches both routes with each
// person's REAL app session cookie and reports exactly which secrets each
// surface returned.
//
// Run the SAME script twice, against the same running dev server, once with the
// PRE-FIX code and once with the FIXED code — the difference is the proof.
//
//   node scripts/prove-arrival-routes-e2e.mjs           (defaults to the local dev server)
//   BASE_URL=... node scripts/prove-arrival-routes-e2e.mjs
//
// The target is resolved through scripts/target.cjs like every other
// site-talking runner — it creates accounts and writes rows, so it must be
// refused against production, the production database, or a stale build.

import { loadEnv, assertTestEnvironment, supabaseClient, sessionCookieViaApp, SEED_DOMAIN } from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);
const SITE = await resolveTarget({
    runner: 'scripts/prove-arrival-routes-e2e.mjs',
    envNames: ['BASE_URL', 'SITE_URL'],
    fallback: LOCAL_URL,
});
const db = supabaseClient(env);
const tag = 'arre2e-' + Date.now();
const PW = 'Test-' + tag + '-pw';

const DOORCODE = 'DOORCODE-' + tag;
const WIFIPW = 'wifisecret-' + tag;
const W3W = '///secret.cottage.' + tag.slice(-4);
const ADDRESS = '1 Secret Lane';
const POSTCODE = 'DG7 9ZZ';

async function makeUser(role) {
    const email = role + '-' + tag + '@' + SEED_DOMAIN;
    const u = await db.auth('POST', '/admin/users', { email, password: PW, email_confirm: true });
    return { id: u.id, email };
}
const upsertProfile = (row) => db.rest('POST', '/profiles', [row], 'return=representation,resolution=merge-duplicates');
const dayStr = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };

async function cleanup() {
    try {
        const ls = await db.select('listings', '?title=like.*' + tag + '*&select=id');
        for (const l of (ls || [])) {
            await db.remove('bookings', '?listing_id=eq.' + l.id).catch(() => {});
            await db.remove('listing_arrival', '?listing_id=eq.' + l.id).catch(() => {});
            await db.remove('listing_access_codes', '?listing_id=eq.' + l.id).catch(() => {});
            await db.remove('listings', '?id=eq.' + l.id).catch(() => {});
        }
        const users = await db.auth('GET', '/admin/users?per_page=500');
        for (const u of (users.users || [])) {
            if (u.email && u.email.includes(tag)) {
                await db.remove('profiles', '?id=eq.' + u.id).catch(() => {});
                await db.auth('DELETE', '/admin/users/' + u.id).catch(() => {});
            }
        }
    } catch (e) { console.log('cleanup note: ' + e.message); }
}

function scan(text, label) {
    const found = {
        doorcode: text.includes(DOORCODE),
        wifi: text.includes(WIFIPW),
        w3w: text.includes(W3W),
        address: text.includes(ADDRESS),
        postcode: text.includes(POSTCODE),
    };
    const hits = Object.entries(found).filter(([, v]) => v).map(([k]) => k);
    console.log('    ' + label + ': ' + (hits.length ? 'EXPOSED ' + hits.join(',') : 'nothing'));
    return found;
}

async function fetchAs(cookie, path) {
    const res = await fetch(SITE + path, { headers: { Cookie: cookie }, redirect: 'manual' });
    const body = res.status >= 300 && res.status < 400 ? '' : await res.text();
    return { status: res.status, location: res.headers.get('location'), body };
}

async function main() {
    console.log('\n=== E2E arrival routes @ ' + SITE + ' ===');
    await cleanup();

    const host = await makeUser('host');
    const attacker = await makeUser('attacker');
    const legit = await makeUser('legit');
    await upsertProfile({ id: host.id, email: host.email, full_name: 'Host ' + tag, phone: '0777' + tag.slice(-4) });
    await upsertProfile({ id: attacker.id, email: attacker.email, full_name: 'Attacker ' + tag });
    await upsertProfile({ id: legit.id, email: legit.email, full_name: 'Legit ' + tag });

    const listing = (await db.insert('listings', [{
        host_id: host.id, title: 'Cottage ' + tag, location: 'Kirkcudbright', price_per_night: 100,
        status: 'published', street_address: ADDRESS, postcode: POSTCODE,
    }]))[0];
    await db.insert('listing_arrival', [{
        listing_id: listing.id, wifi_name: 'CottageWifi', wifi_password: WIFIPW,
        what3words: W3W, arrival_directions: 'Down the track past the gate.',
    }]);
    await db.insert('listing_access_codes', [{ listing_id: listing.id, code: DOORCODE }]);

    // attacker: planted pending_payment; legit: confirmed. Both check in tomorrow.
    const planted = (await db.insert('bookings', [{
        listing_id: listing.id, guest_id: attacker.id, host_id: host.id,
        check_in: dayStr(1), check_out: dayStr(3), total_price: 200, guests: 2, adults: 2,
        status: 'pending_payment',
    }]))[0];
    const confirmed = (await db.insert('bookings', [{
        listing_id: listing.id, guest_id: legit.id, host_id: host.id,
        check_in: dayStr(1), check_out: dayStr(3), total_price: 200, guests: 2, adults: 2,
        status: 'confirmed', payment_status: 'paid', confirmed_at: new Date().toISOString(),
    }]))[0];

    const attackerCookie = await sessionCookieViaApp(env, attacker.email, SITE);
    const legitCookie = await sessionCookieViaApp(env, legit.email, SITE);

    console.log('\n  [ATTACKER] planted pending_payment booking ' + planted.id);
    let r = await fetchAs(attackerCookie, '/api/trips');
    console.log('    /api/trips        HTTP ' + r.status);
    scan(r.body, '/api/trips (attacker)');
    r = await fetchAs(attackerCookie, '/arrival/' + planted.id);
    console.log('    /arrival/[planted] HTTP ' + r.status + (r.location ? ' -> ' + r.location : ''));
    scan(r.body, '/arrival (attacker)');

    console.log('\n  [LEGIT] confirmed booking ' + confirmed.id);
    r = await fetchAs(legitCookie, '/api/trips');
    console.log('    /api/trips        HTTP ' + r.status);
    scan(r.body, '/api/trips (legit)');
    r = await fetchAs(legitCookie, '/arrival/' + confirmed.id);
    console.log('    /arrival/[confirmed] HTTP ' + r.status + (r.location ? ' -> ' + r.location : ''));
    scan(r.body, '/arrival (legit)');

    console.log('\n  --- teardown ---');
    await cleanup();
    console.log('  done.\n');
}

main().then(() => process.exit(0)).catch(async (e) => { console.error('ERROR', e); await cleanup(); process.exit(1); });
