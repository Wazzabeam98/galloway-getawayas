import { loadEnv } from './seed-lib.mjs';
const env = loadEnv();
// EMAIL picks the account (default Liam's own), NEXT the page it lands on.
const ME = process.env.EMAIL || 'liamworrall18@hotmail.com';
const NEXT = process.env.NEXT || '/trips';
const site = process.env.SITE;
const admin = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/admin/generate_link', { method: 'POST', headers: admin, body: JSON.stringify({ type: 'magiclink', email: ME }) });
const link = await r.json();
if (!link.hashed_token) { console.error('no token', JSON.stringify(link).slice(0,200)); process.exit(1); }
console.log(site + '/auth/callback?type=magiclink&next=' + encodeURIComponent(NEXT) + '&token_hash=' + encodeURIComponent(link.hashed_token));
