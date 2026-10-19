// The pushes that have no email: day-of reminders and requests running out of
// time, the way Airbnb sends them. Worked out by the push job each run and
// recorded in the outbox with a key per booking, so each is sent once however
// many times the job runs.
//
//   - a stay starts today: the guest and the host (and co-hosts with bookings)
//   - a stay ends today: the guest and the host
//   - an experience is today: the guest and the provider
//   - a stay request still unanswered after 20 hours: the host
//   - an experience request whose card hold expires within 12 hours: the provider
//   - the day after check-out: the host is asked to review the guest
//
// Day-of reminders wait until 8am in Dumfries & Galloway. Read-only on bookings
// and orders: this decides what to say and writes only to push_outbox.

import { queuePush } from './pushOutbox';

function londonParts(now: Date): { day: string; hour: number } {
    const day = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const hour = Number(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }));
    return { day, hour };
}

function time(t: string | null | undefined): string {
    if (!t) return '';
    const [h, m] = String(t).split(':').map(Number);
    if (isNaN(h)) return '';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return hh + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm');
}

async function firstNames(admin: any, ids: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (ids.length === 0) return out;
    const { data } = await admin.from('profiles').select('id, first_name, preferred_name, show_full_name').in('id', ids);
    for (const p of data || []) out[p.id] = (p.preferred_name || p.first_name || '').trim();
    return out;
}

async function titles(admin: any, ids: string[]): Promise<Record<string, any>> {
    const out: Record<string, any> = {};
    if (ids.length === 0) return out;
    const { data } = await admin.from('listings').select('id, title, check_in_time, check_out_time').in('id', ids);
    for (const l of data || []) out[l.id] = l;
    return out;
}

