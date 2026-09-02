// Demo data for the fix/london-day-keys preview. Test project only (guarded).
//   node scripts/_demo-preview.mjs          # create
//   node scripts/_demo-preview.mjs --reset  # remove
import { loadEnv, assertTestEnvironment, supabaseClient } from './seed-lib.mjs';

const env = loadEnv();
assertTestEnvironment(env);
const db = supabaseClient(env);

const GUEST_EMAIL = 'preview-guest@gallowaydemo.test';
const GUEST_PW = 'PreviewDemo2026!';
const HOST_EMAIL = 'preview-host@gallowaydemo.test';
const TAG = 'PREVIEW DEMO';
const reset = process.argv.includes('--reset');

function londonDayKey(at = new Date()) {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const g = (t) => p.find((x) => x.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
}
function shift(key, days) {
    const [y, m, d] = key.split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1, d, 12) + days * 86400000);
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`;
}
function nightsBetween(a, b) {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

async function findUser(email) {
    const page = await db.auth('GET', '/admin/users?per_page=200');
    return ((page && page.users) || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}
async function ensureUser(email, password) {
    const ex = await findUser(email);
    if (ex) {
        if (password) await db.auth('PUT', '/admin/users/' + ex.id, { password, email_confirm: true });
        return ex.id;
    }
    const made = await db.auth('POST', '/admin/users', { email, password, email_confirm: true });
    return made.id;
}
async function wipeDemoListings() {
    const listings = await db.select('listings', '?select=id&title=like.' + encodeURIComponent(TAG + '%'));
    for (const l of listings) {
        await db.remove('bookings', '?listing_id=eq.' + l.id);
        await db.remove('listings', '?id=eq.' + l.id);
    }
}

async function main() {
    if (reset) {
        await wipeDemoListings();
        for (const e of [GUEST_EMAIL, HOST_EMAIL]) {
            const u = await findUser(e);
            if (u) await db.auth('DELETE', '/admin/users/' + u.id);
        }
        console.log('reset done');
        return;
    }

    const today = londonDayKey();
    const guestId = await ensureUser(GUEST_EMAIL, GUEST_PW);
    const hostId = await ensureUser(HOST_EMAIL);
    await db.update('profiles', '?id=eq.' + guestId, { full_name: 'Preview Guest' });
    await db.update('profiles', '?id=eq.' + hostId, { full_name: 'Preview Host', stripe_payouts_enabled: true });

    await wipeDemoListings();
    const [listing] = await db.insert('listings', [{
        host_id: hostId,
        title: TAG + ' — Harbour Cottage',
        location: 'Kirkcudbright, Dumfries and Galloway',
        price_per_night: 120, status: 'published', max_guests: 4, bedrooms: 2, beds: 2, bathrooms: 1,
        cancellation_policy: 'Moderate',
        check_in_time: '15:00:00', check_in_end_time: '18:00:00', check_out_time: '11:00:00',
        check_in_method: 'Smart lock',
        description: 'Preview demo listing for the London-day-keys PR.',
    }]);

    // B: checkout is TODAY (E2). A: last free day is TODAY (E1). C: a clean
    // future free-cancel deadline (live-computed). Non-overlapping dates.
    const defs = [
        { key: 'B', check_in: shift(today, -2), check_out: today },
        { key: 'A', check_in: shift(today, 5), check_out: shift(today, 8) },
        { key: 'C', check_in: shift(today, 20), check_out: shift(today, 23) },
    ];
    const ids = {};
    for (const b of defs) {
        const total = nightsBetween(b.check_in, b.check_out) * 120;
        const [row] = await db.insert('bookings', [{
            listing_id: listing.id, guest_id: guestId, host_id: hostId,
            check_in: b.check_in, check_out: b.check_out, guests: 2, adults: 2,
            total_price: total, status: 'confirmed', payment_status: 'paid', amount_paid: total,
            confirmed_at: new Date().toISOString(), paid_at: new Date().toISOString(),
        }]);
        ids[b.key] = row.id;
        console.log(b.key, row.id, b.check_in, '→', b.check_out, '£' + total);
    }

    console.log('\n--- DEMO READY ---');
    console.log('today       :', today);
    console.log('guest email :', GUEST_EMAIL);
    console.log('guest pw    :', GUEST_PW);
    console.log('listing id  :', listing.id);
    console.log('booking A   :', ids.A, '(E1 last free day = today)');
    console.log('booking B   :', ids.B, '(E2 checkout today)');
    console.log('booking C   :', ids.C, '(live free-cancel deadline = ' + shift(today, 15) + ')');
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
