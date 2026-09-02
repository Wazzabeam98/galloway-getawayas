// A few booked experiences on top of the marketplace seed, so the morning demo
// shows non-zero trust counts and Morag has bookings to open (the order page,
// the confirmation banner). TEST ONLY. Run AFTER seed-marketplace.mjs:
//   node scripts/_demo-orders.mjs         # create
//   node scripts/_demo-orders.mjs --reset # remove just these
import { loadEnv, assertTestEnvironment, supabaseClient } from './seed-lib.mjs';

const env = loadEnv('.env.local');
assertTestEnvironment(env);
const db = supabaseClient(env);
const reset = process.argv.includes('--reset');

const NOTE_TAG = 'DEMO-ORDER';

async function findGuest() {
    const page = await db.auth('GET', '/admin/users?per_page=200');
    const u = ((page && page.users) || []).find((x) => (x.email || '').toLowerCase() === 'morag@gallowaymarket.test');
    return u ? u.id : null;
}

async function run() {
    const guestId = await findGuest();
    if (!guestId) { console.error('No Morag — run seed-marketplace first.'); process.exit(1); }

    const bookings = await db.select('bookings', '?guest_id=eq.' + guestId + '&select=id,listing_id,check_in,check_out&order=check_in.asc');
    const booking = (bookings || [])[0];
    if (!booking) { console.error('Morag has no booking — run seed-marketplace first.'); process.exit(1); }

    if (reset) {
        await db.remove('service_orders', '?guest_id=eq.' + guestId + '&note=like.' + encodeURIComponent(NOTE_TAG + '%'));
        console.log('removed demo orders');
        return;
    }

    // Approved guest providers with a priced item, a handful of them.
    const provs = await db.select('service_providers',
        '?audience=eq.guest&status=eq.approved&select=id,business_name,shape,slot_length_minutes,slot_capacity&order=business_name.asc');
    if (!provs || !provs.length) { console.error('No approved providers — run seed-marketplace first.'); process.exit(1); }

    const itemsByProv = {};
    for (const p of provs) {
        const items = await db.select('service_provider_items', '?provider_id=eq.' + p.id + '&active=eq.true&order=sort_order.asc&select=id,name,description,price,unit');
        itemsByProv[p.id] = items || [];
    }

    // Dates inside the stay (check_in .. check_out-1).
    const [cy, cm, cd] = String(booking.check_in).slice(0, 10).split('-').map(Number);
    const dateInStay = (offset) => {
        const d = new Date(Date.UTC(cy, cm - 1, cd + offset, 12));
        return d.toISOString().slice(0, 10);
    };

    // How many confirmed orders to fabricate per provider, for a believable
    // spread of trust counts. Skipped for any provider with no priced item.
    const spread = [4, 3, 2, 1, 0, 2, 1, 3];
    let made = 0;
    for (let i = 0; i < provs.length; i++) {
        const p = provs[i];
        const items = itemsByProv[p.id];
        if (!items.length) continue;
        const count = spread[i % spread.length];
        for (let n = 0; n < count; n++) {
            const item = items[n % items.length];
            const isSlot = p.shape === 'slot';
            const svcDate = dateInStay(1 + ((i + n) % 6));
            const row = {
                provider_id: p.id,
                guest_id: guestId,
                listing_id: booking.listing_id,
                booking_id: booking.id,
                trade: 'guest',
                status: 'confirmed',
                shape: p.shape,
                service_date: svcDate,
                service_time: isSlot ? '14:00:00' : null,
                price: Number(item.price),
                quantity: 1,
                commission_rate: 0.10,
                item_name: item.name,
                item_description: item.description || null,
                item_unit: item.unit || 'flat',
                unit_price: Number(item.price),
                provider_business_name: p.business_name,
                guest_name: 'Morag',
                guest_email: 'morag@gallowaymarket.test',
                exclusive_per_date: p.shape === 'comes_to_you',
                // A fake PI so nothing tries to talk to Stripe on a view. These
                // are display-only demo rows; don't cancel/refund them.
                stripe_payment_intent_id: 'pi_demo_' + Math.random().toString(36).slice(2, 12),
                note: NOTE_TAG + ' seeded booking',
            };
            try {
                await db.insert('service_orders', row);
                made++;
            } catch (e) {
                // exclusivity / constraint — skip and carry on.
            }
        }
    }
    console.log('created ' + made + ' confirmed demo orders across ' + provs.length + ' providers for Morag.');
    console.log('booking:', booking.id, '· stay', String(booking.check_in).slice(0, 10), '→', String(booking.check_out).slice(0, 10));
}

run();
