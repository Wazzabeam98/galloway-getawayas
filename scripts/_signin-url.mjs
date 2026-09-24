// Print a one-time magic-link callback URL for a test account, so the browser
// can sign in as them on a LOCAL build with no password and no auth wall. The
// app consumes the token on POST (the /auth/callback interstitial), so opening
// the URL shows a "continue" step — click it and you are signed in.
//
//   node scripts/_signin-url.mjs <email> [nextPath] [siteUrl]
//
// TEST PROJECT ONLY.

import { loadEnv, assertTestEnvironment } from './seed-lib.mjs';
import { LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);

const email = process.argv[2];
const nextPath = process.argv[3] || '/';
const siteUrl = process.argv[4] || LOCAL_URL;
if (!email) { console.error('Usage: node scripts/_signin-url.mjs <email> [nextPath] [siteUrl]'); process.exit(1); }

const res = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email }),
});
const link = await res.json();
if (!link.hashed_token) { console.error('no link for ' + email + ': ' + JSON.stringify(link).slice(0, 200)); process.exit(1); }

const url = siteUrl + '/auth/callback?type=magiclink&next=' + encodeURIComponent(nextPath) + '&token_hash=' + encodeURIComponent(link.hashed_token);
console.log(url);
