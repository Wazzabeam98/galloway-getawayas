// What happened to the last few emails, without opening an inbox.
//
// Read-only. It creates nothing, sends nothing and changes nothing, so it is
// safe to run at any point during a test.
//
// Two halves, because this site sends mail two ways:
//
//   AUTH MAIL (sign-up confirmation, password reset) is sent by Supabase over
//   its own SMTP. There is no send log on the API, but the user row carries the
//   two timestamps that actually answer the question:
//
//       confirmation_sent_at  Supabase accepted the request and sent a link.
//       email_confirmed_at    Somebody opened that link and it was redeemed.
//
//   The gap between them is the whole cross-device story. Sent but never
//   confirmed is exactly what a broken link looks like from this side.
//
//   APP MAIL (bookings, payment reminders, payout breakdowns) goes through
//   Resend, which does keep a log. `last_event` is the delivery state, so a
//   bounce is visible here and nowhere else.
//
// Usage:
//   node scripts/check-email.mjs                    last 10 accounts
//   node scripts/check-email.mjs --email you@x.com  just that one
//   node scripts/check-email.mjs --watch            re-check every 5s
//
// RESEND_API_KEY is optional and is not in .env.local by default; without it
// the Resend half is skipped and says so rather than pretending all is well.

import { loadEnv, TEST_PROJECT_REF } from './seed-lib.mjs';

const env = loadEnv();
const args = process.argv.slice(2);
const only = (() => {
    const i = args.indexOf('--email');
    return i >= 0 ? args[i + 1] : null;
})();
const watch = args.includes('--watch');

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// Read-only, but there is no reason for this to ever point at production.
if (!SUPABASE_URL || !SUPABASE_URL.includes(TEST_PROJECT_REF)) {
    console.error('refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the test project');
    process.exit(1);
}
if (!SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
    process.exit(1);
}

function ago(iso) {
    if (!iso) return null;
    const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
    return `${Math.round(secs / 86400)}d ago`;
}

async function authAccounts() {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=50`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!res.ok) throw new Error(`admin/users responded ${res.status}`);
    const body = await res.json();
    let users = body.users || [];
    if (only) users = users.filter((u) => (u.email || '').toLowerCase() === only.toLowerCase());
    users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return users.slice(0, only ? 5 : 10);
}

async function resendSends() {
    const key = env.RESEND_API_KEY || process.env.RESEND_API_KEY;
    if (!key) return null;
    const res = await fetch('https://api.resend.com/emails?limit=10', {
        headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`resend responded ${res.status}`);
    const body = await res.json();
    return body.data || [];
}

async function report() {
    console.log('\n=== AUTH MAIL (Supabase) ===');
    const users = await authAccounts();
    if (!users.length) {
        console.log(only ? `no account on ${only} yet` : 'no accounts');
    }
    for (const u of users) {
        // email_confirmed_at is absent entirely until the link is redeemed.
        const confirmed = u.email_confirmed_at || u.confirmed_at || null;
        const state = confirmed
            ? `CONFIRMED ${ago(confirmed)}`
            : u.confirmation_sent_at
              ? `SENT ${ago(u.confirmation_sent_at)}, NOT YET CONFIRMED`
              : 'no confirmation sent';
        console.log(`  ${u.email}`);
        console.log(`      created ${ago(u.created_at)}  |  ${state}`);
    }

    console.log('\n=== APP MAIL (Resend) ===');
    try {
        const sends = await resendSends();
        if (sends === null) {
            console.log('  skipped: RESEND_API_KEY not set (see scripts/README.md)');
        } else if (!sends.length) {
            console.log('  no sends returned');
        } else {
            for (const s of sends) {
                const to = Array.isArray(s.to) ? s.to.join(', ') : s.to;
                console.log(`  ${s.last_event || 'unknown'}  ${to}  "${s.subject || ''}"  ${ago(s.created_at)}`);
            }
        }
    } catch (err) {
        console.log(`  Resend lookup failed: ${err.message}`);
    }
}

await report();
if (watch) {
    setInterval(() => {
        console.log('\n--- recheck ---');
        report().catch((e) => console.error(e.message));
    }, 5000);
}
