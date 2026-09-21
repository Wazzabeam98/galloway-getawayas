// ONE source of a provider's slot sessions, shared by the host diary and the
// guest move picker so the two views can never disagree about which sessions
// exist — and the reconciliation that keeps a PAID booking visible even when its
// seat row has gone.
//
// WHY THIS EXISTS. A slot_sessions row is a DERIVED SEAT CACHE: the booking flow
// writes it when a seat is claimed. The money truth is the confirmed order in
// service_orders. The two can drift, because service_orders.slot_session_id is a
// foreign key with ON DELETE SET NULL — delete or replace a session and every
// paid order that sat on it silently loses its link. After that the order (and
// its payout) still exist, but NO seat row points back, so any view that paints
// from slot_sessions alone — the host calendar, the move picker — is blind to the
// booking. `orphanBookedTimes` reconciles the orders back in so a paid booking
// can never be invisible.
//
// Relative imports on purpose: this module is exercised by a unit test.
import { normaliseUnit, unitMultiplies } from './serviceOrders';

export interface RawSlotSession {
    id: string;
    session_date: string;
    session_time: string;
    capacity: number;
    seats_taken: number;
    private: boolean;
    declared: boolean;
    blocked: boolean;
    duration_minutes: number | null;
}

const hhmm = (t: any) => String(t).slice(0, 5);

// The one query both views read, so they cannot disagree about which sessions
// exist. `toKey` bounds the far end (the picker's horizon); omit it for the host
// diary, which wants everything from today on.
export async function fetchSlotSessionRows(
    admin: any, providerId: string, fromKey: string, toKey?: string
): Promise<RawSlotSession[]> {
    let q = admin
        .from('slot_sessions')
        .select('id, session_date, session_time, capacity, seats_taken, private, declared, blocked, duration_minutes')
        .eq('provider_id', providerId)
        .gte('session_date', fromKey);
    if (toKey) q = q.lte('session_date', toKey);
    const { data } = await q.order('session_date', { ascending: true }).order('session_time', { ascending: true });
    return (data || []) as RawSlotSession[];
}

export interface ConfirmedOrderTime {
    service_date: string;
    service_time: string | null;
    item_unit: string | null;
    quantity: number | null;
}

export interface OrphanBooking {
    date: string;
    time: string;       // HH:MM
    seats: number;
    private: boolean;
}

// Confirmed bookings that no session row covers — a paid order whose session was
// deleted (slot_session_id nulled) or never materialised. Returned so a view can
// surface them as booked, rather than paint the slot as free. Keyed on
// (date, HH:MM) the same way the seat rows are, and folded across orders that
// share a time.
export function orphanBookedTimes(
    sessions: Array<{ session_date: string; session_time: string }>,
    orders: ConfirmedOrderTime[]
): OrphanBooking[] {
    const covered = new Set(sessions.map((s) => s.session_date + ' ' + hhmm(s.session_time)));
    const byKey = new Map<string, OrphanBooking>();
    for (const o of orders || []) {
        if (!o.service_time) continue;   // a request-shape order has no timed session
        const key = o.service_date + ' ' + hhmm(o.service_time);
        if (covered.has(key)) continue;  // a real seat row already shows this time
        const cur = byKey.get(key) || { date: o.service_date, time: hhmm(o.service_time), seats: 0, private: false };
        cur.seats += Number(o.quantity) || 1;
        // A whole-session (private) unit takes the slot outright; any per-person
        // seat keeps it shared.
        if (!unitMultiplies(normaliseUnit(o.item_unit || ''))) cur.private = true;
        byKey.set(key, cur);
    }
    return Array.from(byKey.values());
}
