// The marketplace's data, in one place, so the grid page, a provider's listing
// page and the /api/services/experiences endpoint all show the same answer.
//
// Server-only: it is handed an admin (service-role) client and does the reads.
// Eligibility is unchanged — approved, payouts on, an assigned MCC, at least one
// priced item, and covering the cottage — with shape and, for a slot provider,
// the bookable sessions inside the stay folded in.

import { isLiveToGuests, mccForProvider, isFoodProvider, normaliseUnit } from '@/lib/serviceOrders';
import { pointForListing, coversPoint, guestCategory } from '@/lib/serviceProviders';
import { shapeOf, generateSessions, sessionCapacity, seatsLeft } from '@/lib/serviceSlots';
import { getImageUrl } from '@/lib/utils';
import { shiftDayKey } from '@/lib/dayKey';

export interface MpItem {
    id: string; name: string; description: string | null; price: number; unit: string; image: string | null;
}
export interface MpSession {
    date: string; time: string; capacity: number; seatsLeft: number;
}
export interface MpProvider {
    id: string;
    business_name: string;
    provider_name: string | null;
    based_line: string | null;
    headshot: string | null;
    category: string;
    // A food business (chef, baker, hamper, prepared meals) — the booking
    // panel asks these for allergies specifically.
    isFood: boolean;
    // What a food business can cater for, in their own words; null when they
    // haven't said, which the listing shows plainly rather than staying silent.
    dietary_note: string | null;
    description: string | null;
    shape: string;
    priceFrom: number;
    // A slot provider's per-person vs whole-slot reading comes off the item unit.
    items: MpItem[];
    // Slots only: the next bookable sessions in the stay (future, seats left).
    sessions: MpSession[];
    cancellation_window_hours: number;
    // Made-to-order only: notice needed, in days — gates the earliest bookable date.
    lead_time_days: number;
    hero: string | null;
}

export interface Marketplace {
    open: boolean;
    stay: { check_in: string; check_out: string } | null;
    listing: { id: string; location: string | null } | null;
    providers: MpProvider[];
}

function staySpan(b: any) { return { check_in: b.check_in, check_out: b.check_out }; }

// yyyy-mm-dd of the last night (check_out is the morning they leave).
function lastNightKey(checkOut: string): string {
    return shiftDayKey(String(checkOut).slice(0, 10), -1);
}

/**
 * The eligible providers for a booking (the guest's own), each with its shape,
 * menu and — for a slot — the bookable sessions inside the stay. `open` is the
 * launch flag; when it is false, providers is empty.
 */
