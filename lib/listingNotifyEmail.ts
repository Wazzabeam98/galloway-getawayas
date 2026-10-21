// A listing's extra addresses (lib/notificationEmails, the
// listing_notification_subscribers table) get a copy of exactly the emails the
// OWNER gets for that listing — a new booking, a cancellation, a change, a new
// message — and nothing else. Done once, here, where every email passes through
// (lib/email sendEmail), the same shape as the business co-host fan-out beside
// it (lib/providerTeamEmail), rather than at the half-dozen places a host is
// emailed, one of which is the settlement path a payment webhook runs.
//
// HOW IT KNOWS WHICH LISTING. A host email about a booking carries a link to
// that booking (/dashboard/bookings/<id>, or /messages/<id> for a new message),
// and the booking knows its listing and its owner. So: the subject matches one
// of the host notification kinds we copy (or is the new-message email), we pull
// the booking id out of the link, and we confirm the recipient really is that
// listing's owner — which is what keeps a guest's copy of a message email, sent
// to the same /messages/<id> link, from ever reaching the owner's subscribers.
//
// WHAT IS DELIBERATELY NOT COPIED. Payout and money emails, chargebacks, damage
// resolutions, disputes, listing approvals, payout-setup nudges — all of them
// either match no kind in COPY_KINDS or go to no single booking, so they fall
// out here. A subscriber is told about bookings, not about the owner's money.
//
// Never throws and is time-boxed: a subscriber's copy must never hold up or
// fail the owner's email or the booking it rides along with.

import { adminClient } from './supabaseAdmin';
import { pushForEmail, cleanSubject } from './pushRules';
import { SITE_URL } from './email';

function enabled(): boolean {
    return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// The host notification kinds a subscriber gets a copy of. These are exactly the
// "booking, cancellation, change" host emails (new-message is handled
// separately below, because it is sent with its push suppressed and so matches
// no rule). Kinds come from lib/pushRules; keeping the set here, not a flag on
// every rule, keeps the copy decision in one readable place.
const COPY_KINDS = new Set<string>([
    'stay.request.host',        // New booking request
    'stay.booked.host',         // New booking (instant)
    'stay.cancelled.host',      // Reservation cancelled
    'stay.balance_cancel.host', // Booking cancelled — balance unpaid
    'stay.updated.host',        // Guest updated their booking
    'stay.change_requested.host',
    'stay.change_closed.host',  // A change was declined / cancelled
    'stay.change_accepted',     // A reservation change was accepted
    'stay.change_paid.host',    // Guest paid for the change
]);

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
    return new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), ms);
        Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
    });
}

