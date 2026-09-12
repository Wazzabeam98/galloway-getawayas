import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { londonDayKey } from '@/lib/dayKey';
import { seatsLeft, sessionClosedToAll } from '@/lib/serviceSlots';
import { normaliseUnit } from '@/lib/serviceOrders';

export const dynamic = 'force-dynamic';

// How each upcoming slot time has sold, for the host's diary. For every time a
// guest has claimed, the seat truth (capacity, taken, left) comes from
// slot_sessions — the row the atomic claim writes — and WHICH option it sold as
// comes from the confirmed orders on it. "Closed" is the shared helper's answer
// (sessionClosedToAll): no option the provider offers can take another booking.
//
// Owner-only and getUser-verified, exactly like /api/services/orders: a host sees
// only their own business.
export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const providerId = new URL(request.url).searchParams.get('provider') || '';
        if (!providerId) return NextResponse.json({ ok: false, error: 'Missing provider' }, { status: 400 });

        const admin = adminClient();

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id, shape, slot_capacity, slot_min_people')
            .eq('id', providerId)
            .maybeSingle();
        if (!provider || provider.owner_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        }

        const today = londonDayKey();

        // The seat rows for upcoming times, the provider's item units (to read
        // "closed to everything"), and the confirmed orders that name the option.
        const [{ data: sessRows }, { data: itemRows }, { data: orderRows }] = await Promise.all([
            admin.from('slot_sessions')
                .select('session_date, session_time, capacity, seats_taken, private')
                .eq('provider_id', providerId)
                .gte('session_date', today),
            admin.from('service_provider_items')
                .select('unit').eq('provider_id', providerId).eq('active', true),
            admin.from('service_orders')
                .select('service_date, service_time, item_name, item_unit, quantity, status')
                .eq('provider_id', providerId)
                .eq('shape', 'slot')
                .eq('status', 'confirmed')
                .gte('service_date', today),
        ]);

        const units = (itemRows || []).map((i: any) => normaliseUnit(i.unit));

        // The confirmed sales on each time, grouped by option name.
        // Both time columns come back as "HH:MM:SS"; key on "HH:MM" so the orders
        // (service_time) and the session rows (session_time) actually join.
        const hhmm = (t: any) => String(t).slice(0, 5);
        type Sold = { item_name: string; unit: string; seats: number };
        const soldByKey: Record<string, Sold[]> = {};
        for (const o of orderRows || []) {
            const key = o.service_date + ' ' + hhmm(o.service_time);
            const list = (soldByKey[key] = soldByKey[key] || []);
            const name = o.item_name || 'Booking';
            const existing = list.find((x) => x.item_name === name);
            const seats = Number(o.quantity) || 1;
            if (existing) existing.seats += seats;
            else list.push({ item_name: name, unit: normaliseUnit(o.item_unit), seats });
        }

        const sessions = (sessRows || [])
            .map((s: any) => {
                const row = { capacity: Number(s.capacity), seats_taken: Number(s.seats_taken), private: Boolean(s.private) };
                return {
                    date: s.session_date,
                    time: hhmm(s.session_time),
                    capacity: row.capacity,
                    seats_taken: row.seats_taken,
                    seats_left: seatsLeft(row),
                    private: row.private,
                    closed: sessionClosedToAll(row, units, provider),
                    sold: soldByKey[s.session_date + ' ' + hhmm(s.session_time)] || [],
                };
            })
            // Only times that actually carry a booking are "how it sold"; an empty
            // generated time hasn't landed anywhere yet.
            .filter((s) => s.seats_taken > 0)
            .sort((a: any, b: any) => (a.date === b.date ? String(a.time).localeCompare(String(b.time)) : a.date.localeCompare(b.date)));

        return NextResponse.json({ ok: true, sessions });
    } catch (err: any) {
        console.error('[services/slots/sessions]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not load sessions' }, { status: 500 });
    }
}
