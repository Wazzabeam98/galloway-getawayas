import { fetchIcalText } from '@/lib/feedFetch';
import { parseIcsEvents } from '@/lib/availability';

// Turning one imported feed into cached events + a status on its row is now done
// in exactly one place, so the every-15-minutes cron and the host's "Sync now"
// button cannot drift apart on what a successful or a failed sync writes. Same
// reasoning as lib/pricing.ts being the only place a total is worked out: two
// callers answering the same question two ways is how a feed looks synced on one
// screen and stale on another.
//
// A successful sync replaces `events` and clears the failure ladder. A failed one
// leaves the cached `events` ALONE — a calendar we can't reach today is not a
// calendar with no bookings, and treating it as empty would free up dates that
// are actually taken. The caller decides what to do about repeated failures
// (the cron emails the host after a few; a manual sync doesn't), so this returns
// the new consecutive-failure count rather than acting on it.

export type FeedRow = {
    id: string;
    url: string;
    label?: string | null;
    failure_count?: number | null;
};

export type FeedSyncResult = { ok: boolean; message?: string; failureCount: number };

export async function syncOneFeed(
    admin: any,
    feed: FeedRow,
    now: string,
    timeoutMs = 15000
): Promise<FeedSyncResult> {
    try {
        // The shared safe fetch: public-https only; private / loopback /
        // link-local / metadata addresses (and redirects to them) refused, so a
        // host-supplied url can't point the sync at an internal service. null
        // means unsafe OR unreachable — either way the feed failed this run.
        const text = await fetchIcalText(String(feed.url || ''), { timeoutMs });

        if (text === null) {
            throw new Error('That calendar link couldn’t be fetched (it must be a public https address)');
        }

        // A link to a web page or an image fetches happily and parses to nothing,
        // which would look like an empty calendar and block no dates at all.
        // Better to treat it as broken.
        if (text.indexOf('BEGIN:VCALENDAR') === -1) {
            throw new Error('That link doesn’t return a calendar');
        }

        const events = parseIcsEvents(text);

        await admin
            .from('listing_ical_feeds')
            .update({
                events: events,
                last_synced_at: now,
                last_status: 'ok',
                last_error: null,
                failure_count: 0,
                alerted_at: null,
            })
            .eq('id', feed.id);

        return { ok: true, failureCount: 0 };
    } catch (err: any) {
        const message = (err && err.message) || 'Could not reach that calendar';
        const count = Number(feed.failure_count || 0) + 1;

        // Cached events deliberately untouched — see the note at the top.
        await admin
            .from('listing_ical_feeds')
            .update({
                last_synced_at: now,
                last_status: 'failed',
                last_error: message,
                failure_count: count,
            })
            .eq('id', feed.id);

        return { ok: false, message: message, failureCount: count };
    }
}

// Run a batch of feed syncs with a cap on how many are in flight at once. The
// old cron awaited each feed in turn, so a dozen feeds at up to 15s each could
// never finish inside the 60s function limit and an arbitrary tail stayed stale
// (the gap the live re-check at checkout was added to paper over). Fetching them
// concurrently makes a run the length of its slowest feed, not the sum — but
// unbounded Promise.all on a host with many feeds would open as many sockets at
// once, so it's capped.
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;

    async function worker(): Promise<void> {
        while (true) {
            const i = next;
            next = next + 1;
            if (i >= items.length) return;
            out[i] = await fn(items[i]);
        }
    }

    const workers: Promise<void>[] = [];
    const n = Math.min(limit, items.length);
    for (let w = 0; w < n; w++) workers.push(worker());
    await Promise.all(workers);

    return out;
}