export async function loadMarketplace(
    admin: any,
    userId: string,
    bookingId: string,
    open: boolean
): Promise<Marketplace> {
    if (!open) return { open: false, stay: null, listing: null, providers: [] };

    const { data: booking } = await admin
        .from('bookings')
        .select('id, guest_id, listing_id, check_in, check_out')
        .eq('id', bookingId)
        .maybeSingle();
    if (!booking || booking.guest_id !== userId) return { open: true, stay: null, listing: null, providers: [] };

    const { data: listing } = await admin
        .from('listings').select('id, location, latitude, longitude').eq('id', booking.listing_id).maybeSingle();
    if (!listing) return { open: true, stay: staySpan(booking), listing: null, providers: [] };

    const point = pointForListing(listing);
    if (!point) return { open: true, stay: staySpan(booking), listing: { id: listing.id, location: listing.location }, providers: [] };

    const { data: rows } = await admin
        .from('service_providers')
        .select('id, business_name, provider_name, based_line, headshot, trade, custom_label, stripe_mcc, description, status, stripe_payouts_enabled, shape, slot_length_minutes, slot_capacity, cancellation_window_hours, lead_time_days, dietary_note')
        .eq('audience', 'guest').eq('status', 'approved').eq('stripe_payouts_enabled', true);

    const ids = (rows || []).map((r: any) => r.id);
    if (!ids.length) return { open: true, stay: staySpan(booking), listing: { id: listing.id, location: listing.location }, providers: [] };

    const [{ data: areas }, { data: itemRows }, { data: avail }, { data: blocks }, { data: sessRows }] = await Promise.all([
        admin.from('service_areas').select('provider_id, centre_lat, centre_lng, radius_miles').in('provider_id', ids),
        admin.from('service_provider_items').select('id, provider_id, name, description, price, unit, image, sort_order, created_at')
            .in('provider_id', ids).eq('active', true).gt('price', 0)
            .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
        admin.from('slot_availability').select('provider_id, day_of_week, open_time, close_time').in('provider_id', ids),
        admin.from('slot_blocks').select('provider_id, blocked_date').in('provider_id', ids),
        admin.from('slot_sessions').select('provider_id, session_date, session_time, capacity, seats_taken').in('provider_id', ids),
    ]);

    const by = <T,>(list: any[], key: string) => {
        const m: Record<string, T[]> = {};
        for (const r of list || []) (m[r[key]] = m[r[key]] || []).push(r);
        return m;
    };
    const areasBy = by<any>(areas, 'provider_id');
    const itemsBy = by<any>(itemRows, 'provider_id');
    const availBy = by<any>(avail, 'provider_id');
    const blocksBy = by<any>(blocks, 'provider_id');
    const sessBy = by<any>(sessRows, 'provider_id');

    const fromKey = booking.check_in.slice(0, 10);
    const toKey = lastNightKey(booking.check_out);
    const nowMs = Date.now();

    const providers: MpProvider[] = [];
    for (const p of rows || []) {
        if (!(isLiveToGuests(p) && mccForProvider(p))) continue;
        const items = (itemsBy[p.id] || []).map((it: any) => ({
            id: it.id, name: it.name, description: it.description, price: Number(it.price),
            unit: normaliseUnit(it.unit), image: it.image ? getImageUrl(it.image) : null,
        }));
        if (!items.length) continue;
        if (!coversPoint(areasBy[p.id] || [], point.lat, point.lng)) continue;

        const shape = shapeOf(p);
        let sessions: MpSession[] = [];
        if (shape === 'slot') {
            const unit = items[0].unit;
            const cap = sessionCapacity(p, unit);
            // Seats already taken, by (date,time), from any live session rows.
            const taken: Record<string, number> = {};
            for (const s of sessBy[p.id] || []) taken[s.session_date + ' ' + s.session_time] = s.seats_taken;
            sessions = generateSessions(
                (availBy[p.id] || []).map((a: any) => ({ day_of_week: a.day_of_week, open_time: a.open_time, close_time: a.close_time })),
                (blocksBy[p.id] || []).map((b: any) => b.blocked_date),
                Number(p.slot_length_minutes) || 60, fromKey, toKey,
            )
                .filter((s) => new Date(s.date + 'T' + s.time + ':00Z').getTime() > nowMs)
                .map((s) => {
                    const t = taken[s.date + ' ' + s.time] || 0;
                    return { date: s.date, time: s.time, capacity: cap, seatsLeft: seatsLeft({ capacity: cap, seats_taken: t }) };
                })
                .filter((s) => s.seatsLeft > 0);
            // A slot with no bookable session in the stay is not shown.
            if (!sessions.length) continue;
        }

        providers.push({
            id: p.id,
            business_name: p.business_name,
            provider_name: p.provider_name,
            based_line: p.based_line,
            headshot: p.headshot ? getImageUrl(p.headshot) : null,
            category: guestCategory(p),
            isFood: isFoodProvider(p),
            dietary_note: p.dietary_note || null,
            description: p.description,
            shape,
            priceFrom: Math.min(...items.map((i: MpItem) => i.price)),
            items,
            sessions,
            cancellation_window_hours: Number(p.cancellation_window_hours) || 48,
            lead_time_days: Number(p.lead_time_days) || 0,
            hero: (items.find((i: MpItem) => i.image) || {}).image || null,
        });
    }

    // A gentle order: the ones with a photo first (the shop window sells on
    // them), then by name, so the grid never opens on a wall of placeholders.
    providers.sort((a, b) => {
        const ah = a.hero ? 0 : 1, bh = b.hero ? 0 : 1;
        return ah !== bh ? ah - bh : a.business_name.localeCompare(b.business_name);
    });

    return { open: true, stay: staySpan(booking), listing: { id: listing.id, location: listing.location }, providers };
}

/** One provider from a marketplace load, or null. */
export function pickProvider(mp: Marketplace, providerId: string): MpProvider | null {
    return mp.providers.find((p) => p.id === providerId) || null;
}
