// How close the site is to Resend's daily sending cap.
//
// WHY THIS EXISTS. The Resend account is on the free plan: 100 emails a day
// across EVERYTHING — booking confirmations, host and provider notices, admin
// alerts, and every sign-in code Supabase sends through Resend's SMTP. At the
// cap Resend refuses the rest of the day's mail, and nobody is told: a guest
// who has just paid simply never gets their confirmation. So an hourly check
// counts what has gone out and warns the directors once the day passes
// QUOTA_WARN_AT, while there is still room left for the warning itself and for
// the confirmations that matter.
//
// WHAT IS COUNTED. Every email the Resend account has accepted in the last 24
// hours, read back from Resend's own list (GET /emails), so it includes the
// sign-in codes Supabase sends — the site's own send log would miss those. A
// rolling 24 hours rather than "since midnight": if Resend's day is a calendar
// day the rolling count is never lower, so the warning can only come early,
// never late.
//
// Kept free of '@/' imports so the unit test can run it directly.

export const QUOTA_DAILY_LIMIT = 100;
export const QUOTA_WARN_AT = 80;

const RESEND_EMAILS = 'https://api.resend.com/emails';
// Enough pages to count past the cap with room to spare (100 per page).
const MAX_PAGES = 5;

export type CountResult =
    | { ok: true; count: number; complete: boolean }
    | { ok: false; status: number; detail: string };

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

// Emails accepted at or after `since`. The list comes newest first, so paging
// stops at the first email older than the window.
export async function countSentSince(apiKey: string, since: Date, fetchImpl: FetchLike = fetch as any): Promise<CountResult> {
    let count = 0;
    let after = '';
    for (let page = 0; page < MAX_PAGES; page++) {
        const url = RESEND_EMAILS + '?limit=100' + (after ? '&after=' + encodeURIComponent(after) : '');
        const res = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + apiKey } });
        if (!res.ok) return { ok: false, status: res.status, detail: String(await res.text()).slice(0, 300) };
        const body = await res.json();
        const rows: { id: string; created_at: string }[] = Array.isArray(body?.data) ? body.data : [];
        for (const row of rows) {
            const at = resendTime(row.created_at);
            // An unreadable time is counted, not skipped: over-counting can only
            // warn early.
            if (at !== null && at < since.getTime()) return { ok: true, count, complete: true };
            count++;
        }
        if (!body?.has_more || rows.length === 0) return { ok: true, count, complete: true };
        after = rows[rows.length - 1].id;
    }
    // Ran out of pages while still inside the window: the count is a floor.
    return { ok: true, count, complete: false };
}

// Resend writes "2026-10-03 14:16:10.203000+00": a space for the T, six
// fraction digits and a bare "+00", none of which Date parses. Milliseconds,
// or null when it still cannot be read.
export function resendTime(raw: unknown): number | null {
    const iso = String(raw || '')
        .replace(' ', 'T')
        .replace(/(\.\d{3})\d+/, '$1')
        .replace(/([+-]\d\d)$/, '$1:00');
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
}

// Once a day is enough: the first run past the line warns, the rest of that
// day's runs stay quiet. `lastWarnedDay` is the UTC date (YYYY-MM-DD) of the
// last warning, or null.
export function shouldWarn(count: number, lastWarnedDay: string | null, today: string): boolean {
    return count >= QUOTA_WARN_AT && lastWarnedDay !== today;
}

// The heartbeat row's detail carries the last warning day between runs, so no
// table is needed: "sent=83 warned=2026-10-03".
export function warnedDayFrom(detail: string | null | undefined): string | null {
    const m = /warned=(\d{4}-\d{2}-\d{2})/.exec(String(detail || ''));
    return m ? m[1] : null;
}

export function heartbeatDetail(count: number, warnedDay: string | null): string {
    return 'sent=' + count + ' warned=' + (warnedDay || 'none');
}
