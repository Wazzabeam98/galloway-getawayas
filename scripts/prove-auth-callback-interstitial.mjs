// Proof: the auth callback renders an interstitial on GET (consuming nothing) and
// spends the token only on POST — so a mail scanner's GET can't burn the link.
// Runs against a running dev server whose origin you pass in BASE. TEST only.
//
//   1. a bare GET does NOT consume the token (interstitial returned; token still
//      valid afterwards);
//   2. a POST does consume it (signs in, redirects to `next`; token then dead);
//   3. the link still works after a scanner has fetched it (GET then POST signs in).
//
// Run (with the dev server up):  BASE=<dev-server-origin> node scripts/prove-auth-callback-interstitial.mjs

import { loadEnv, assertTestEnvironment, TEST_PROJECT_REF } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const SB = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const BASE = process.env.BASE;
if (!BASE) { console.error('Set BASE to the dev server origin, e.g. BASE=<origin> node scripts/prove-auth-callback-interstitial.mjs'); process.exit(1); }
const EMAIL = 'liamworrall18@hotmail.com';
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);
let failed = 0;
const check = (c, m) => { if (!c) failed++; ok(c, m); };

// Mint a fresh magic-link token_hash against TEST.
async function mint() {
    const r = await fetch(SB + '/auth/v1/admin/generate_link', { method: 'POST', headers: SVC, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) });
    const j = await r.json();
    if (!j.hashed_token) throw new Error('mint failed: ' + JSON.stringify(j).slice(0, 120));
    return j.hashed_token;
}
// Verify a token_hash DIRECTLY against Supabase (bypassing the app). 200 = it was
// still valid (and now consumed); 4xx = already spent / invalid.
async function verifyDirect(tokenHash) {
    const r = await fetch(SB + '/auth/v1/verify', { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }) });
    return r.status;
}
async function callbackGET(tokenHash) {
    const u = BASE + '/auth/callback?type=magiclink&next=%2Ftrips&token_hash=' + encodeURIComponent(tokenHash);
    const r = await fetch(u, { method: 'GET', redirect: 'manual' });
    const body = await r.text();
    return { status: r.status, isInterstitial: body.includes('name="token_hash"') && body.includes('Finish signing in') };
}
async function callbackPOST(tokenHash) {
    const form = new URLSearchParams({ token_hash: tokenHash, type: 'magiclink', next: '/trips' });
    const r = await fetch(BASE + '/auth/callback', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    const loc = r.headers.get('location') || '';
    const setCookie = r.headers.get('set-cookie') || '';
    // Signed in = redirected to `next` (not to /?error=…) and a session cookie set.
    const signedIn = (r.status >= 300 && r.status < 400) && loc.includes('/trips') && !loc.includes('error') && /auth-token|sb-/.test(setCookie);
    return { status: r.status, loc, signedIn, setCookie };
}

async function main() {
    console.log('\n=== Proof: auth callback interstitial — TEST ' + TEST_PROJECT_REF + ' via ' + BASE + ' ===\n');

    // 1. A bare GET does not consume the token.
    const t1 = await mint();
    const g1 = await callbackGET(t1);
    check(g1.status === 200 && g1.isInterstitial, 'a bare GET returns the interstitial (200, a form to submit), not a redirect [' + g1.status + ']');
    check(await verifyDirect(t1) === 200, 'after that GET the token is STILL VALID — the GET consumed nothing');

    // 2. A POST consumes it and signs in.
    const t2 = await mint();
    const p2 = await callbackPOST(t2);
    check(p2.signedIn, 'a POST signs in (redirects to /trips with a session cookie) [' + p2.status + ' -> ' + p2.loc.slice(0, 40) + ']');
    check(await verifyDirect(t2) !== 200, 'after that POST the token is SPENT (a direct re-verify is refused)');

    // 3. The link still works after a scanner has fetched it.
    const t3 = await mint();
    const scan = await callbackGET(t3);                 // the scanner's GET
    check(scan.isInterstitial, 'the scanner GET got only the interstitial');
    const p3 = await callbackPOST(t3);                  // the human's POST, same link
    check(p3.signedIn, 'the human POST on the SAME link still signs in — the scanner did not burn it [' + p3.status + ' -> ' + p3.loc.slice(0, 40) + ']');

    console.log(failed ? '\n  ' + failed + ' CHECK(S) FAILED\n' : '\n  ALL CHECKS PASSED\n');
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
