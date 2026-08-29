// =====================================================================
// GALLOWAY GETAWAYS — email sending
// WHERE THIS GOES: GitHub → lib/email.ts   (NEW FILE)
//
// Server-side only. Never import this into a 'use client' file — it
// holds the Resend API key.
// =====================================================================

import { logError } from '@/lib/logError';

export const SITE_URL = 'https://gallowaygetaways.co.uk';

// Booking-related mail comes from bookings@. Account and auth mail is
// sent by Supabase from hello@, configured in the Supabase dashboard.
const FROM = 'Galloway Getaways <bookings@gallowaygetaways.co.uk>';
const REPLY_TO = 'hello@gallowaygetaways.co.uk';

// Anything that came from a person — a name, a listing title, a message
// — must go through this before it lands in an HTML email.
export function escapeHtml(value: string | null | undefined): string {
    if (!value) return '';
    return String(value)
        .split('&').join('&amp;')
        .split('<').join('&lt;')
        .split('>').join('&gt;')
        .split('"').join('&quot;')
        .split("'").join('&#39;');
}

export function formatDate(value: string | null | undefined): string {
    if (!value) return '';
    try {
        return new Date(value).toLocaleDateString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
    } catch (err) {
        return String(value);
    }
}

// Everything on this site happens in one place, so the clock that matters is
// that place's. Vercel runs in UTC, which in summer is an hour behind
// Dumfries — enough to file a message sent at half past midnight under the
// day before, and then call it Thursday night when it was Friday morning.
const LOCAL_TIME_ZONE = 'Europe/London';

function londonDayKey(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: LOCAL_TIME_ZONE });
}

function londonHour(date: Date): number {
    // formatToParts with an explicit h23 cycle, because asking for a
    // two-digit hour and hoping is how you get "24" back for midnight.
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: LOCAL_TIME_ZONE,
        hour: 'numeric',
        hourCycle: 'h23',
    }).formatToParts(date);

    for (let i = 0; i < parts.length; i++) {
        if (parts[i].type === 'hour') return Number(parts[i].value);
    }
    return 0;
}

// How long something has been sitting, said the way somebody would say it.
//
// Hours while hours still mean something, and after that the day it started.
// "Waiting 31 hours" makes the reader do arithmetic before they know whether
// to care; "waiting since yesterday morning" they simply read. The changeover
// is at a day, which is also where the arithmetic starts.
export function waitedFor(since: string | Date, now?: Date): string {
    const start = typeof since === 'string' ? new Date(since) : since;
    const at = now || new Date();

    const hours = Math.floor((at.getTime() - start.getTime()) / 3600000);
    if (hours < 24) return 'waiting ' + hours + (hours === 1 ? ' hour' : ' hours');

    const hour = londonHour(start);
    const partOfDay = hour < 5
        ? 'night'
        : hour < 12
            ? 'morning'
            : hour < 18
                ? 'afternoon'
                : 'evening';

    const yesterday = new Date(at.getTime() - 86400000);

    if (londonDayKey(start) === londonDayKey(yesterday)) {
        return 'waiting since yesterday ' + partOfDay;
    }

    // Within the week a weekday is the clearest thing to say. Older than that
    // and the day of the week stops locating anything, so give the date.
    if (hours < 24 * 7) {
        return 'waiting since ' +
            start.toLocaleDateString('en-GB', { weekday: 'long', timeZone: LOCAL_TIME_ZONE }) +
            ' ' + partOfDay;
    }

    return 'waiting since ' +
        start.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            timeZone: LOCAL_TIME_ZONE,
        });
}

export function button(url: string, label: string): string {
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">' +
        '<tr><td style="background-color:#047857;border-radius:8px;">' +
        '<a href="' + url + '" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">' +
        label +
        '</a></td></tr></table>'
    );
}

// A simple label/value list, used for dates, guests and totals.
export function detailRows(rows: Array<{ label: string; value: string }>): string {
    let html = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;border:1px solid #e5e7eb;border-radius:10px;">';
    for (let i = 0; i < rows.length; i++) {
        const border = i === 0 ? '' : 'border-top:1px solid #e5e7eb;';
        html +=
            '<tr>' +
            '<td style="' + border + 'padding:11px 16px;font-size:14px;color:#6b7280;">' + rows[i].label + '</td>' +
            '<td style="' + border + 'padding:11px 16px;font-size:14px;color:#111827;font-weight:600;text-align:right;">' + rows[i].value + '</td>' +
            '</tr>';
    }
    return html + '</table>';
}

