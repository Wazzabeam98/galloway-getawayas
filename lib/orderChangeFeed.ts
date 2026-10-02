// The per-category rules for moving a booked experience's DATE (and, for
// comes_to_you, its TIME) — the offerable window, the times a provider is open,
// the exclusive-per-date clash — extracted from PR #173's guest change-date route
// so BOTH directions share one source of truth:
//   - the guest asking the provider to move it (app/api/services/order/change-date)
//   - the provider asking the guest to move it (app/api/services/order/propose-change)
//
// For the two REQUEST shapes only (made_to_order, comes_to_you). A slot has a
// session to move between and its own engine; this never runs for a slot. A date
// change moves no money, so nothing here touches a payment.

import { exclusivePerDate } from '@/lib/serviceOrders';
import { shapeOf, generateSessions } from '@/lib/serviceSlots';
import { changeWindowState, dayKey, dayKeyFromNow, providerTakesChanges } from '@/lib/orderChange';
import { offeredTimes as providerOfferedTimes, isOfferedTime, normaliseTime } from '@/lib/offeredTimes';

const HORIZON_FALLBACK = 90;

export interface LoadedChange {
    order: any;
    provider: any;
    stay: { check_in: string; check_out: string } | null;
    windowHours: number;
    shape: string;
}
export type LoadErr = { error: { status: number; message: string } };

// Load the order and its provider WITHOUT an ownership check — each route applies
// its own (the guest route checks guest_id, the provider route checks owner_id).
// The shared refusals (missing, not confirmed, an added part, a slot, a provider
// not taking changes) live here so both routes agree on them.
export async function loadOrderForChange(admin: any, orderId: string): Promise<LoadedChange | LoadErr> {
    if (!orderId) return { error: { status: 400, message: 'Missing order' } };
    const { data: order } = await admin
        .from('service_orders')
        .select('id, guest_id, guest_email, guest_name, provider_id, booking_id, parent_order_id, status, shape, service_date, service_time, item_name, pending_service_date, pending_service_time, pending_change_expires_at, pending_change_by')
        .eq('id', orderId).maybeSingle();
    if (!order) return { error: { status: 404, message: 'No such booking' } };
    if (order.parent_order_id) return { error: { status: 400, message: 'Change the original booking, not an added part.' } };
    if (order.status !== 'confirmed') return { error: { status: 409, message: 'This booking isn’t confirmed yet.' } };
    const shape = shapeOf(order);
    if (shape === 'slot') return { error: { status: 400, message: 'A class booking is moved from the session picker, not here.' } };

    const { data: provider } = await admin
        .from('service_providers')
        .select('id, owner_id, business_name, contact_email, shape, status, plan, stripe_account_id, stripe_payouts_enabled, cancellation_window_hours, lead_time_days, guest_details, exclusive_per_date')
        .eq('id', order.provider_id).maybeSingle();
    if (!providerTakesChanges(provider)) return { error: { status: 400, message: 'That experience isn’t taking changes right now.' } };

    let stay: { check_in: string; check_out: string } | null = null;
    if (order.booking_id) {
        const { data: b } = await admin.from('bookings').select('check_in, check_out').eq('id', order.booking_id).maybeSingle();
        if (b) stay = { check_in: String(b.check_in).slice(0, 10), check_out: String(b.check_out).slice(0, 10) };
    }
    const windowHours = Number(provider.cancellation_window_hours) || 48;
    return { order, provider, stay, windowHours, shape };
}

