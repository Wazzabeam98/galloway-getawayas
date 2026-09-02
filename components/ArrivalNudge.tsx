import { adminClient } from '@/lib/supabaseAdmin';
import { listingIdsFor } from '@/lib/access';
import ArrivalNudgeCard from '@/components/ArrivalNudgeCard';

// One nudge, never four. A host with several cottages must not be nagged about
// each — that turns the nudge off for good — so this shows only the SOONEST
// upcoming arrival at a listing they can edit whose "last bit" is still empty.
//
// "Upcoming booking" is the trips page's own test, not a second one: a confirmed
// booking that has not ended. pending_payment is not a booking, so status must be
// 'confirmed'. Ordered by check-in, soonest first.
//
// Dismissal is derived, like an archived conversation: a dismissal holds until a
// newer booking arrives for that listing (one created after the dismissal), then
// the nudge returns. It disappears on its own once the field is filled.
export default async function ArrivalNudge({ userId }: { userId: string }) {
    if (!userId) return null;
    const admin = adminClient();

    const editable = await listingIdsFor(userId, 'can_listing');
    if (!editable.length) return null;

    const todayKey = new Date().toISOString().slice(0, 10);
    const { data: bookings } = await admin
        .from('bookings')
        .select('id, listing_id, check_in, created_at')
        .in('listing_id', editable)
        .eq('status', 'confirmed')
        .gte('check_in', todayKey)
        .order('check_in', { ascending: true });
    if (!bookings || !bookings.length) return null;

    const listingIds = Array.from(new Set(bookings.map((b: any) => b.listing_id)));

    // Which listings already have the "last bit" filled — those never nudge.
    const { data: arrivals } = await admin
        .from('listing_arrival').select('listing_id, arrival_directions').in('listing_id', listingIds);
    const filled = new Set(
        (arrivals || []).filter((a: any) => a.arrival_directions && String(a.arrival_directions).trim()).map((a: any) => a.listing_id)
    );

    // This host's dismissals for these listings.
    const { data: prefs } = await admin
        .from('arrival_nudge_prefs').select('listing_id, dismissed_at').eq('user_id', userId).in('listing_id', listingIds);
    const dismissedAt: Record<string, string> = {};
    (prefs || []).forEach((p: any) => { if (p.dismissed_at) dismissedAt[p.listing_id] = p.dismissed_at; });

    // A listing is suppressed if it was dismissed and no upcoming booking has been
    // made since — the moment a newer one arrives, the dismissal no longer covers it.
    const suppressed = (listingId: string): boolean => {
        const d = dismissedAt[listingId];
        if (!d) return false;
        const dm = new Date(d).getTime();
        const hasNewer = bookings.some((b: any) => b.listing_id === listingId && new Date(b.created_at).getTime() > dm);
        return !hasNewer;
    };

    const candidate = bookings.find((b: any) => !filled.has(b.listing_id) && !suppressed(b.listing_id));
    if (!candidate) return null;

    const { data: listing } = await admin.from('listings').select('title').eq('id', candidate.listing_id).maybeSingle();

    return (
        <ArrivalNudgeCard
            listingId={candidate.listing_id}
            title={(listing && listing.title) || 'a cottage'}
            checkIn={candidate.check_in}
        />
    );
}
