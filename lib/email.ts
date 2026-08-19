// =====================================================================
// GALLOWAY GETAWAYS — email sending
// WHERE THIS GOES: GitHub → lib/email.ts   (NEW FILE)
//
// Server-side only. Never import this into a 'use client' file — it
// holds the Resend API key.
// =====================================================================

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
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    const key = process.env.RESEND_API_KEY;

    if (!key) {
        console.error('[email] RESEND_API_KEY is not set — nothing sent.');
        return false;
    }
    if (!to) {
        console.error('[email] No recipient address — nothing sent.');
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
            return false;
        }
        return true;
    } catch (err) {
        console.error('[email] Could not reach Resend:', err);
        return false;
    }
}