// The window a new date may fall in, as day keys [minKey, maxKey].
export function dateBounds(loaded: LoadedChange, now: Date): { minKey: string; maxKey: string; horizonDays: number } {
    const { provider, stay, shape } = loaded;
    const horizonDays = Math.max(1, Math.min(365, Number(provider.guest_details && provider.guest_details.booking_horizon_days) || HORIZON_FALLBACK));
    const leadDays = shape === 'made_to_order' ? Math.max(1, Number(provider.lead_time_days) || 1) : 1;
    let minKey = dayKeyFromNow(leadDays, now);
    let maxKey = dayKeyFromNow(horizonDays, now);
    if (stay) {
        const lastNight = dayKey(new Date(new Date(stay.check_out + 'T00:00:00Z').getTime() - 86400000));
        if (stay.check_in > minKey) minKey = stay.check_in;
        if (lastNight < maxKey) maxKey = lastNight;
    }
    return { minKey, maxKey, horizonDays };
}

// The per-DATE start times a COMES-TO-YOU provider is open, from its weekly hours.
export async function comesToYouTimesByDate(admin: any, loaded: LoadedChange, minKey: string, maxKey: string): Promise<Record<string, string[]>> {
    if (loaded.shape !== 'comes_to_you') return {};
    const [{ data: avail }, { data: blocks }] = await Promise.all([
        admin.from('slot_availability').select('day_of_week, open_time, close_time').eq('provider_id', loaded.provider.id),
        admin.from('slot_blocks').select('blocked_date').eq('provider_id', loaded.provider.id).gte('blocked_date', minKey).lte('blocked_date', maxKey),
    ]);
    if (!avail || !avail.length) return {};
    const blockDates = (blocks || []).map((b: any) => String(b.blocked_date).slice(0, 10));
    const byDate: Record<string, string[]> = {};
    for (const s of generateSessions(avail as any, blockDates, 30, minKey, maxKey, 30)) {
        (byDate[s.date] = byDate[s.date] || []).push(s.time);
    }
    return byDate;
}

// The dates in [min,max] this provider is already committed elsewhere (comes_to_you
// exclusive-per-date), minus this order's own date.
export async function takenDates(admin: any, loaded: LoadedChange, minKey: string, maxKey: string): Promise<string[]> {
    if (!exclusivePerDate(loaded.provider)) return [];
    const { data: rows } = await admin
        .from('service_orders')
        .select('id, service_date')
        .eq('provider_id', loaded.provider.id)
        .in('status', ['authorised', 'confirmed'])
        .gte('service_date', minKey).lte('service_date', maxKey);
    const taken = new Set<string>();
    for (const r of rows || []) {
        if (r.id === loaded.order.id) continue;
        taken.add(String(r.service_date).slice(0, 10));
    }
    return Array.from(taken).sort();
}

// The picker feed both GET endpoints return: the offerable window, taken dates,
// and the times each date is open. `locked` when past the free-cancellation window.
export async function buildChangeFeed(admin: any, loaded: LoadedChange, now: Date) {
    const win = changeWindowState(loaded.order, loaded.windowHours, now);
    const { minKey, maxKey, horizonDays } = dateBounds(loaded, now);
    const taken = win.free ? await takenDates(admin, loaded, minKey, maxKey) : [];
    const timesByDate = win.free ? await comesToYouTimesByDate(admin, loaded, minKey, maxKey) : {};
    for (const t of taken) delete timesByDate[t];
    if (loaded.shape === 'comes_to_you' && win.free) {
        const curDate = String(loaded.order.service_date).slice(0, 10);
        const curTime = loaded.order.service_time ? String(loaded.order.service_time).slice(0, 5) : null;
        if (curTime && curDate >= minKey && curDate <= maxKey && !taken.includes(curDate)) {
            const list = timesByDate[curDate] = timesByDate[curDate] || [];
            if (!list.includes(curTime)) { list.push(curTime); list.sort(); }
        }
    }
    return {
        shape: loaded.shape,
        locked: !win.free,
        deadlineISO: win.deadlineISO,
        current: {
            date: String(loaded.order.service_date).slice(0, 10),
            time: loaded.order.service_time ? String(loaded.order.service_time).slice(0, 5) : null,
        },
        minKey, maxKey, horizonDays,
        takenDates: taken,
        exclusive: exclusivePerDate(loaded.provider),
        offeredTimes: providerOfferedTimes(loaded.provider.guest_details),
        timesByDate,
    };
}

