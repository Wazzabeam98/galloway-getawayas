import { loadEnv } from './seed-lib.mjs';
const env = loadEnv();
const ME = 'liamworrall18@hotmail.com';
const site = process.env.SITE;
const admin = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/admin/generate_link', { method: 'POST', headers: admin, body: JSON.stringify({ type: 'magiclink', email: ME }) });
const link = await r.json();
if (!link.hashed_token) { console.error('no token', JSON.stringify(link).slice(0,200)); process.exit(1); }
console.log(site + '/auth/callback?type=magiclink&next=%2Ftrips&token_hash=' + encodeURIComponent(link.hashed_token));