// Pull the booking id out of the link a host email carries. Either the
// host-facing booking page or, for a new message, the thread — both are keyed
// by the booking id.
function bookingIdFrom(html: string): string | null {
    const m = String(html || '').match(/\/(?:dashboard\/bookings|messages)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
    return m ? m[1] : null;
}

type Copy = { email: string; unsubscribeToken: string };

/** The confirmed subscriber addresses that should get a copy of this email. */
export async function listingNotifyCopies(to: string, subject: string, html: string, client?: any): Promise<Copy[]> {
    try {
        if (!to) return [];
        if (!client && !enabled()) return [];

        const spec = pushForEmail(subject, html);
        const kind = spec && spec.kind;
        // The new-message email is suppressed from the push rules (NO_PUSH), so
        // pushForEmail returns null for it — detect it straight from the subject
        // and its /messages/<id> link rather than through a kind. The owner
        // check below is what keeps a guest's copy of the same email out.
        const clean = cleanSubject(subject);
        const isNewMessage = /^New message from /i.test(clean) && /\/messages\/[0-9a-f-]{36}\b/i.test(html);
        if (!isNewMessage && !(kind && COPY_KINDS.has(kind))) return [];

        const bookingId = bookingIdFrom(html);
        if (!bookingId) return [];

        const address = String(to).trim().toLowerCase();
        const admin = client || adminClient();

        const run = async (): Promise<Copy[]> => {
            const { data: booking } = await admin
                .from('bookings')
                .select('listing_id, host_id')
                .eq('id', bookingId)
                .maybeSingle();
            if (!booking || !booking.listing_id || !booking.host_id) return [];

            // The copy only goes out when the recipient is the listing's owner,
            // so a guest's copy of a /messages/<id> email never fans out to the
            // host's subscribers.
            const { data: owner } = await admin.auth.admin.getUserById(booking.host_id);
            const ownerEmail = owner && owner.user && String(owner.user.email || '').trim().toLowerCase();
            if (!ownerEmail || ownerEmail !== address) return [];

            const { data: subs } = await admin
                .from('listing_notification_subscribers')
                .select('email, unsubscribe_token')
                .eq('listing_id', booking.listing_id)
                .not('confirmed_at', 'is', null);

            const out: Copy[] = [];
            const seen = new Set<string>();
            for (const s of subs || []) {
                const e = String(s.email || '').trim().toLowerCase();
                if (!e || e === address || seen.has(e)) continue;
                seen.add(e);
                out.push({ email: e, unsubscribeToken: String(s.unsubscribe_token) });
            }
            return out;
        };

        return (await within(run(), 4000)) || [];
    } catch {
        return [];
    }
}

// The one-click unsubscribe URL for a copy. Kept on the /unsubscribe path (not a
// child route) so lib/email's listUnsubscribe picks it up into the
// List-Unsubscribe header the inbox providers weigh.
export function listingUnsubscribeUrl(token: string): string {
    return SITE_URL + '/unsubscribe?listing=' + encodeURIComponent(token);
}

// A subscriber is told about bookings, not about the owner's money. The host's
// own email carries that money — the "You earn" net-payout row on a new
// booking, a "Total", "Paid and held", and the odd inline figure like "paid
// £45 for the change" — and a cleaner, partner or agent the owner added for
// "let me know when a booking comes in" has no business seeing any of it.
//
// So before a copy goes out, every money figure is taken out of it, two ways,
// because the emails put money in two shapes:
//   1. a whole detail row whose right-aligned value is an amount (You earn,
//      Total, Paid and held) — the row is dropped entirely; and
//   2. an amount sitting inline in a sentence — the figure is removed and the
//      spacing tidied, so the sentence still reads without ever naming it.
// Done at the fan-out chokepoint, once, so it covers every forwarded kind —
// including ones added later — rather than trusting each email builder to know
// it might be forwarded. A booking fact (property, guest first name, dates,
// how many) carries no amount, so it is left untouched.

// £ or its HTML entities, then an amount: digits, grouping commas, optional
// pence. The non-global twin is for testing a fragment; the global one edits.
const MONEY = '(?:£|&pound;|&#163;|&#x0*a3;)\\s*\\d[\\d,]*(?:\\.\\d{1,2})?';
const MONEY_ONE = new RegExp(MONEY, 'i');
const MONEY_ALL = new RegExp(MONEY, 'gi');

export function stripOwnerMoney(html: string): string {
    let out = String(html || '');

    // 1) Drop any detail row whose value cell (the only right-aligned cell the
    //    email layout produces — lib/email detailRows) shows an amount.
    out = out.replace(
        /<tr>\s*<td[^>]*>[\s\S]*?<\/td>\s*<td[^>]*text-align:\s*right[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi,
        (row, valueCell) => (MONEY_ONE.test(String(valueCell)) ? '' : row),
    );

    // 2) Remove any amount still sitting inline, drop the now-empty emphasis it
    //    may have been wrapped in, and tidy the whitespace/punctuation left
    //    behind ("accepted and paid £45 for" -> "accepted and paid for").
    out = out.replace(MONEY_ALL, '');
    out = out.replace(/<strong>\s*<\/strong>/gi, '');
    out = out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,;:])/g, '$1');

    return out;
}

// A copy is the owner's own email, stripped of the owner's money, made safe to
// forward and given a way out.
//
// Some host emails (a new message) already carry the OWNER's personal
// account-unsubscribe link. A subscriber must never see or click that — it
// would unsubscribe the owner, and lib/email's List-Unsubscribe header would
// point at it. So any existing /unsubscribe?token=… link in the copy is
// repointed to this listing's own unsubscribe, which is the only thing a
// subscriber should be able to do. Emails that carry no unsubscribe link
// (a booking, a cancellation, a change) get the footnote appended instead.
export function withListingUnsubscribe(html: string, token: string): string {
    html = stripOwnerMoney(html);
    const url = listingUnsubscribeUrl(token);
    const existing = /href="https:\/\/(?:www\.)?gallowaygetaways\.co\.uk\/unsubscribe\?[^"]*"/g;
    if (existing.test(String(html || ''))) {
        return String(html).replace(existing, 'href="' + url + '"');
    }
    const note =
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f5;margin:0;padding:0 12px 24px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;">' +
        '<tr><td align="center">' +
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">' +
        '<tr><td style="padding:14px 32px 0;color:#9ca3af;font-size:12px;line-height:1.6;">' +
        'You’re getting this because the host added you to notifications for this property. ' +
        '<a href="' + url + '" style="color:#9ca3af;text-decoration:underline;">Unsubscribe from this property’s emails</a>.' +
        '</td></tr></table></td></tr></table>';
    return String(html || '') + note;
}
