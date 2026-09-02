// Calendar day keys, done once, done right.
//
// A "day key" is a 'yyyy-mm-dd' string standing for a calendar day — a check-in
// date, "today", a cancellation deadline. The repo kept deriving them by
// flooring a Date to local midnight and calling toISOString().split('T')[0].
// That is wrong whenever local time is AHEAD of UTC — every British Summer Time
// month — because local midnight is the previous day in UTC, so the key comes
// out a day early. It also breaks across the DST transitions, where adding a day
// to an instant does not add a calendar day.
//
// The fix is to stop going through instants. Read the wall-clock parts in the
// zone you mean (Europe/London — the business's day), and do day arithmetic on
// the parts. These four functions are the ONLY implementation of that idea the
// repo should contain; everything that needs a day key comes here.

const LONDON = 'Europe/London';

// Cached — constructing an Intl.DateTimeFormat is not free, and this is called
// per row on some pages.
const londonParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

// The London calendar day of an instant (default: now), as 'yyyy-mm-dd'. Built
// from formatToParts so it is immune to how a locale orders or punctuates a
// date. Works the same in Node and the browser, on a UTC server or a London
// laptop, because the zone is named, not inherited from the runtime.
export function londonDayKey(at: Date = new Date()): string {
    const parts = londonParts.formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

// A day key shifted by whole calendar days, on the parts — never by adding
// milliseconds to an instant, which loses or gains an hour across a DST change
// and can land on the wrong day. Anchored at UTC noon so the ±1h of a clock
// change can never cross a day boundary.
export function shiftDayKey(key: string, days: number): string {
    const [y, m, d] = key.split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1, d, 12) + days * 86400000);
    const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(at.getUTCDate()).padStart(2, '0');
    return `${at.getUTCFullYear()}-${mm}-${dd}`;
}

// Whole calendar days from `fromKey` to `toKey` (negative if `toKey` is earlier).
// Pure part arithmetic, so no zone or clock change can bend the count.
export function daysBetweenKeys(fromKey: string, toKey: string): number {
    const [fy, fm, fd] = fromKey.split('-').map(Number);
    const [ty, tm, td] = toKey.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

// A day key as "1 October 2026", the way the site writes dates. Formatted from
// the parts, with no Date and no zone, so the string can never drift from the
// key it names.
export function ukLongDate(key: string): string {
    const [y, m, d] = key.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
}
