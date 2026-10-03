// Deleting a listing, or only hiding it — which one a host is offered.
//
// The rule, the way Airbnb has it: a listing that has NEVER had a booking can
// be deleted outright. A listing with any booking at all — past, future,
// cancelled, or a checkout somebody started and walked away from — can only be
// hidden, because the booking and the money records hang off it and have to
// survive (the privacy policy promises six years). An experience order tied to
// a stay at the listing counts the same way.
//
// One answer, read by the dashboard to choose the button and by
// /api/listings/delete to refuse, so the button never offers a delete the
// route then turns down. Underneath both, bookings.listing_id is ON DELETE
// RESTRICT (20260902054715) and service_orders.listing_id has no cascade, so
// the database refuses the delete too if a booking lands in between.
//
// Kept free of '@/' imports so the unit tests can load it directly.

export type Removal = 'delete' | 'hide';

export const HAS_BOOKINGS_MESSAGE =
    'This listing has bookings, so it can’t be deleted — the booking and payment records have to be kept. You can hide it instead.';

// Which of the given listings have any booking or experience order against
// them. Throws on a failed read rather than answering "none": a wrong "none"
// is what would let a booked listing be deleted.
export async function listingsWithRecords(admin: any, ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (!ids.length) return out;

    const [bookings, orders] = await Promise.all([
        admin.from('bookings').select('listing_id').in('listing_id', ids),
        admin.from('service_orders').select('listing_id').in('listing_id', ids),
    ]);
    if (bookings.error) throw bookings.error;
    if (orders.error) throw orders.error;

    (bookings.data || []).forEach((r: any) => { if (r.listing_id) out.add(r.listing_id); });
    (orders.data || []).forEach((r: any) => { if (r.listing_id) out.add(r.listing_id); });
    return out;
}

export function removalFor(hasRecords: boolean): Removal {
    return hasRecords ? 'hide' : 'delete';
}

// The storage objects a deleted listing leaves behind: its own image paths,
// less any another listing still points at (an import or a copy can share a
// path, and that listing's photo must not vanish with this one).
export function photosToRemove(images: unknown, stillUsedElsewhere: string[]): string[] {
    if (!Array.isArray(images)) return [];
    const keep = new Set(stillUsedElsewhere);
    const out: string[] = [];
    images.forEach((p) => {
        if (typeof p !== 'string' || !p.trim()) return;
        // A full URL is not a path in our bucket — nothing of ours to remove.
        if (/^https?:\/\//i.test(p)) return;
        if (keep.has(p) || out.indexOf(p) !== -1) return;
        out.push(p);
    });
    return out;
}