export async function queueReminders(admin: any, now: Date = new Date()): Promise<number> {
    let queued = 0;
    const q = async (p: Parameters<typeof queuePush>[0]) => { if (await queuePush(p, admin)) queued++; };
    const { day, hour } = londonParts(now);

    try {
        if (hour >= 8) {
            // ---- stays: arrival and check-out day
            for (const which of ['check_in', 'check_out'] as const) {
                const { data: stays } = await admin
                    .from('bookings')
                    .select('id, listing_id, guest_id, host_id, check_in, check_out')
                    .eq('status', 'confirmed')
                    .eq(which, day)
                    .limit(500);
                const list = stays || [];
                const names = await firstNames(admin, list.map((b: any) => b.guest_id));
                const listings = await titles(admin, list.map((b: any) => b.listing_id));
                for (const b of list) {
                    const l = listings[b.listing_id] || {};
                    const place = l.title || 'your stay';
                    const guest = names[b.guest_id] || 'Your guest';
                    if (which === 'check_in') {
                        await q({ dedupeKey: 'reminder.check_in.guest:' + b.id, kind: 'reminder.check_in.guest', category: 'reminders',
                            userId: b.guest_id, title: 'Your stay starts today',
                            body: place + (time(l.check_in_time) ? ' · check in from ' + time(l.check_in_time) : '') + '. Your arrival details are in your trip.',
                            url: '/trips' });
                        await q({ dedupeKey: 'reminder.check_in.host:' + b.id, kind: 'reminder.check_in.host', category: 'reminders',
                            userId: b.host_id, title: guest + ' arrives today', body: place + '. Make sure everything’s ready.',
                            url: '/dashboard/bookings/' + b.id, context: { booking_id: b.id, cohost: 'can_bookings' } });
                    } else {
                        await q({ dedupeKey: 'reminder.check_out.guest:' + b.id, kind: 'reminder.check_out.guest', category: 'reminders',
                            userId: b.guest_id, title: 'Check-out is today',
                            body: place + (time(l.check_out_time) ? ' · leave by ' + time(l.check_out_time) : '') + '. Safe travels!',
                            url: '/trips' });
                        await q({ dedupeKey: 'reminder.check_out.host:' + b.id, kind: 'reminder.check_out.host', category: 'reminders',
                            userId: b.host_id, title: guest + ' checks out today', body: place + '.',
                            url: '/dashboard/bookings/' + b.id, context: { booking_id: b.id, cohost: 'can_bookings' } });
                    }
                }
            }

            // ---- the host's review request, the day after check-out (guests
            // already get one by email from the review-reminders job)
            const yesterday = new Date(now.getTime() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
            const { data: done } = await admin
                .from('bookings')
                .select('id, listing_id, guest_id, host_id')
                .eq('status', 'confirmed')
                .eq('check_out', yesterday)
                .limit(500);
            const dNames = await firstNames(admin, (done || []).map((b: any) => b.guest_id));
            for (const b of done || []) {
                await q({ dedupeKey: 'reminder.review.host:' + b.id, kind: 'reminder.review.host', category: 'reviews',
                    userId: b.host_id, title: 'How was ' + (dNames[b.guest_id] || 'your guest') + '?',
                    body: 'Leave a review while the stay is fresh in your mind.',
                    url: '/dashboard/reviews', context: { booking_id: b.id } });
            }

            // ---- experiences happening today
            const { data: orders } = await admin
                .from('service_orders')
                .select('id, provider_id, guest_id, item_name, provider_name, service_time')
                .eq('status', 'confirmed')
                .eq('service_date', day)
                .limit(500);
            const provIds = Array.from(new Set((orders || []).map((o: any) => o.provider_id)));
            const owners: Record<string, string> = {};
            if (provIds.length) {
                const { data: provs } = await admin.from('service_providers').select('id, owner_id').in('id', provIds);
                for (const p of provs || []) owners[p.id] = p.owner_id;
            }
            const guestNames = await firstNames(admin, (orders || []).map((o: any) => o.guest_id));
            for (const o of orders || []) {
                const what = o.item_name || o.provider_name || 'Your experience';
                const at = time(o.service_time);
                await q({ dedupeKey: 'reminder.experience.guest:' + o.id, kind: 'reminder.experience.guest', category: 'reminders',
                    userId: o.guest_id, title: 'Your experience is today', body: what + (at ? ' at ' + at : '') + '.',
                    url: '/experiences/order/' + o.id });
                if (owners[o.provider_id]) {
                    await q({ dedupeKey: 'reminder.experience.provider:' + o.id, kind: 'reminder.experience.provider', category: 'reminders',
                        userId: owners[o.provider_id], title: 'You have a booking today',
                        body: (guestNames[o.guest_id] || 'A guest') + ' · ' + what + (at ? ' at ' + at : '') + '.',
                        url: '/services/dashboard' });
                }
            }
        }

        // ---- stay requests waiting on the host
        const { data: waiting } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, payment_status, amount_paid')
            .eq('status', 'pending')
            .lt('created_at', new Date(now.getTime() - 20 * 3600000).toISOString())
            .gt('created_at', new Date(now.getTime() - 7 * 86400000).toISOString())
            .limit(500);
        const paidWaiting = (waiting || []).filter((b: any) => Number(b.amount_paid || 0) > 0 || b.payment_status === 'paid' || b.payment_status === 'deposit_paid');
        const wNames = await firstNames(admin, paidWaiting.map((b: any) => b.guest_id));
        const wListings = await titles(admin, paidWaiting.map((b: any) => b.listing_id));
        for (const b of paidWaiting) {
            await q({ dedupeKey: 'reminder.request.host:' + b.id, kind: 'reminder.request.host', category: 'reminders',
                userId: b.host_id, title: 'Respond to ' + (wNames[b.guest_id] || 'your guest') + '’s request',
                body: ((wListings[b.listing_id] || {}).title || 'Your listing') + '. They’re waiting to hear if they can stay.',
                url: '/dashboard/bookings/' + b.id, context: { booking_id: b.id, cohost: 'can_bookings' } });
        }

        // ---- experience requests about to lapse
        const { data: lapsing } = await admin
            .from('service_orders')
            .select('id, provider_id, guest_id, item_name, expires_at')
            .eq('status', 'authorised')
            .gt('expires_at', now.toISOString())
            .lt('expires_at', new Date(now.getTime() + 12 * 3600000).toISOString())
            .limit(500);
        const lpIds = Array.from(new Set((lapsing || []).map((o: any) => o.provider_id)));
        const lpOwners: Record<string, string> = {};
        if (lpIds.length) {
            const { data: provs } = await admin.from('service_providers').select('id, owner_id').in('id', lpIds);
            for (const p of provs || []) lpOwners[p.id] = p.owner_id;
        }
        const lNames = await firstNames(admin, (lapsing || []).map((o: any) => o.guest_id));
        for (const o of lapsing || []) {
            if (!lpOwners[o.provider_id]) continue;
            await q({ dedupeKey: 'reminder.order_expiry.provider:' + o.id, kind: 'reminder.order_expiry.provider', category: 'reminders',
                userId: lpOwners[o.provider_id], title: 'Request expires soon',
                body: 'Accept or decline ' + (lNames[o.guest_id] || 'your guest') + '’s request' + (o.item_name ? ' for ' + o.item_name : '') + ' before it lapses.',
                url: '/services/dashboard' });
        }
    } catch {
        // A reminder that can't be worked out this run is tried again next run.
    }
    return queued;
}
