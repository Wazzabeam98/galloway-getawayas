// Proof for the payments/payouts write-grant revoke — TEST only, re-runnable.
//
// BEFORE: anon+authenticated hold INSERT/UPDATE on payments and payouts (safe
//         only because no write policy exists — one policy from disaster).
// AFTER:  the grants are gone, and the service role still writes (the webhook /
//         payout cron path is unaffected).
//
// Run: node scripts/prove-payments-payouts-locked.mjs

import pg from 'pg';
import { loadEnv, assertTestEnvironment, supabaseClient, TEST_PROJECT_REF } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m);
async function runSql(sql) { const c = new pg.Client({ connectionString: env.SUPABASE_TEST_DB_URL }); await c.connect(); try { return (await c.query(sql)).rows; } finally { await c.end(); } }
async function applyFile(f) { const fs = await import('node:fs'); await runSql(fs.readFileSync(f, 'utf8')); }
const writeGrants = () => runSql(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_name in ('payments','payouts') and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE') order by table_name, grantee, privilege_type`);

async function main() {
    console.log('\n=== Proof: payments/payouts are service-role only — TEST ' + TEST_PROJECT_REF + ' ===\n');
    // baseline: restore the (over-broad) grants so the before-state is honest
    await runSql('grant insert, update on public.payments to anon, authenticated');
    await runSql('grant insert, update on public.payouts to anon, authenticated');
    let g = await writeGrants();
    ok(g.length > 0, 'BEFORE: browser roles hold write grants on payments/payouts  [' + g.length + ' grants]');

    await applyFile('supabase/migrations/20260903181045_payments_payouts_are_service_role_only.sql');
    console.log('  · applied 20260903181045');
    g = await writeGrants();
    ok(g.length === 0, 'AFTER: no INSERT/UPDATE/DELETE for anon/authenticated on payments or payouts  [' + JSON.stringify(g) + ']');

    // the service role (used by the webhook and payout cron) still writes.
    const tag = 'ppl-' + Date.now();
    const host = await db.auth('POST', '/admin/users', { email: 'h-' + tag + '@gallowayseed.test', password: 'Test-' + tag, email_confirm: true });
    await db.rest('POST', '/profiles', [{ id: host.id, email: 'h-' + tag + '@gallowayseed.test' }], 'return=representation,resolution=merge-duplicates');
    const rows = await db.insert('payouts', [{ host_id: host.id, amount: 1, kind: 'transfer', status: 'succeeded' }]).catch((e) => ({ err: e.message }));
    const wrote = Array.isArray(rows) && rows[0] && rows[0].id;
    ok(!!wrote, 'service role can STILL insert a payout (webhook/cron path unaffected)  [' + (wrote ? 'ok' : JSON.stringify(rows)) + ']');
    if (wrote) await db.remove('payouts', '?id=eq.' + rows[0].id).catch(() => {});
    await db.remove('profiles', '?id=eq.' + host.id).catch(() => {});
    await db.auth('DELETE', '/admin/users/' + host.id).catch(() => {});

    console.log('\n  done.\n');
}
main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e); process.exit(1); });
