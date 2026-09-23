// The combined "Your trips" list: holiday-let STAYS and EXPERIENCE bookings for
// one signed-in account, together, split Upcoming / Past, soonest first. A
// stay's attached experiences sit with that stay; an experience booked on its
// own (no stay) gets its own card. Read with the service-role client — a guest
// cannot read service_orders directly, exactly as the dashboard cards do.

import { getImageUrl } from '@/lib/utils';
import { londonDayKey } from '@/lib/dayKey';
import { experienceBookingTitle } from '@/lib/experienceBookingTitle';

export interface TripExperience {
    id: string;
    title: string;
    providerName: string | null;
    date: string;
    time: string | null;
    photo: string | null;
    party: number | null;
    pending: boolean;      // an authorised request awaiting the provider
    // A made-to-order food order describes itself by WHAT and HOW, not a guest
    // count: how many items, and whether it's collection or delivery.
    shape: string;
    foodItems: number | null;       // total item quantity, made-to-order only
    fulfilment: string | null;      // 'collection' | 'delivery' | null
}
export interface TripStay {
    kind: 'stay';
    id: string;
    title: string;
    location: string | null;
    photo: string | null;
    checkIn: string;
    checkOut: string;
    guests: number | null;
    lat: number | null;
    lng: number | null;
    experiences: TripExperience[];
    sortKey: string;       // soonest-first key
}
export interface TripExperienceCard {
    kind: 'experience';
    exp: TripExperience;
    sortKey: string;
}
export type TripItem = TripStay | TripExperienceCard;

export interface TripsList {
    upcoming: TripItem[];
    past: TripItem[];
    // Coordinates to plot on the trips map (stays have them; experiences don't).
    points: Array<{ lat: number; lng: number; label: string; image: string | null }>;
}

function partyOf(o: any): number | null {
    const a = Number(o.attendees), q = Number(o.quantity);
    if (Number.isFinite(a) && a > 0) return a;
    if (Number.isFinite(q) && q > 0) return q;
    return null;
}

// The number of items in a made-to-order food order — the total quantity across
// its lines, ignoring the delivery-fee line (which has no item_id). Falls back to
// the order-level quantity if the frozen breakdown is somehow missing.
function foodItemsOf(o: any): number | null {
    const lines = Array.isArray(o.line_items) ? o.line_items : null;
    if (lines) {
        const n = lines
            .filter((l: any) => l && l.item_id)
            .reduce((s: number, l: any) => s + (Number(l.qty) || 0), 0);
        if (n > 0) return n;
    }
    const q = Number(o.quantity);
    return Number.isFinite(q) && q > 0 ? q : null;
}

