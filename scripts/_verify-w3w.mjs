// Load the trip card and arrival page AS liamworrall18@hotmail.com (a real
// authenticated session, minted passwordless via the admin magic-link + the
// app's own /auth/callback) and check what3words actually appears in the
// server-rendered HTML. TEST ONLY.
import { loadEnv, assertTestEnvironment, sessionCookieViaApp } from './seed-lib.mjs';
import { LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);

const SITE = process.env.SITE || LOCAL_URL;
const ME = 'liamworrall18@hotmail.com';
const W3W = '///daisy.harbour.lantern';
const BOOKING = process.argv[2]; // arrival page booking id

async function get(path, cookie) {
    const res = await fetch(SITE + path, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
    const body = await res.text();
    return { status: res.status, location: res.headers.get('location'), body };
}

async function main() {
    const cookie = await sessionCookieViaApp(env, ME, SITE);
    console.log('signed in as ' + ME + ' (session minted, no password)\n');

    const home = await get('/', cookie);
    console.log('HOME  /            status ' + home.status);
    console.log('  what3words on card :', home.body.includes(W3W) ? 'YES — "' + W3W + '"' : 'NO');
    console.log('  Get directions     :', home.body.includes('Get directions') ? 'YES' : 'no');
    console.log('  cottage photo       :', home.body.includes('mkt-cottage') ? 'YES (real photo)' : 'no');

    if (BOOKING) {
        const arr = await get('/arrival/' + BOOKING, cookie);
        const redirected = arr.status >= 300 && arr.status < 400;
        console.log('\nARRIVAL /arrival/' + BOOKING.slice(0, 8) + '…  status ' + arr.status + (redirected ? ' -> ' + arr.location : ''));
        console.log('  what3words         :', arr.body.includes(W3W) ? 'YES' : (redirected ? 'n/a (redirected)' : 'NO'));
        console.log('  door code 4729     :', arr.body.includes('4729') ? 'YES' : 'no');
    }
}

main().catch((e) => { console.error('VERIFY FAILED: ' + (e.message || e)); process.exit(1); });
