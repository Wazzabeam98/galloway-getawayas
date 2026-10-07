// Deleting a listing, or only hiding it — which one a host is offered.
//
// The rule, the way Airbnb has it: a listing can be deleted outright until it
// has taken money. A listing with a PAID booking — even one later cancelled or
// refunded — can only be hidden, because that payment record has to survive
// (the privacy policy promises six years), and the same for a paid experience
// order tied to a stay there. What does NOT lock a listing down: imported
// calendar dates, blocked dates, and checkouts somebody started and walked
// away from without ever paying. Those took no money, so there is no record to
// keep and nothing to stop a delete.
//
// One answer, read by the dashboard to choose the button and by
// /api/listings/delete to refuse, so the button never offers a delete the
// route then turns down. The foreign keys (bookings.listing_id ON DELETE
// RESTRICT — 20260902054715 — and service_orders.listing_id with no cascade)
// refuse a delete while ANY row points at the listing, paid or not, so the
// route clears the unpaid rows first (clearUnpaidRecords) and a paid row that
// lands in between is still caught by the foreign key.
//
// Kept free of '@/' imports so the unit tests can load it directly.

export type Removal = 'delete' | 'hide';

export const HAS_BOOKINGS_MESSAGE =
    'This listing has a paid booking, so it can’t be deleted — the booking and payment records have to be kept. You can hide it instead.';

// A booking that ever took money. payment_status settles to one of these the
// moment a deposit or a full payment succeeds (lib/settlePaidBooking), and a
// later refund moves it to refunded/partially_refunded — all of which must be
// kept. amount_paid and paid_at are belt-and-braces: any of the three being
// set means money moved. An 'unpaid' row with £0 paid and no paid_at never did
// — that is an abandoned or cancelled checkout.
const PAID_BOOKING_STATUSES = ['paid', 'deposit_paid', 'refunded', 'partially_refunded'];
export function bookingTookMoney(b: any): boolean {
    if (!b) return false;
    if (Number(b.amount_paid) > 0) return true;
    if (b.paid_at) return true;
    return PAID_BOOKING_STATUSES.indexOf(b.payment_status) !== -1;
}

// An experience order that ever took money. A hold confirms to authorised or
// confirmed once paid, and carries a Stripe payment intent from that point; a
// refund keeps the row as refunded. A 'holding'/'expired'/'declined' order
// with no payment intent never took money.
const PAID_ORDER_STATUSES = ['authorised', 'confirmed', 'refunded'];
export function orderTookMoney(o: any): boolean {
    if (!o) return false;
    if (o.stripe_payment_intent_id) return true;
    return PAID_ORDER_STATUSES.indexOf(o.status) !== -1;
}

// Which of the given listings have taken money — a paid booking or a paid
// experience order. Only those are hide-only. Throws on a failed read rather
// than answering "none": a wrong "none" is what would let a paid listing be
// deleted.
export async function listingsWithPaidRecords(admin: any, ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (!ids.length) return out;

    const [bookings, orders] = await Promise.all([
        admin.from('bookings').select('listing_id, payment_status, amount_paid, paid_at').in('listing_id', ids),
        admin.from('service_orders').select('listing_id, status, stripe_payment_intent_id').in('listing_id', ids),
    ]);
    if (bookings.error) throw bookings.error;
    if (orders.error) throw orders.error;

    (bookings.data || []).forEach((r: any) => { if (r.listing_id && bookingTookMoney(r)) out.add(r.listing_id); });
    (orders.data || []).forEach((r: any) => { if (r.listing_id && orderTookMoney(r)) out.add(r.listing_id); });
    return out;
}

