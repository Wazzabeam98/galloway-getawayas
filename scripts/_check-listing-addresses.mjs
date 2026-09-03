// READ-ONLY. Asks production which live listings would fail a "street address
// required" publish rule, before the rule is tightened. One SELECT, no writes.
//   node scripts/_check-listing-addresses.mjs
import pg from 'pg';
import fs from 'node:fs';

function loadEnv(file) {
    const out = {};
    for (const f of [file, '.env.local']) {
        try {
            for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
                const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
                if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
            }
        } catch { /* file may not exist */ }
    }
    return out;
}

const env = loadEnv('.env.production.local');
const url = env.SUPABASE_PROD_DB_URL;
if (!url) { console.error('No SUPABASE_PROD_DB_URL found.'); process.exit(1); }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
    const { rows } = await client.query(
        `select id, title, status,
                nullif(btrim(coalesce(street_address, '')), '') as street,
                nullif(btrim(coalesce(postcode, '')), '')       as postcode
           from listings
          where status in ('published', 'hidden')
          order by title`
    );
    const live = rows.length;
    const noStreet = rows.filter((r) => !r.street);
    const noPostcode = rows.filter((r) => !r.postcode);
    console.log(`Live listings (published/hidden): ${live}`);
    console.log(`  missing a street address: ${noStreet.length}`);
    console.log(`  missing a postcode:       ${noPostcode.length}`);
    if (noStreet.length) {
        console.log('\nWould FAIL a street-required rule:');
        for (const r of noStreet) console.log(`  - ${r.title || '(untitled)'} [${r.id}] status=${r.status} postcode=${r.postcode || '—'}`);
    } else {
        console.log('\nNone would fail: every live listing already has a street address.');
    }
} finally {
    await client.end();
}
