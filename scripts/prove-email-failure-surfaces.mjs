// Prove that a failed email actually reaches error_log with enough to act on.
//
// Reporting was moved inside lib/email.ts sendEmail(): on a Resend rejection or
// an unreachable Resend it calls logError(message, detail, {path:'lib/email'}),
// which writes to error_log — the table behind /admin/errors. Nobody had
// watched it fail. This forces the failure (an invalid RESEND_API_KEY, so
// Resend answers 401 and NOTHING is actually sent) for a real, non-reserved
// recipient, using the SAME sendEmail the money paths call, then reads the row
// back off the TEST error_log.
//
// The four paths that matter all funnel through this sendEmail:
//   - the 72/48/24 balance ladder   app/api/cron/balance-charges  -> sendEmail
//   - the payout notice             app/api/cron/host-payouts     -> sendEmail
//   - the guest-experience orders   app/api/stripe/webhook        -> sendEmail
//   - the dispute warning           app/api/stripe/webhook        -> sendEmailToAll,
//     AND its own logError('[webhook] a dispute alert did not send', {dispute,
//     booking, failed, reached}) on top — the deadline-carrying one is reported
//     twice.
//
// Run: node scripts/prove-email-failure-surfaces.mjs

import { createRequire } from 'node:module';
import { loadEnv, assertTestEnvironment, supabaseClient } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
// logError's admin client and sendEmail both read process.env.
for (const [k, v] of Object.entries(env)) process.env[k] = v;

const require = createRequire(import.meta.url);
// Map '@/lib/*' onto the compiled build, exactly as the test suite does.
const { installAliases } = require('../.test-build/tests/helpers/stub.js');
installAliases();
const { sendEmail } = require('../.test-build/lib/email.js');

const db = supabaseClient(env);
const marker = 'EMAILFAIL-' + Date.now();
// A real TLD (so it is NOT a suppressed reserved-TLD test address) at a domain
// that does not exist. With an invalid key the request is refused at 401 before
// any delivery is attempted, so nothing leaves the building.
const RCPT = 'director+' + marker + '@gg-audit-nonexistent.co.uk';

const CASES = [
    { path: 'balance ladder (72h)', subject: 'Your balance payment needs attention — ' + marker },
    { path: 'payout notice',        subject: "You've been paid — " + marker },
    { path: 'order email',          subject: 'Your experience is booked — ' + marker },
];

async function main() {
    console.log('\n=== Prove email failure reaches error_log — TEST ===\n');
    // Break the sender.
    process.env.RESEND_API_KEY = 'rk_INVALID_forced_failure_' + marker;

    for (const c of CASES) {
        const ok = await sendEmail(RCPT, c.subject, '<p>body — never sent, carries names/amounts</p>');
        console.log('  sendEmail [' + c.path + '] returned ' + ok + ' (false = it reported a failure)');
    }

    // Give the async logError writes a moment, then read the rows back.
    await new Promise((r) => setTimeout(r, 1500));
    const rows = await db.select('error_log',
        '?path=eq.lib/email&order=created_at.desc&limit=20&select=message,detail,path,created_at');
    // detail is stored as a JSON string (lib/logError.ts JSON.stringify -> text).
    const parse = (r) => { try { return JSON.parse(r.detail); } catch { return {}; } };
    const mine = (rows || []).filter((r) => String(r.detail || '').includes(marker));

    console.log('\n  error_log rows written by this run (path=lib/email):');
    for (const r of mine) {
        const d = parse(r);
        console.log('    • ' + r.message);
        console.log('        to=' + d.to + ' | status=' + d.status + ' | subject="' + d.subject + '"');
    }
    const pass = mine.length === CASES.length
        && mine.every((r) => { const d = parse(r); return String(d.subject || '').includes(marker) && d.to === RCPT && d.status === 401; });
    console.log('\n  ' + (pass ? '✓ PASS' : '✗ FAIL') + ' — ' + mine.length + '/' + CASES.length
        + ' failures surfaced with recipient + subject + status (enough to chase which email, to whom).');

    // Cleanup the rows this run created.
    for (const r of mine) {
        await db.remove('error_log', '?path=eq.lib/email&message=eq.' + encodeURIComponent(r.message)).catch(() => {});
    }
    console.log('  (rows removed)\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERROR', e); process.exit(1); });