export async function loadTripsList(admin: { from: (t: string) => any }, userId: string): Promise<TripsList> {
    const today = londonDayKey();

    // Stays — the account's own bookings, with their listing.
    const { data: bookings } = await admin
        .from('bookings')
        .select('id, listing_id, check_in, check_out, guests, adults, children, status')
        .eq('guest_id', userId)
        .neq('status', 'cancelled');
    const stayRows = bookings || [];

    const listingIds = Array.from(new Set(stayRows.map((b: any) => b.listing_id).filter(Boolean)));
    const { data: listings } = listingIds.length
        ? await admin.from('listings').select('id, title, images, location, latitude, longitude').in('id', listingIds)
        : { data: [] };
    const listingById = new Map<string, any>((listings || []).map((l: any) => [l.id, l]));

    // Experiences — the account's own orders that stand (confirmed, or an
    // authorised request awaiting the provider). Refunded / declined drop out.
    const { data: orders } = await admin
        .from('service_orders')
        .select('id, item_id, item_name, provider_id, provider_business_name, shape, service_date, service_time, booking_id, parent_order_id, status, attendees, quantity, fulfilment, line_items')
        .eq('guest_id', userId)
        .in('status', ['confirmed', 'authorised'])
        .is('parent_order_id', null);
    const orderRows = orders || [];

    // Photos for the experience cards: item image → provider photos[0] → headshot.
    const provIds = Array.from(new Set(orderRows.map((o: any) => o.provider_id).filter(Boolean)));
    const itemIds = Array.from(new Set(orderRows.map((o: any) => o.item_id).filter(Boolean)));
    const { data: provs } = provIds.length
        ? await admin.from('service_providers').select('id, photos, headshot').in('id', provIds)
        : { data: [] };
    const { data: items } = itemIds.length
        ? await admin.from('service_provider_items').select('id, image').in('id', itemIds)
        : { data: [] };
    const provById = new Map<string, any>((provs || []).map((p: any) => [p.id, p]));
    const itemById = new Map<string, any>((items || []).map((i: any) => [i.id, i]));

    function expPhoto(o: any): string | null {
        const it = itemById.get(o.item_id);
        if (it && it.image) return getImageUrl(it.image);
        const p = provById.get(o.provider_id);
        if (p && Array.isArray(p.photos) && p.photos[0]) return getImageUrl(p.photos[0]);
        if (p && p.headshot) return getImageUrl(p.headshot);
        return null;
    }
    function toExp(o: any): TripExperience {
        // Comes-to-you leads with the listing name and shows its chosen item on
        // the line beneath; every other shape keeps the item name as the title
        // with the provider beneath, as before.
        const { title, detail } = experienceBookingTitle(o);
        return {
            id: o.id,
            title,
            providerName: detail ?? (o.provider_business_name || null),
            date: String(o.service_date).slice(0, 10),
            time: o.service_time ? String(o.service_time).slice(0, 5) : null,
            photo: expPhoto(o),
            party: partyOf(o),
            pending: o.status === 'authorised',
            shape: o.shape || '',
            foodItems: o.shape === 'made_to_order' ? foodItemsOf(o) : null,
            fulfilment: o.fulfilment || null,
        };
    }

    // Group experiences by the stay they hang off (booking_id), keeping only the
    // stays this account actually owns; anything else is a standalone experience.
    const stayIds = new Set(stayRows.map((b: any) => b.id));
    const expByStay = new Map<string, TripExperience[]>();
    const standaloneExps: any[] = [];
    for (const o of orderRows) {
        if (o.booking_id && stayIds.has(o.booking_id)) {
            const arr = expByStay.get(o.booking_id) || [];
            arr.push(toExp(o));
            expByStay.set(o.booking_id, arr);
        } else {
            standaloneExps.push(o);
        }
    }

    const stayItems: TripStay[] = stayRows.map((b: any) => {
        const l = listingById.get(b.listing_id) || {};
        const photo = Array.isArray(l.images) && l.images[0] ? getImageUrl(l.images[0]) : null;
        const exps = (expByStay.get(b.id) || []).sort((a, c) => a.date.localeCompare(c.date));
        return {
            kind: 'stay' as const,
            id: b.id,
            title: l.title || 'Your stay',
            location: l.location || null,
            photo,
            checkIn: String(b.check_in).slice(0, 10),
            checkOut: String(b.check_out).slice(0, 10),
            guests: b.guests ?? null,
            lat: l.latitude != null ? Number(l.latitude) : null,
            lng: l.longitude != null ? Number(l.longitude) : null,
            experiences: exps,
            sortKey: String(b.check_in).slice(0, 10),
        };
    });

    const expItems: TripExperienceCard[] = standaloneExps.map((o) => {
        const exp = toExp(o);
        return { kind: 'experience' as const, exp, sortKey: exp.date };
    });

    // Upcoming vs past. A stay is past once its last night has gone (check_out is
    // the leaving morning); an experience once its date has passed.
    const upcoming: TripItem[] = [];
    const past: TripItem[] = [];
    for (const s of stayItems) (s.checkOut >= today ? upcoming : past).push(s);
    for (const e of expItems) (e.exp.date >= today ? upcoming : past).push(e);

    upcoming.sort((a, b) => a.sortKey.localeCompare(b.sortKey));   // soonest first
    past.sort((a, b) => b.sortKey.localeCompare(a.sortKey));       // most recent first

    // Map points — the stays that carry a coordinate.
    const points = stayItems
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({ lat: s.lat as number, lng: s.lng as number, label: s.title, image: s.photo }));

    return { upcoming, past, points };
}