// Clear the never-paid rows that still point at a listing so it can be deleted.
// Called only after listingsWithPaidRecords has confirmed the listing took no
// money, so every booking/order here is an abandoned or cancelled checkout that
// never paid — removing it loses no payment record. A row that took money is
// never deleted: it would have made the listing hide-only before this ran, and
// the delete works off the exact ids read as unpaid, so a paid row landing in
// between is left for the foreign key to refuse. Orders go before bookings
// because a slot order can reference a booking (service_orders.booking_id).
export async function clearUnpaidRecords(admin: any, listingId: string): Promise<void> {
    const [bookings, orders] = await Promise.all([
        admin.from('bookings').select('id, payment_status, amount_paid, paid_at').eq('listing_id', listingId),
        admin.from('service_orders').select('id, status, stripe_payment_intent_id').eq('listing_id', listingId),
    ]);
    if (bookings.error) throw bookings.error;
    if (orders.error) throw orders.error;

    const unpaidOrderIds = (orders.data || []).filter((r: any) => !orderTookMoney(r)).map((r: any) => r.id);
    const unpaidBookingIds = (bookings.data || []).filter((r: any) => !bookingTookMoney(r)).map((r: any) => r.id);

    if (unpaidOrderIds.length) {
        const { error } = await admin.from('service_orders').delete().in('id', unpaidOrderIds);
        if (error) throw error;
    }
    if (unpaidBookingIds.length) {
        const { error } = await admin.from('bookings').delete().in('id', unpaidBookingIds);
        if (error) throw error;
    }
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

export type DeleteOutcome = 'deleted' | 'must_hide' | 'gone';

// Deleting a listing for good, once the caller has decided who may. The one
// sequence both doors use — the host's own Delete (/api/listings/delete) and
// the owner's Remove (/api/admin/listings/remove) — so they cannot drift:
//
//   refuse if it took money; clear the never-paid rows the foreign keys would
//   refuse over; delete the row (the database refuses too if a paid row has
//   landed since — 23503); and only then the tidying — message templates, and
//   the photos no other listing still uses — so a refused delete never loses
//   an image. A tidying failure is passed to `log`, never reported as a failed
//   delete: the listing is already gone by then.
//
// `ownerId`, when given, narrows the delete to that host's row — the host door
// passes it; the owner door does not, because it acts on somebody else's.
export async function deleteListingForGood(
    admin: any,
    listing: { id: string; images?: unknown },
    opts: { bucket: string; ownerId?: string; log: (what: string, err: unknown) => Promise<void> | void }
): Promise<DeleteOutcome> {
    const listingId = listing.id;

    const paid = await listingsWithPaidRecords(admin, [listingId]);
    if (paid.has(listingId)) return 'must_hide';

    await clearUnpaidRecords(admin, listingId);

    let del = admin.from('listings').delete().eq('id', listingId);
    if (opts.ownerId) del = del.eq('host_id', opts.ownerId);
    const { data: gone, error: deleteError } = await del.select('id');

    if (deleteError) {
        if (deleteError.code === '23503') return 'must_hide';
        throw deleteError;
    }
    if (!gone || !gone.length) return 'gone';

    // Message templates name their listings in an array, not a foreign key,
    // so nothing cascades there — take this id out of them.
    const { data: templates, error: tplError } = await admin
        .from('message_templates')
        .select('id, listing_ids')
        .contains('listing_ids', [listingId]);
    if (tplError) await opts.log('templates could not be read to drop the deleted listing', tplError);
    for (const t of templates || []) {
        const next = (t.listing_ids || []).filter((x: string) => x !== listingId);
        const { error } = await admin.from('message_templates').update({ listing_ids: next }).eq('id', t.id);
        if (error) await opts.log('a template still names the deleted listing', error);
    }

    // The photos. The bucket has no DELETE policy for hosts, so this is the
    // service role, and only for paths no other listing still uses.
    const own: string[] = Array.isArray(listing.images)
        ? (listing.images as unknown[]).filter((p): p is string => typeof p === 'string' && !!p)
        : [];
    if (own.length) {
        const { data: sharing } = await admin.from('listings').select('images').overlaps('images', own);
        const elsewhere: string[] = [];
        (sharing || []).forEach((l: any) => (l.images || []).forEach((p: string) => elsewhere.push(p)));

        const paths = photosToRemove(own, elsewhere);
        if (paths.length) {
            const { error: rmError } = await admin.storage.from(opts.bucket).remove(paths);
            if (rmError) await opts.log('the deleted listing’s photos could not be removed', rmError);
        }
    }

    return 'deleted';
}
