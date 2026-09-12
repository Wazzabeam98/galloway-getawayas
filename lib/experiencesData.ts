// The marketplace's data, in one place, so the grid page, a provider's listing
// page and the /api/services/experiences endpoint all show the same answer.
//
// Server-only: it is handed an admin (service-role) client and does the reads.
// Eligibility is unchanged — approved, payouts on, an assigned MCC, at least one
// priced item, and covering the cottage — with shape and, for a slot provider,
// the bookable sessions inside the stay folded in.

import { isLiveToGuests, mccForProvider, isFoodProvider, normaliseUnit } from '@/lib/serviceOrders';
import { guestCategory, knownDietaryOptions } from '@/lib/serviceProviders';
import { shapeOf, generateSessions, sessionClosedToAll } from '@/lib/serviceSlots';
import { getImageUrl, firstName } from '@/lib/utils';
import { shiftDayKey } from '@/lib/dayKey';

export interface MpItem {
    id: string; name: string; description: string | null; price: number; unit: string; image: string | null;
}
export interface MpSession {
    date: string; time: string;
    // The established slot_sessions row for this time, or null if nobody has
    // booked it yet (a fresh time — open to any option). The panel reads
    // optionAvailability off this, per option, so a private hire and a shared
    // seat show their OWN availability rather than one shared "seats left".
    row: { capacity: number; seats_taken: number; private: boolean } | null;
}
export interface MpProvider {
    id: string;
    // The listing's display name is the provider's Title (their Intro field).
    business_name: string;
    // The byline beneath their photo: the provider's FIRST name only, derived
    // live from their profile (honouring the show_full_name / preferred_name
    // switch). A surname must never reach a guest, so this is not provider_name
    // (a stored snapshot that could carry one). Empty when they have no shown name.
    byline: string;
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
    // What the provider can cater for, as keys (DIETARY_OPTIONS), from
    // guest_details jsonb. Shown as chips; the note carries the caveats.
    dietary_options: string[];
    // The person's professional title ("Chef and restaurant owner"), from
    // guest_details jsonb — shown beneath the title (which is now their name).
    professional_title: string | null;
    // The provider's own walk-through of the experience, from guest_details jsonb.
    // Displayed on the experience page; null when they didn't write one.
    what_happens: string | null;
    description: string | null;
    shape: string;
    priceFrom: number;
    // A slot provider's per-person vs whole-slot reading comes off the item unit.
    items: MpItem[];
    // Slots only: the next bookable sessions in the stay (future, seats left).
    sessions: MpSession[];
    // Per-person slots only: the smallest group a single booking may be
    // (slot_min_people). 1 = no minimum. The panel floors the picker at it; the
    // booking route enforces it for real. Meaningless when the unit doesn't
    // multiply (a whole-group flat price is one booking) — 1 there.
    minPeople: number;
    // Slots only: the whole-table size (slot_capacity), so the panel can size a
    // per-person option on a FRESH time (no row yet) via the shared helper. 0 when
    // not a slot or unset.
    slotCapacity: number;
    cancellation_window_hours: number;
    // Made-to-order only: notice needed, in days — gates the earliest bookable date.
    lead_time_days: number;
    hero: string | null;
    // The regions this provider covers, in their own words — a line on the card.
    // Informational since coverage stopped filtering; empty for a provider who
    // predates the region picker.
    areas: string[];
    // The only honest trust signal we can show today: how many confirmed
    // bookings this provider has taken through the site. Zero reads as "New
    // here" on the card rather than as nothing — a stranger booking a chef into
    // their cottage deserves to know which it is. (There are no provider reviews
    // yet; when there are, they lead and this becomes the secondary line.)
    bookingsCount: number;
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

    const { data: rows } = await admin
        .from('service_providers')
        .select('id, owner_id, business_name, provider_name, based_line, headshot, trade, custom_label, stripe_mcc, description, status, stripe_payouts_enabled, shape, slot_length_minutes, slot_capacity, slot_min_people, cancellation_window_hours, lead_time_days, dietary_note, guest_details')
        .eq('audience', 'guest').eq('status', 'approved').eq('stripe_payouts_enabled', true);

    const ids = (rows || []).map((r: any) => r.id);
    if (!ids.length) return { open: true, stay: staySpan(booking), listing: { id: listing.id, location: listing.location }, providers: [] };

    // The byline (first name) comes from the owner's profile, live, so it tracks
    // the name and the show_full_name switch rather than a stored snapshot.
    const ownerIds = Array.from(new Set((rows || []).map((r: any) => r.owner_id).filter(Boolean)));
    const { data: ownerProfiles } = ownerIds.length
        ? await admin.from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', ownerIds)
        : { data: [] as any[] };
    const profileById: Record<string, any> = {};
    for (const pr of ownerProfiles || []) profileById[pr.id] = pr;

