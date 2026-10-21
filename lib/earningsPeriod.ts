// The period an Earnings page opens on, for a host and a provider alike: this
// calendar year — but never before the month the account was created, so
// someone who joined in October opens on October to December, not on nine
// empty months (Liam, 21 Oct 2026). From the January after they joined, it is
// the whole year. A from/to the viewer picked always wins; this is only the
// default. Day keys are YYYY-MM-DD, in UK time.

import { londonDayKey } from './dayKey';

export function defaultEarningsPeriod(accountCreatedAt: string | null | undefined, todayKey: string): { from: string; to: string } {
    const year = String(todayKey).slice(0, 4);
    const yearStart = `${year}-01-01`;
    // The creation MONTH in UK time, not UTC. created_at is a raw UTC timestamp,
    // and slicing it would put a late-evening signup on the last of a month into
    // the wrong month: 23:30 UTC on 30 June is already 1 July in London, so the
    // naive slice opened the default a whole month too early. Convert to the
    // London day key first, the way the rest of the site keys its days.
    const created = toLondonMonth(accountCreatedAt);
    const monthStart = created ? `${created}-01` : '';
    return {
        from: monthStart && monthStart > yearStart && monthStart <= todayKey ? monthStart : yearStart,
        to: `${year}-12-31`,
    };
}

// 'YYYY-MM' of the instant in UK local time, or '' if it is missing or unparseable.
function toLondonMonth(ts: string | null | undefined): string {
    if (!ts) return '';
    const d = new Date(ts);
    return isNaN(d.getTime()) ? '' : londonDayKey(d).slice(0, 7);
}
