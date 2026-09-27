import { adminClient } from '@/lib/supabaseAdmin';
import { dateFromKey, dateKey } from '@/lib/pricing';
import { fetchIcalText } from '@/lib/feedFetch';

// Dates taken on Airbnb, Booking.com and anything else a host syncs.
//
// One module because search and checkout have to answer the same question the
// same way. If they drift, search shows a stay as free that checkout then
// refuses at the payment step, and the guest is the one who finds out. Same
// reasoning as lib/pricing.ts being the only place a total is worked out.
//
// The rows behind this live in `listing_ical_feeds`, which has a single RLS
// policy: the host of the listing and nobody else. Anything reading it needs
// the service-role client. RLS does not raise for a non-host, it returns no
// rows — so an ordinary client here would block nothing and look fine.

export type IcalEvent = { start: string; end: string };

// Parse an .ics feed body into the { start, end } events this module reasons
// about — the same shape and the same DATE handling as the cron's own parser
// (app/api/cron/ical-sync). Kept here so checkout can re-parse a freshly-fetched
// feed with identical logic and never disagree with the cached column.
export function parseIcsEvents(text: string): IcalEvent[] {
    const events: IcalEvent[] = [];
    const blocks = String(text || '').split('BEGIN:VEVENT').slice(1);
    for (const block of blocks) {
        const startMatch = block.match(/DTSTART[^:]*:(\d{8})/);
        const endMatch = block.match(/DTEND[^:]*:(\d{8})/);
        if (!startMatch || !endMatch) continue;
        const toISO = (raw: string) => raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
        events.push({ start: toISO(startMatch[1]), end: toISO(endMatch[1]) });
    }
    return events;
}

// Fetch a feed's current events LIVE. Returns null (not an empty list) when the
// feed can't be read, so a caller can tell "reachable and genuinely empty" from
// "couldn't check" and fall back to the cached column rather than either
// blocking a real booking on a momentary outage or trusting stale data.
//
// Goes through fetchIcalText (lib/feedUrl), which enforces public-https-only and
// refuses private/loopback/link-local/metadata addresses and redirects to them —
// this runs on a HOST-SUPPLIED url inside the checkout request, so it must not be
// coaxable into fetching an internal service. Three-second timeout: right before
// payment, a slow feed must not hold the guest up — the cached column carries it.
export async function fetchLiveIcalEvents(url: string, timeoutMs = 3000): Promise<IcalEvent[] | null> {
    if (!url) return null;
    const text = await fetchIcalText(url, { timeoutMs });
    if (text === null) return null;
    return parseIcsEvents(text);
}

// An iCal event runs from its arrival date to its checkout date, and the
// checkout date is itself free — the same convention as a booking here. So
// [10th, 14th) takes the nights of the 10th, 11th, 12th and 13th, and somebody
// else may arrive on the 14th.
export function blockedNightsFromEvents(events: IcalEvent[] | null | undefined): Set<string> {
    const nights = new Set<string>();

    (events || []).forEach((event) => {
        if (!event || !event.start || !event.end) return;

        const from = dateFromKey(event.start);
        const to = dateFromKey(event.end);

        const day = new Date(from.getTime());
        while (day < to) {
            nights.add(dateKey(day));
            day.setDate(day.getDate() + 1);
        }
    });

    return nights;
}

// Does a stay from `from` to `to` need any of the nights in `blocked`?
// Counts nights, not days: a stay from the 11th to the 13th needs the 11th and
// the 12th, and leaves on the morning of the 13th.
export function rangeHitsBlockedNight(blocked: Set<string>, from: string, to: string): boolean {
    const start = dateFromKey(from);
    const end = dateFromKey(to);

    const day = new Date(start.getTime());
    while (day < end) {
        if (blocked.has(dateKey(day))) return true;
        day.setDate(day.getDate() + 1);
    }

    return false;
}

// Which of these listings are taken on another platform for these dates.
//
// Ids in, ids out. The events themselves never leave this function, and the
// select never asks for `url` — a host's export link is a URL that lets anyone
// read that host's bookings, and this is called from a page that renders for
// the public. The allowlist is the second lock, not the first: the first is
// that nothing here is returned to the caller except listing ids.
export async function icalBlockedListingIds(
    listingIds: string[],
    from: string,
    to: string
): Promise<Set<string>> {
    const blocked = new Set<string>();

    if (!listingIds.length || !from || !to) return blocked;

    // Service-role on purpose. See the note at the top of this file — the
    // ordinary client returns an empty list here rather than an error.
    const admin = adminClient();

    const { data: feeds } = await admin
        .from('listing_ical_feeds')
        .select('listing_id, events')
        .in('listing_id', listingIds);

    (feeds || []).forEach((feed: any) => {
        if (blocked.has(feed.listing_id)) return;

        const nights = blockedNightsFromEvents(feed.events);
        if (rangeHitsBlockedNight(nights, from, to)) blocked.add(feed.listing_id);
    });

    return blocked;
}