    const [{ data: areas }, { data: itemRows }, { data: avail }, { data: blocks }, { data: sessRows }, { data: orderRows }] = await Promise.all([
        admin.from('service_areas').select('provider_id, label').in('provider_id', ids),
        admin.from('service_provider_items').select('id, provider_id, name, description, price, unit, image, sort_order, created_at')
            .in('provider_id', ids).eq('active', true).gt('price', 0)
            .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
        admin.from('slot_availability').select('provider_id, day_of_week, open_time, close_time').in('provider_id', ids),
        admin.from('slot_blocks').select('provider_id, blocked_date').in('provider_id', ids),
        admin.from('slot_sessions').select('provider_id, session_date, session_time, capacity, seats_taken, private').in('provider_id', ids),
        // Confirmed bookings taken, for the trust count. Only 'confirmed' counts:
        // a held request that was never answered, or one that was cancelled or
        // refunded, is not a booking someone completed with this provider.
        admin.from('service_orders').select('provider_id, status').in('provider_id', ids).eq('status', 'confirmed'),
    ]);

    const by = <T,>(list: any[], key: string) => {
        const m: Record<string, T[]> = {};
        for (const r of list || []) (m[r[key]] = m[r[key]] || []).push(r);
        return m;
    };
    const areasBy = by<any>(areas, 'provider_id');
    const itemsBy = by<any>(itemRows, 'provider_id');
    const bookingsCountBy: Record<string, number> = {};
    for (const o of orderRows || []) bookingsCountBy[o.provider_id] = (bookingsCountBy[o.provider_id] || 0) + 1;
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

        const shape = shapeOf(p);
        let sessions: MpSession[] = [];
        if (shape === 'slot') {
            // The pinned seat row for a (date,time), if anyone has booked it. A
            // fresh time has none and is open to any option. Whichever option
            // established a time also pinned its capacity and mode, so the row is
            // read as-is — not recomputed from one item's unit, which was the old
            // bug (it sized every time by items[0] and ignored the mode).
            const rowByKey: Record<string, { capacity: number; seats_taken: number; private: boolean }> = {};
            for (const s of sessBy[p.id] || []) {
                // session_time comes back from the time column as "HH:MM:SS";
                // generateSessions keys are "HH:MM", so normalise or the row never
                // matches its generated time and a booked slot reads as empty.
                rowByKey[s.session_date + ' ' + String(s.session_time).slice(0, 5)] = {
                    capacity: Number(s.capacity), seats_taken: Number(s.seats_taken), private: Boolean(s.private),
                };
            }
            const units = items.map((it: MpItem) => it.unit);
            sessions = generateSessions(
                (availBy[p.id] || []).map((a: any) => ({ day_of_week: a.day_of_week, open_time: a.open_time, close_time: a.close_time })),
                (blocksBy[p.id] || []).map((b: any) => b.blocked_date),
                Number(p.slot_length_minutes) || 60, fromKey, toKey,
            )
                .filter((s) => new Date(s.date + 'T' + s.time + ':00Z').getTime() > nowMs)
                .map((s) => ({ date: s.date, time: s.time, row: rowByKey[s.date + ' ' + s.time] || null }))
                // Drop a time only when it is closed to EVERY option this provider
                // offers (a private hire taken, or a shared table too full for its
                // minimum). A time still bookable by SOME option stays — the panel
                // greys the options it isn't bookable by, per the shared helper.
                .filter((s) => !sessionClosedToAll(s.row, units, p));
            // A slot with no bookable session in the stay is not shown.
            if (!sessions.length) continue;
        }

        providers.push({
            id: p.id,
            business_name: p.business_name,
            byline: firstName(profileById[p.owner_id] || null, ''),
            provider_name: p.provider_name,
            based_line: p.based_line,
            headshot: p.headshot ? getImageUrl(p.headshot) : null,
            category: guestCategory(p),
            isFood: isFoodProvider(p),
            dietary_note: p.dietary_note || null,
            dietary_options: knownDietaryOptions((p.guest_details && Array.isArray(p.guest_details.dietary_options)) ? p.guest_details.dietary_options : []),
            professional_title: (p.guest_details && p.guest_details.professional_title) || null,
            what_happens: (p.guest_details && p.guest_details.what_to_expect) || null,
            description: p.description,
            shape,
            priceFrom: Math.min(...items.map((i: MpItem) => i.price)),
            items,
            sessions,
            // The per-person minimum for the whole slot (the helper applies it only
            // to a per-person option, so it is safe to pass for a 'both' provider
            // whose items[0] happens to be the flat one).
            minPeople: shape === 'slot' ? Math.max(1, Number(p.slot_min_people) || 1) : 1,
            slotCapacity: shape === 'slot' ? Math.max(0, Number(p.slot_capacity) || 0) : 0,
            cancellation_window_hours: Number(p.cancellation_window_hours) || 48,
            lead_time_days: Number(p.lead_time_days) || 0,
            hero: (items.find((i: MpItem) => i.image) || {}).image || null,
            areas: (areasBy[p.id] || []).map((a: any) => a.label).filter(Boolean),
            bookingsCount: bookingsCountBy[p.id] || 0,
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
