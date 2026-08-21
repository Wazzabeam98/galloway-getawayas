// Creates the private bucket that photos are moved into when an owner takes
// one off a listing.
//
//   node scripts/create-removed-bucket.mjs                        # test
//   node scripts/create-removed-bucket.mjs .env.production.local  # production
//
// Private on purpose. Deleting outright would mean a host disputing what was
// removed has nothing to point at; private gets it off the public internet
// just as fast and keeps the file. Deleting for good stays a separate,
// deliberate step.
//
// Safe to run twice — an existing bucket is left exactly as it is.

import { loadEnv } from './seed-lib.mjs';

export const REMOVED_BUCKET = 'listings-removed';

const file = process.argv[2] || '.env.local';
const env = loadEnv(file);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error(file + ' is missing the Supabase URL or service role key');

const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

const existing = await (await fetch(url + '/storage/v1/bucket', { headers })).json();
const already = (existing || []).find((b) => b.name === REMOVED_BUCKET);

console.log('project:', url);

if (already) {
    console.log('  ' + REMOVED_BUCKET + ' already exists — public=' + already.public);
    if (already.public) {
        console.log('  WARNING: it is public. It must not be. Fix it in the dashboard.');
        process.exit(1);
    }
} else {
    const res = await fetch(url + '/storage/v1/bucket', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: REMOVED_BUCKET, name: REMOVED_BUCKET, public: false }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error('could not create the bucket: ' + body);
    console.log('  created ' + REMOVED_BUCKET + ' (private)');
}

// Prove it, rather than trusting the flag we just sent.
const check = await (await fetch(url + '/storage/v1/bucket/' + REMOVED_BUCKET, { headers })).json();
console.log('  confirmed: public =', check.public);
if (check.public !== false) {
    console.log('  REFUSING TO CALL THIS DONE — the bucket is not private.');
    process.exit(1);
}