// Validate a proposed new date/time against the same per-category rules the guest
// route enforces. Returns the accepted `newTime` (or null) on success, or an error
// with an HTTP status. `dateChanged`/`timeChanged` tell the caller what moved.
export async function validateProposedChange(
    admin: any, loaded: LoadedChange, rawDate: string, rawTime: string, now: Date,
): Promise<{ error: { status: number; message: string } } | { newDate: string; newTime: string | null; dateChanged: boolean; timeChanged: boolean }> {
    const win = changeWindowState(loaded.order, loaded.windowHours, now);
    if (!win.free) {
        return { error: { status: 409, message: 'The free-cancellation window has passed, so the date can’t be changed now.' } };
    }
    const newDate = String(rawDate || '').slice(0, 10);
    const newTimeRaw = normaliseTime(rawTime) || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { error: { status: 400, message: 'Pick a date.' } };

    const offered = providerOfferedTimes(loaded.provider.guest_details);
    const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    let newTime: string | null = null;
    if (loaded.shape === 'comes_to_you') {
        const { data: availRows } = await admin
            .from('slot_availability').select('day_of_week, open_time, close_time').eq('provider_id', loaded.provider.id);
        const hours = availRows || [];
        if (hours.length) {
            if (!newTimeRaw) return { error: { status: 400, message: 'Pick a time.' } };
            const { data: blk } = await admin
                .from('slot_blocks').select('blocked_date').eq('provider_id', loaded.provider.id).eq('blocked_date', newDate);
            if (blk && blk.length) return { error: { status: 409, message: 'They’re not available that day — try another date.' } };
            const dow = new Date(newDate + 'T00:00:00Z').getUTCDay();
            const tMin = toMin(newTimeRaw);
            const open = hours.some((w: any) => Number(w.day_of_week) === dow && tMin >= toMin(w.open_time) && tMin < toMin(w.close_time));
            if (!open) return { error: { status: 400, message: 'They’re not open then — pick another time.' } };
            newTime = newTimeRaw;
        } else if (offered.length) {
            if (!newTimeRaw || !isOfferedTime(loaded.provider.guest_details, newTimeRaw)) return { error: { status: 400, message: 'Pick a time.' } };
            newTime = newTimeRaw;
        } else if (newTimeRaw) {
            newTime = newTimeRaw;
        }
    } else if (offered.length) {
        if (!newTimeRaw || !isOfferedTime(loaded.provider.guest_details, newTimeRaw)) return { error: { status: 400, message: 'Pick a time.' } };
        newTime = newTimeRaw;
    } else if (newTimeRaw) {
        newTime = newTimeRaw;
    }

    const curDate = String(loaded.order.service_date).slice(0, 10);
    const curTime = loaded.order.service_time ? String(loaded.order.service_time).slice(0, 5) : null;
    const dateChanged = newDate !== curDate;
    const timeChanged = (newTime || '') !== (curTime || '');
    if (!dateChanged && !timeChanged) return { error: { status: 400, message: 'That’s already the booked date and time.' } };

    if (dateChanged) {
        const { minKey, maxKey } = dateBounds(loaded, now);
        if (newDate < minKey || newDate > maxKey) {
            return { error: { status: 400, message: 'That date isn’t open — pick one in the range shown.' } };
        }
        if (exclusivePerDate(loaded.provider)) {
            const { data: clash } = await admin
                .from('service_orders').select('id')
                .eq('provider_id', loaded.provider.id).eq('service_date', newDate)
                .in('status', ['authorised', 'confirmed']).neq('id', loaded.order.id).limit(1);
            if (clash && clash.length) {
                return { error: { status: 409, message: 'Someone’s already booked them for that date — try another.' } };
            }
        }
    }
    return { newDate, newTime, dateChanged, timeChanged };
}
