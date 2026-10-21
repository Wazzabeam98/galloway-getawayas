// Shared rules for a listing's "Notification emails" — the handful of extra
// addresses an owner forwards a listing's booking emails to. Both the editor
// card (client) and the route that writes the table (server) import these, so
// the same limit and the same idea of a valid address are enforced in both
// places rather than drifting apart (one shared helper, mirrored server-side —
// the house rule).

// Airbnb-style small cap: a forward to a cleaner and a co-owner, not a mailing
// list. Three per listing.
export const MAX_NOTIFICATION_EMAILS = 3;

// Lower-cased and trimmed, the one form the address is compared and stored in.
export function normalizeNotificationEmail(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase();
}

// Deliberately forgiving: one @, something either side, a dot in the domain, no
// spaces. The address has to confirm by clicking a link before anything is ever
// sent to it, so a typo costs the owner a confirmation that never arrives, not
// a bounce against our sending reputation — the check is here to catch a slip,
// not to police every RFC corner.
export function isValidNotificationEmail(value: string | null | undefined): boolean {
    const email = normalizeNotificationEmail(value);
    if (!email || email.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// How often a confirmation email may be re-sent to the same unconfirmed
// address. Without this, an authenticated owner or full-access co-host could
// POST the same address over and over and have the platform email a third party
// without limit, from our sending reputation — the confirm step is opt-in, but
// nothing stopped the re-asking. Five minutes is long enough to stop a flood
// and short enough that a genuine "it didn't arrive, send again" still works.
export const CONFIRM_RESEND_THROTTLE_MS = 5 * 60 * 1000;

// Whether a resend to an address is too soon after the last one. A row that has
// never been sent to (no timestamp) is never blocked — that is the first send.
export function confirmResendBlocked(confirmSentAt: string | null | undefined, now: number = Date.now()): boolean {
    if (!confirmSentAt) return false;
    const t = new Date(confirmSentAt).getTime();
    return Number.isFinite(t) && now - t < CONFIRM_RESEND_THROTTLE_MS;
}