// The shared shell — same design as the Supabase auth templates.
export function emailLayout(bodyHtml: string, footnote: string, unsubscribeUrl?: string): string {
    const unsubscribe = unsubscribeUrl
        ? '<div style="padding-top:10px;"><a href="' + unsubscribeUrl + '" style="color:#9ca3af;text-decoration:underline;">Unsubscribe from these emails</a></div>'
        : '';

    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f5;margin:0;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;">' +
        '<tr><td align="center">' +
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">' +

        '<tr><td style="background-color:#047857;padding:26px 32px;">' +
        '<div style="color:#ffffff;font-size:21px;font-weight:700;letter-spacing:0.2px;line-height:1.2;">Galloway Getaways</div>' +
        '<div style="color:#a7f3d0;font-size:12px;padding-top:4px;letter-spacing:0.4px;">SELF-CATERING STAYS IN DUMFRIES &amp; GALLOWAY</div>' +
        '</td></tr>' +

        '<tr><td style="padding:34px 32px 30px 32px;color:#111827;font-size:16px;line-height:1.6;">' +
        bodyHtml +
        '</td></tr>' +

        '<tr><td style="background-color:#f9fafb;border-top:1px solid #e5e7eb;padding:22px 32px;color:#6b7280;font-size:12px;line-height:1.7;">' +
        '<strong style="color:#374151;">Galloway Getaways Ltd</strong><br>' +
        'Dumfries &amp; Galloway, Scotland &middot; Company number SC899385<br>' +
        '<a href="' + SITE_URL + '" style="color:#047857;text-decoration:none;">gallowaygetaways.co.uk</a>' +
        '&nbsp;&middot;&nbsp;' +
        '<a href="mailto:' + REPLY_TO + '" style="color:#047857;text-decoration:none;">' + REPLY_TO + '</a>' +
        '<div style="padding-top:12px;color:#9ca3af;">' + footnote + '</div>' +
        unsubscribe +
        '</td></tr>' +

        '</table></td></tr></table>'
    );
}

// Hands the email to Resend over HTTPS. Returns true/false rather than
// throwing: a notification that fails to send must never break the
// booking or message that triggered it.
//
// AND IT REPORTS, WHICH IS THE PART THAT WAS MISSING.
//
// Twenty call sites take the boolean this returns. Fifteen of them throw it
// away — including every one that matters: the 72/48/24 balance-failure ladder,
// the host payout notice, the booking confirmation, and the guest refund email.
// A guest who is never told their card failed loses their booking to a deadline
// they never saw, and nothing anywhere said so.
//
// The fix is here rather than at fifteen call sites, because that is fifteen
// chances to do it differently and one chance to do it once. Nothing about the
// contract changes: it still returns false, it still never throws, no caller
// needs touching. It simply stops being silent.
//
// console.error is kept alongside. On Vercel that is a log line nobody reads,
// which is the whole reason for the addition, but it costs nothing and it is
// what you have locally.
async function report(message: string, detail: any): Promise<void> {
    // The logger has its own try/catch and never throws. This one is here so
    // that a change to it can never turn "an email did not send" into "the
    // booking did not save".
    try {
        await logError(message, detail, { path: 'lib/email' });
    } catch (err) {
        console.error('[email] could not even report the failure');
    }
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    const key = process.env.RESEND_API_KEY;

    if (!key) {
        console.error('[email] RESEND_API_KEY is not set — nothing sent.');
        await report('[email] RESEND_API_KEY is not set — NOTHING is being emailed', { to, subject });
        return false;
    }
    if (!to) {
        console.error('[email] No recipient address — nothing sent.');
        await report('[email] an email had no recipient address', { subject });
        return false;
    }

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + key,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: FROM,
                to: [to],
                reply_to: REPLY_TO,
                subject: subject,
                html: html,
            }),
        });

        if (!res.ok) {
            const detail = await res.text();
            console.error('[email] Resend rejected the message:', res.status, detail);
            // The subject is the useful half: it says WHICH email did not
            // arrive, which is the difference between "chase this" and "a
            // notification failed". The body is deliberately not included —
            // these carry names, dates and amounts.
            await report('[email] Resend rejected a message to ' + to, {
                to,
                subject,
                status: res.status,
                detail: String(detail).slice(0, 500),
            });
            return false;
        }
        return true;
    } catch (err) {
        console.error('[email] Could not reach Resend:', err);
        await report('[email] could not reach Resend to send a message to ' + to, {
            to,
            subject,
            error: String((err as any) && (err as any).message),
        });
        return false;
    }
}

// ---------------------------------------------------------------------------
// MORE THAN ONE ADMIN
// ---------------------------------------------------------------------------
//
// The alert addresses are aliases held in the environment, one variable each,
// so they can change without a deploy. Some of them now need to reach two
// people — services alerts go to both of us — and the honest way to say that
// in an environment variable is a comma.
//
// Two separate sends rather than two addresses in one `to`. Resend would take
// the array, but then one bad address fails the whole message and the other
// person silently never hears about it. The failure worth avoiding here is the
// quiet one: an enquiry nobody was told about looks exactly like an enquiry
// nobody sent.
export function recipients(value: string | null | undefined): string[] {
    return String(value || '')
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a !== '');
}

export interface FanOutResult {
    sent: string[];
    failed: string[];
}

// Sends to each address in turn and says which ones worked. Never throws, for
// the same reason sendEmail never throws.
export async function sendEmailToAll(
    to: string[],
    subject: string,
    html: string
): Promise<FanOutResult> {
    const sent: string[] = [];
    const failed: string[] = [];

    for (const address of to) {
        const ok = await sendEmail(address, subject, html);
        if (ok) sent.push(address);
        else failed.push(address);
    }

    return { sent, failed };
}
