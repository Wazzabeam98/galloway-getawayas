// The package notice at the experience checkout: one short line, above the pay
// button, telling a guest who is already staying with us that the experience
// they are about to book is a booking of its own — not part of a package with
// their accommodation, and not protected as one.
//
// This is NOT the linked-travel-arrangement notice (lib/linkedTravelNotice.ts).
// That one is shown on every stay-linked checkout; this one is decided by the
// experience DATE against the guest's own confirmed stays, on every experience
// checkout — standalone as well as against a stay. The two are kept apart on
// purpose, with their own wording, version and columns on the order.
//
// ONE PLACE. The wording and its version live here. The checkout component shows
// PACKAGE_NOTICE_TEXT; the order-creating routes record PACKAGE_NOTICE_VERSION
// and the server's time against the order (service_orders.package_notice_version
// / package_notice_shown_at). Whenever the text changes, BUMP the version, so an
// order records which wording that guest was actually shown.
//
// WHO SEES IT — THE COVERING-STAY RULE, decided on the server:
//   * the stay is the signed-in guest's OWN booking (bookings.guest_id). A trip
//     companion is not counted: they did not buy the accommodation, so there is
//     no stay of theirs for the experience to be packaged with.
//   * the stay is confirmed AND paid — the site's one entitlement rule,
//     bookingReleasesPrivateData (status 'confirmed', payment 'paid' or
//     'deposit_paid'). A pending, unpaid, cancelled or refunded stay never shows it.
//   * the experience's London calendar day falls within the stay, check-in day
//     to check-out day INCLUSIVE — on the departure morning the guest is still
//     on that trip. Compared as 'yyyy-mm-dd' day keys, never through an instant.
// Nobody without such a stay sees the notice, and nothing is recorded for them.
//
// NEVER FROM THE BROWSER. The page gets the guest's stay windows from the
// server and only uses them to decide whether to draw the line for the date
// picked. The routes that create the order re-decide from the database with the
// signed-in user's id and the date they have already validated; nothing the
// browser sends is read for this. If a stay became confirmed after the page
// loaded, the server records the notice anyway — it is an informational line,
// not something the guest agrees to, and the gap is minutes at most.

import { bookingReleasesPrivateData } from './bookingEntitlement';

// Bump whenever PACKAGE_NOTICE_TEXT changes.
export const PACKAGE_NOTICE_VERSION = 'v1-2026-09-30';

export const PACKAGE_NOTICE_TEXT =
    'This booking is for this experience only. It isn’t part of a package with your stay, so it isn’t protected as a package holiday.';

// A stay's span as day keys. check_in and check_out are date columns, so they
// arrive as 'yyyy-mm-dd'; slice guards against a timestamp form.
export interface StayWindow { checkIn: string; checkOut: string }

// The booking fields the rule reads.
export interface StayRow {
    guest_id?: string | null;
    status?: string | null;
    payment_status?: string | null;
    check_in?: string | null;
    check_out?: string | null;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function key(v: string | null | undefined): string | null {
    const k = String(v || '').slice(0, 10);
    return DAY_KEY.test(k) ? k : null;
}

// Whether a stay covers a day, both ends inclusive.
export function stayCoversDate(stay: StayWindow, dateKey: string | null | undefined): boolean {
    const d = key(dateKey);
    if (!d) return false;
    return stay.checkIn <= d && d <= stay.checkOut;
}

// The windows of the stays that count for this user: their own, confirmed and
// paid. Everything else is dropped here, so both the page and the routes apply
// the same rule whatever their query happened to filter.
export function coveringStayWindows(rows: StayRow[] | null | undefined, userId: string | null | undefined): StayWindow[] {
    if (!userId) return [];
    const out: StayWindow[] = [];
    for (const r of rows || []) {
        if (!r || r.guest_id !== userId) continue;
        if (!bookingReleasesPrivateData(r)) continue;
        const checkIn = key(r.check_in), checkOut = key(r.check_out);
        if (!checkIn || !checkOut) continue;
        out.push({ checkIn, checkOut });
    }
    return out;
}

// Whether the notice applies to an experience on this day.
export function hasCoveringStay(windows: StayWindow[] | null | undefined, dateKey: string | null | undefined): boolean {
    return (windows || []).some((w) => stayCoversDate(w, dateKey));
}

const STAY_SELECT = 'guest_id, status, payment_status, check_in, check_out';

// For the page: the signed-in guest's confirmed, paid stays that have not ended
// (check_out on or after today, London). Read with the service role, pinned to
// the caller's own id. Only the dates go to the browser — no address, no money.
export async function loadStayWindows(admin: any, userId: string | null | undefined, todayKey: string): Promise<StayWindow[]> {
    if (!userId) return [];
    const { data, error } = await admin
        .from('bookings')
        .select(STAY_SELECT)
        .eq('guest_id', userId)
        .eq('status', 'confirmed')
        .in('payment_status', ['paid', 'deposit_paid'])
        .gte('check_out', todayKey);
    if (error) return [];
    return coveringStayWindows(data, userId);
}

export interface PackageNoticeRecord {
    package_notice_version: string;
    package_notice_shown_at: string;
}

// For the order routes: the columns to record against the order when the notice
// applies to this user on this day, or null when it does not. `userId` must be
// the signed-in user from the session and `dateKey` the date the route has
// already validated — never a value the browser sent about the notice.
export async function packageNoticeRecord(
    admin: any,
    userId: string | null | undefined,
    dateKey: string | null | undefined,
    nowIso: string,
): Promise<PackageNoticeRecord | null> {
    const d = key(dateKey);
    if (!userId || !d) return null;
    const { data, error } = await admin
        .from('bookings')
        .select(STAY_SELECT)
        .eq('guest_id', userId)
        .eq('status', 'confirmed')
        .in('payment_status', ['paid', 'deposit_paid'])
        .lte('check_in', d)
        .gte('check_out', d);
    if (error) return null;
    if (!hasCoveringStay(coveringStayWindows(data, userId), d)) return null;
    return { package_notice_version: PACKAGE_NOTICE_VERSION, package_notice_shown_at: nowIso };
}

// The request shapes create their order from the Stripe session (the webhook,
// or the reconcile sweep), so the decision made at checkout travels in the
// session's metadata — written by the server, never the browser. Empty strings
// when the notice does not apply (Stripe metadata values are strings).
export function packageNoticeMetadata(rec: PackageNoticeRecord | null): { package_notice_version: string; package_notice_shown_at: string } {
    return {
        package_notice_version: rec ? rec.package_notice_version : '',
        package_notice_shown_at: rec ? rec.package_notice_shown_at : '',
    };
}

// And back out of the metadata into the order's columns — nothing when absent.
export function packageNoticeFromMetadata(md: any): Partial<PackageNoticeRecord> {
    const version = md && typeof md.package_notice_version === 'string' ? md.package_notice_version : '';
    const shownAt = md && typeof md.package_notice_shown_at === 'string' ? md.package_notice_shown_at : '';
    if (!version || !shownAt) return {};
    return { package_notice_version: version, package_notice_shown_at: shownAt };
}
