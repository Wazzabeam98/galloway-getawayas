// MONEY THAT DID NOT MOVE, OR MOVED AND WAS NOT WRITTEN DOWN — TOLD NOW.
//
// Until now a failed payout, refund or balance charge reached /admin/errors
// and the 8am digest. That is up to a day late for the failures that matter
// most: a host told they would be paid the day after check-in, a guest told
// their refund is on its way, a transfer that went through with no record of
// it, so the next run may send it again.
//
// Disputes already email the directors the moment they land (the webhook's
// alertDirectors). This is the same thing for every other money failure: same
// recipients (DISPUTES_ALERT_EMAIL, comma-separated — the directors' alert
// alias, set in Vercel, changeable without a deploy), same rules — each
// address is sent separately, so one bounce cannot hide behind another
// arriving, and a failure to send is itself logged.
//
// It never throws. It is called from the failure path of code that has
// already moved, or failed to move, money, and a mail outage must not turn
// that into a second, different failure.

import { sendEmailToAll, recipients, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';

// Looked up on each call rather than imported. The call sites import logError
// themselves and the unit tests replace it per test; a copy captured when this
// module first loaded would keep writing to the first test's fake, and a
// failure would appear logged nowhere.
function logError(message: string, detail?: any, context?: { path?: string; userId?: string }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@/lib/logError').logError(message, detail, context);
}

export interface MoneyAlert {
    /** The subject line and heading: what went wrong, in plain words. */
    headline: string;
    /** What happened and what to do, one sentence each. */
    lines?: string[];
    /** Facts a person needs to find it — booking id, amount, Stripe ids. */
    facts?: Record<string, string | number | null | undefined>;
    /** Where to go and look. Defaults to /admin/errors. */
    link?: string;
    linkLabel?: string;
}

function factsTable(facts: MoneyAlert['facts']): string {
    const rows = Object.keys(facts || {})
        .filter((k) => facts![k] !== null && facts![k] !== undefined && facts![k] !== '')
        .map((k) =>
            '<tr><td style="padding:6px 12px 6px 0;font-size:14px;color:#6b7280;vertical-align:top;">'
            + escapeHtml(k) + '</td><td style="padding:6px 0;font-size:14px;color:#111827;font-family:monospace;">'
            + escapeHtml(String(facts![k])) + '</td></tr>'
        );
    return rows.length
        ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">' + rows.join('') + '</table>'
        : '';
}

/** Email both directors now. Never throws; returns how many copies went. */
export async function alertDirectorsNow(alert: MoneyAlert): Promise<number> {
    try {
        const to = recipients(process.env.DISPUTES_ALERT_EMAIL);
        // Console only, here and below: the failure itself is already in
        // /admin/errors (logMoneyFailure writes it first), and a second row
        // saying "and the email did not go" would double every report.
        if (!to.length) {
            console.error('[moneyAlert] DISPUTES_ALERT_EMAIL is not set — nobody was emailed about: ' + alert.headline);
            return 0;
        }

        const html = emailLayout(
            '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">'
                + escapeHtml(alert.headline) + '</h1>'
                + (alert.lines || []).map((l) =>
                    '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(l) + '</p>').join('')
                + factsTable(alert.facts)
                + button(alert.link || SITE_URL + '/admin/errors', alert.linkLabel || 'Open the error log'),
            'You are receiving this because you are a director of Galloway Getaways.'
        );

        const { sent, failed } = await sendEmailToAll(to, 'Money alert: ' + alert.headline, html);
        if (failed.length) {
            console.error('[moneyAlert] a money alert did not reach ' + failed.join(', ') + ' (reached: ' + (sent.join(', ') || 'nobody') + '): ' + alert.headline);
        }
        return sent.length;
    } catch (err) {
        console.error('[moneyAlert] could not alert the directors about: ' + alert.headline, err);
        return 0;
    }
}

/**
 * The drop-in for a money-path logError: records it in /admin/errors exactly
 * as before AND emails the directors straight away. Same arguments, so a call
 * site changes by one word.
 */
export async function logMoneyFailure(
    message: string,
    detail?: any,
    context?: { path?: string; userId?: string }
): Promise<void> {
    await logError(message, detail, context);

    const facts: Record<string, any> = {};
    if (context && context.path) facts.where = context.path;
    if (detail && typeof detail === 'object' && !(detail instanceof Error)) {
        for (const k of Object.keys(detail).slice(0, 12)) {
            const v = detail[k];
            if (v === null || v === undefined) continue;
            facts[k] = typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : String(v).slice(0, 300);
        }
    } else if (detail) {
        facts.detail = String((detail && (detail.message || detail)) || '').slice(0, 500);
    }
    if (context && context.userId) facts.user = context.userId;

    await alertDirectorsNow({
        headline: message.replace(/^\[[^\]]+\]\s*/, '').slice(0, 160),
        facts,
    });
}
