// THE NIGHT-LEVEL AVAILABILITY WALL — shared so a date CHANGE passes exactly the
// same one a NEW booking does at checkout (AUDIT 2026-10-31 C2).
//
// The checkout route (app/api/stripe/checkout) refuses a stay whose nights are
// taken: another Galloway booking (pending or confirmed), a host block
// (calendar_overrides), a night sold on another platform (iCal — re-fetched LIVE,
// not just the cached column), or a night preparation time keeps free around
// another stay. The "change dates" flow checked none of that — only the
// exclusion constraint, which fires confirmed-vs-confirmed only — so a guest
// could move a confirmed stay onto host-blocked or Airbnb-sold nights.
//
// This factors that wall out of checkout's own ingredients — the SAME library
// functions checkout imports (blockedNightsFromEvents, fetchLiveIcalEvents,
// prepBufferNights / prepDays) — so the change route and the respond route reach
// the same verdict from the same inputs. It is night-level only: the stay-rules
// policy (minimum, maximum, changeover, notice, window) is enforced separately,
// because a change keeps the deliberate exemptions a new booking has no concept
// of (the unchanged end of the stay, a guest-count-only change).

import { blockedNightsFromEvents, fetchLiveIcalEvents } from '@/lib/availability';
import { prepBufferNights, prepDays, addDaysKey, nightsBetweenKeys, type StayRulesListing } from '@/lib/stayRules';

export interface AvailabilityProblem { status: number; error: string; }

const TAKEN: AvailabilityProblem = {
    status: 409,
    error: 'Sorry — those dates have just been taken. Please pick different ones.',
};

/**
 * null when every night of [checkInKey, checkOutKey) is free to this booking,
 * otherwise the same refusal checkout gives. `excludeBookingId` drops the
 * booking being changed from the "other stays", so a change does not clash with
 * the nights it is itself vacating. The LIVE iCal re-fetch mirrors checkout: a
 * feed reachable now decides on its fresh events; one that cannot be reached
 * falls back to its last sync rather than blocking a real change on an outage.
 */
export async function nightsTakenProblem(admin: any, opts: {
    listingId: string;
    listing: StayRulesListing;
    checkInKey: string;
    checkOutKey: string;
    excludeBookingId?: string | null;
}): Promise<AvailabilityProblem | null> {
    const { listingId, listing, checkInKey, checkOutKey } = opts;
    const nights = nightsBetweenKeys(checkInKey, checkOutKey);
    if (nights <= 0) return { status: 400, error: 'Those dates don’t make a valid stay.' };

    let stays = admin.from('bookings')
        .select('id, check_in, check_out')
        .eq('listing_id', listingId)
        .in('status', ['pending', 'confirmed']);
    if (opts.excludeBookingId) stays = stays.neq('id', opts.excludeBookingId);

    const [staysRes, overridesRes, feedsRes] = await Promise.all([
        stays,
        admin.from('calendar_overrides').select('date').eq('listing_id', listingId).eq('is_blocked', true),
        admin.from('listing_ical_feeds').select('id, url, events').eq('listing_id', listingId),
    ]);

    const otherRanges = ((staysRes.data as any[]) || []).map((b) => ({
        start: String(b.check_in).slice(0, 10),
        end: String(b.check_out).slice(0, 10),
    }));

    const blocked = new Set<string>();
    // Every other stay's nights.
    blockedNightsFromEvents(otherRanges).forEach((n) => blocked.add(n));
    // The host's blocked nights (owner use / maintenance).
    ((overridesRes.data as any[]) || []).forEach((o) => blocked.add(String(o.date).slice(0, 10)));
    // Preparation time around the OTHER stays.
    const prep = prepDays(listing);
    if (prep > 0) prepBufferNights(otherRanges, prep).forEach((n) => blocked.add(n));

    // iCal — the cached events, then the live re-fetch on top (same as checkout).
    const feeds = (feedsRes.data as any[]) || [];
    const live = await Promise.all(feeds.map((f) => fetchLiveIcalEvents(String(f.url || ''))));
    feeds.forEach((f, i) => {
        const events = live[i] !== null ? live[i] : f.events;
        blockedNightsFromEvents(events).forEach((n) => blocked.add(n));
    });

    for (let i = 0; i < nights; i++) {
        if (blocked.has(addDaysKey(checkInKey, i))) return TAKEN;
    }
    return null;
}
