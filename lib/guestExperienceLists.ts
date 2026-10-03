import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { getImageUrl } from '@/lib/utils';
import { directionsUrl, appleDirectionsUrl } from '@/lib/directions';
import { experienceBookingTitle } from '@/lib/experienceBookingTitle';

// A guest's own experience orders, either side of today — read with the
// service role because a guest has no read on service_orders.
//
//   items    — confirmed orders whose day has PASSED and aren't yet reviewed,
//              for the review-prompt cards (ReviewPrompts).
//   upcoming — confirmed orders still to COME, nearest first, for the "Your
//              upcoming experience" card on the home page (UpcomingExperience).
//
// Takes a user id the CALLER has already verified. Two callers: the
// /api/services/to-review route, and the home page, which reads it on the server
// so the card is in the first paint. The home page used to call the route's own
// GET for this — and a route handler's Supabase client writes refreshed session
// cookies, which a page is not allowed to do, so a signed-in visitor whose token
// needed refreshing threw "Cookies can only be modified in a Server Action or
// Route Handler" and lost the card. Each caller now identifies the user its own
// way and shares only this.
export async function guestExperienceLists(userId: string): Promise<{ items: any[]; upcoming: any[] }> {
    if (!guestExperiencesOpen()) {
        return { items: [], upcoming: [] };
    }

    const admin = adminClient();
    const today = new Date().toISOString().slice(0, 10);

    // Past (to review) and future (upcoming), in one round trip each.
    const [{ data: pastOrders }, { data: futureOrders }] = await Promise.all([
        admin
            .from('service_orders')
            .select('id, item_id, item_name, provider_id, provider_business_name, shape, service_date, service_time')
            .eq('guest_id', userId)
            .eq('status', 'confirmed')
            .lt('service_date', today)
            .order('service_date', { ascending: false }),
        admin
            .from('service_orders')
            .select('id, item_id, item_name, provider_id, provider_business_name, shape, service_date, service_time')
            .eq('guest_id', userId)
            .eq('status', 'confirmed')
            .gte('service_date', today)
            .order('service_date', { ascending: true })
            .order('service_time', { ascending: true, nullsFirst: true }),
    ]);

    const past = pastOrders || [];
    const future = futureOrders || [];

    // Drop past orders already reviewed, so a review-prompt disappears the
    // moment its review is posted. (Upcoming can't have been reviewed yet.)
    let toReview = past;
    if (past.length) {
        const { data: reviewed } = await admin
            .from('reviews')
            .select('order_id')
            .eq('reviewer_id', userId)
            .in('order_id', past.map((o) => o.id));
        const done = new Set((reviewed || []).map((r) => r.order_id));
        toReview = past.filter((o) => !done.has(o.id));
    }

    if (toReview.length === 0 && future.length === 0) {
        return { items: [], upcoming: [] };
    }

    // One photo lookup across both sets: the item's own image, else the
    // provider's first photo, else their headshot — so a card always has an
    // image to lift.
    const all = [...toReview, ...future];
    const itemIds = Array.from(new Set(all.map((o) => o.item_id).filter(Boolean)));
    const providerIds = Array.from(new Set(all.map((o) => o.provider_id).filter(Boolean)));

    const [{ data: items }, { data: providers }] = await Promise.all([
        itemIds.length
            ? admin.from('service_provider_items').select('id, image').in('id', itemIds)
            : Promise.resolve({ data: [] as any[] }),
        providerIds.length
            ? admin.from('service_providers').select('id, photos, headshot, collection_street, collection_postcode, collection_town').in('id', providerIds)
            : Promise.resolve({ data: [] as any[] }),
    ]);

    const itemImageById = new Map((items || []).map((it) => [it.id, it.image as string | null]));
    const providerById = new Map((providers || []).map((p) => [p.id, p]));

    const photoFor = (o: any): string | null => {
        const prov = o.provider_id ? providerById.get(o.provider_id) : null;
        const raw = itemImageById.get(o.item_id)
            || (prov && Array.isArray(prov.photos) && prov.photos[0])
            || (prov && prov.headshot)
            || null;
        return raw ? getImageUrl(raw) : null;
    };

    // Comes-to-you leads with the listing name and shows its chosen item on
    // the line beneath; every other shape keeps the item name as the title
    // with the provider beneath (unchanged).
    const reviewShape = (o: any) => {
        const { title, detail } = experienceBookingTitle(o);
        return {
            orderId: o.id,
            title,
            providerName: detail ?? (o.provider_business_name || null),
            serviceDate: o.service_date,
            photo: photoFor(o),
        };
    };
    // Directions to the experience's venue — Google + Apple, built the same
    // way (and by the same lib) as the cottage trip card. There's no
    // what3words for an experience (that's a cottage field), so the picker
    // shows two options, not three.
    //
    // Only a FIXED VENUE has somewhere to navigate to: its address is the
    // provider's collection_street/town/postcode. A comes-to-you provider
    // travels to the guest, so it has no collection address, lib/directions
    // returns null, and the card shows no button — rather than a broken one
    // pointing at the guest's own cottage. The town alone is never enough
    // either (lib/directions' "never the town centre" rule).
    const directionsFor = (o: any): { google: string | null; apple: string | null } | null => {
        const prov = o.provider_id ? providerById.get(o.provider_id) : null;
        if (!prov) return null;
        const parts = {
            streetAddress: (prov as any).collection_street,
            postcode: (prov as any).collection_postcode,
            location: (prov as any).collection_town,
        };
        const google = directionsUrl(parts);
        const apple = appleDirectionsUrl(parts);
        return (google || apple) ? { google, apple } : null;
    };

    const upcomingShape = (o: any) => {
        const { title, detail } = experienceBookingTitle(o);
        return {
            orderId: o.id,
            title,
            providerName: detail ?? (o.provider_business_name || null),
            serviceDate: o.service_date,
            serviceTime: o.service_time || null,
            photo: photoFor(o),
            directions: directionsFor(o),
        };
    };

    return {
        items: toReview.map(reviewShape),
        upcoming: future.map(upcomingShape),
    };
}
