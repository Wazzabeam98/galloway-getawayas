import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { sendEmailToAll, recipients, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { RETENTION_DAYS, daysWaiting } from '@/lib/serviceApplications';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Flattens ids, amounts and dates so the same fault doesn't split into dozens
// of separate entries.
function groupKey(source: string, message: string): string {
    return (
        source +
        '::' +
        String(message)
            .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
            .replace(/\d+\.\d\d/g, '<amount>')
            .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
            .replace(/\b\d+\b/g, '<n>')
    );
}

// Emails the owners once a day, and only when there is something to say.
// A digest that arrives every morning saying "all fine" stops being read
// within a week, and then the one that matters gets ignored too.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const { data: rows } = await admin
        .from('error_log')
        .select('id, source, message, path, created_at, user_id')
        .gte('created_at', since)
        .eq('resolved', false)
        .order('created_at', { ascending: false })
        .limit(500);

    const errors = rows || [];

    // ------------------------------------------------------------------
    // TRADESMEN WAITING ON THEMSELVES.
    //
    // Somebody who fills in the application form and never opens their link
    // has no account and nothing in the review queue, so there is no screen he
    // appears on by default and no reason anybody would go looking. That is
    // the same as losing him, which is the thing the whole flow was
    // reorganised to stop — so he comes to you, in the one email that already
    // arrives every day, rather than waiting on a page being remembered.
    //
    // Oldest first: the ones nearest deletion are the ones worth a phone call
    // today.
    // ------------------------------------------------------------------
    const { data: waitingRows, error: waitingError } = await admin
        .from('service_applications')
        .select('id, business_name, trade, email, contact_phone, created_at, resend_count')
        .is('claimed_at', null)
        .order('created_at', { ascending: true })
        .limit(50);

    if (waitingError) {
        await logError('error-digest: could not read the applications waiting on their applicant', waitingError, {
            path: '/api/cron/error-digest',
        });
    }

    const waiting = waitingRows || [];

    // The send condition is errors OR people, not errors alone. A quiet day
    // for the site is not a quiet day for a joiner who applied a fortnight ago
    // and has heard nothing, and the old early return would have swallowed him.
    if (errors.length === 0 && waiting.length === 0) {
        return NextResponse.json({ ok: true, sent: 0, reason: 'nothing to report' });
    }

    const groups: Record<string, any> = {};

    errors.forEach((row: any) => {
        const key = groupKey(row.source, row.message);

        if (!groups[key]) {
            groups[key] = {
                source: row.source,
                message: row.message,
                count: 0,
                paths: [] as string[],
                people: [] as string[],
            };
        }

        const g = groups[key];
        g.count += 1;
        if (row.path && g.paths.indexOf(row.path) === -1) g.paths.push(row.path);
        if (row.user_id && g.people.indexOf(row.user_id) === -1) g.people.push(row.user_id);
    });

    const issues = Object.keys(groups)
        .map((k) => groups[k])
        .sort((a, b) => b.count - a.count);

    const serverCount = errors.filter((e: any) => e.source === 'server').length;

    // The chase list, as a block you can act on from the email: a name, how
    // long they have been waiting, and the number to ring. The phone comes
    // before the address on purpose — the address is the one they have already
    // failed to open.
    const waitingHtml = waiting.length === 0 ? '' : (
        '<p style="margin:0 0 10px;font-size:16px;"><strong>'
            + waiting.length + (waiting.length === 1 ? ' business is' : ' businesses are')
            + ' waiting on their applicant.</strong> They filled the form in but have not opened'
            + ' their link, so there is no account and nothing in the review queue yet. Ring them.</p>'
        + '<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">'
        + waiting.slice(0, 15).map((w: any) => {
            const days = daysWaiting(w);
            const left = RETENTION_DAYS - days;
            const urgent = left <= 21;
            return '<tr>'
                + '<td style="padding:8px 10px 8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;">'
                    + '<strong>' + escapeHtml(String(w.business_name || 'Unnamed')) + '</strong>'
                    + '<div style="color:#6b7280;font-size:12px;">' + escapeHtml(String(w.trade || '')) + '</div>'
                + '</td>'
                + '<td style="padding:8px 10px 8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;white-space:nowrap;">'
                    + (w.contact_phone
                        ? '<a href="tel:' + escapeHtml(String(w.contact_phone).replace(/\s+/g, '')) + '" style="color:#047857;text-decoration:none;font-weight:600;">'
                            + escapeHtml(String(w.contact_phone)) + '</a>'
                        : '<span style="color:#9ca3af;">no number</span>')
                + '</td>'
                + '<td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:13px;white-space:nowrap;'
                    + (urgent ? 'color:#b91c1c;' : 'color:#6b7280;') + '">'
                    + days + (days === 1 ? ' day' : ' days')
                    + (urgent ? '<br><span style="font-size:11px;">deleted in ' + (left > 0 ? left : 0) + '</span>' : '')
                + '</td>'
                + '</tr>';
        }).join('')
        + '</table>'
        + (waiting.length > 15
            ? '<p style="margin:0 0 16px;font-size:14px;color:#64748b;">and ' + (waiting.length - 15) + ' more.</p>'
            : '')
    );

    const rowsHtml = issues
        .slice(0, 15)
        .map((g) => {
            const where = g.source === 'server' ? 'Server' : 'Browser';
            const people =
                g.people.length > 0
                    ? g.people.length + ' signed-in ' + (g.people.length === 1 ? 'person' : 'people')
                    : 'nobody signed in';

            return (
                '<tr>'
                + '<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;">'
                + '<strong>' + escapeHtml(g.message) + '</strong><br>'
                + '<span style="color:#64748b;font-size:12px;">'
                + where
                + (g.paths.length ? ' &middot; ' + escapeHtml(g.paths.slice(0, 3).join(', ')) : '')
                + ' &middot; ' + people
                + '</span>'
                + '</td>'
                + '<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:14px;white-space:nowrap;">'
                + '&times;' + g.count
                + '</td>'
                + '</tr>'
            );
        })
        .join('');

    // Goes to ACCOUNTS_ALERT_EMAIL rather than to whoever has `is_admin` set.
    // That lookup read each director's own account address, so the digest
    // landed in personal inboxes; an alias is somewhere it can be read by
    // whoever is on it, and it moves without a deploy.
    // Comma-split, the same as the other two alert variables.
    const to = recipients(process.env.ACCOUNTS_ALERT_EMAIL);

    if (!to.length) {
        await logError('error-digest: ACCOUNTS_ALERT_EMAIL is not set — the digest went nowhere', {
            errors: errors.length,
            issues: issues.length,
        });
        return NextResponse.json({ ok: true, sent: 0, errors: errors.length, issues: issues.length });
    }

    let sent = 0;

    {
        const result = await sendEmailToAll(
            to,
            errors.length === 0
                ? (waiting.length === 1
                    ? '1 tradesman is waiting on himself'
                    : waiting.length + ' tradesmen are waiting on themselves')
                : issues.length === 1
                    ? 'Something went wrong on the site yesterday'
                    : issues.length + ' things went wrong on the site yesterday',
            emailLayout(
                (errors.length === 0
                    ? ''
                    : '<p style="margin:0 0 16px;font-size:16px;">In the last 24 hours there '
                        + (errors.length === 1 ? 'was <strong>1 error</strong>' : 'were <strong>' + errors.length + ' errors</strong>')
                        + ', across <strong>' + issues.length + '</strong> distinct problem'
                        + (issues.length === 1 ? '' : 's')
                        + (serverCount > 0 ? ', ' + serverCount + ' of them on the server' : '')
                        + '.</p>'
                        + '<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">'
                        + rowsHtml
                        + '</table>')
                    + waitingHtml
                    + (issues.length > 15
                        ? '<p style="margin:0 0 16px;font-size:14px;color:#64748b;">and ' + (issues.length - 15) + ' more.</p>'
                        : '')
                    + (errors.length === 0
                        ? ''
                        : '<p style="margin:0 0 16px;font-size:14px;color:#64748b;">Some of these will be harmless. What matters is anything on the server, and anything that kept happening.</p>')
                    + button(
                        SITE_URL + (errors.length === 0 ? '/admin/providers' : '/admin/errors'),
                        errors.length === 0 ? 'See who is waiting' : 'Look at them properly'
                    ),
                'You\u2019re receiving this because you own Galloway Getaways. It only sends when '
                    + 'there is something to do about.'
            )
        );

        // The one thing that tells us anything is broken must not be the thing
        // that breaks quietly. Counted per address, so a digest that reached
        // one owner and not the other is not recorded as sent.
        sent += result.sent.length;

        if (result.failed.length) {
            await logError('error-digest: the digest did not send', {
                failed: result.failed.join(', '),
                reached: result.sent.join(', '),
                errors: errors.length,
                issues: issues.length,
            });
        }
    }

    // ----------------------------------------------------------------
    // AND SWEEP THE APPLICATIONS NOBODY EVER CLAIMED.
    //
    // service_applications holds a real person's name, phone and business
    // details for somebody who has no account with us and never proved their
    // address. Keeping that indefinitely because they did not finish a form is
    // not a position worth defending, so it goes at RETENTION_DAYS.
    //
    // Claimed rows are left alone — those became real businesses, and the row
    // is the record of what was submitted and when.
    //
    // Nobody vanishes without warning: the digest above and the admin list
    // both show a countdown once a row is inside three weeks of this.
    // ----------------------------------------------------------------
    let applicationsSwept: number | null = null;

    try {
        const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();

        const { data: swept, error: sweepError } = await admin
            .from('service_applications')
            .delete()
            .is('claimed_at', null)
            .lt('created_at', cutoff)
            .select('id');

        if (sweepError) {
            await logError('error-digest: could not sweep unclaimed service applications', sweepError, {
                path: '/api/cron/error-digest',
            });
        } else {
            applicationsSwept = (swept || []).length;
        }
    } catch (err) {
        await logError('error-digest: could not sweep unclaimed service applications', err, {
            path: '/api/cron/error-digest',
        });
    }

    // ----------------------------------------------------------------
    // While we are here once a day: throw away the rate-limit rows nobody
    // will ever look at again.
    //
    // lib/rateLimit writes a row per limit per attempt, and nothing was
    // deleting them. At this volume that is a handful a week, so it is not
    // urgent — it is just a table that only ever grows, which is how a
    // rate limiter ends up slower than the thing it is protecting.
    //
    // Seven days, against the longest window any limit uses (24 hours), so
    // there is a wide margin before anything still being counted is touched.
    // Widen the window past a week and this has to change with it.
    //
    // Reported rather than silent, and NOT allowed to break the digest: the
    // digest is the thing that tells you about everything else, and a failed
    // tidy-up must not stop it going out.
    // Named for what it retains. It used to be RETENTION_DAYS, which now
    // collides with the applications one imported at the top of this file —
    // two different retentions, seven days apart in meaning and eighty-three in
    // value, are not a name to share.
    const RATE_LIMIT_RETENTION_DAYS = 7;
    let pruned: number | null = null;
    try {
        const cutoff = new Date(Date.now() - RATE_LIMIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { data: gone, error: pruneError } = await admin
            .from('rate_limit_hits')
            .delete()
            .lt('created_at', cutoff)
            .select('id');

        if (pruneError) {
            await logError('error-digest: could not prune rate_limit_hits', pruneError, {
                path: '/api/cron/error-digest',
            });
        } else {
            pruned = (gone || []).length;
        }
    } catch (err) {
        await logError('error-digest: could not prune rate_limit_hits', err, {
            path: '/api/cron/error-digest',
        });
    }

    return NextResponse.json({
        ok: true,
        sent: sent,
        errors: errors.length,
        issues: issues.length,
        rateLimitRowsPruned: pruned,
        waitingOnApplicant: waiting.length,
        applicationsSwept: applicationsSwept,
    });
}
