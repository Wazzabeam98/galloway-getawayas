import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { sendEmailToAll, recipients, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';

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

    if (errors.length === 0) {
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
            issues.length === 1
                ? 'Something went wrong on the site yesterday'
                : issues.length + ' things went wrong on the site yesterday',
            emailLayout(
                '<p style="margin:0 0 16px;font-size:16px;">In the last 24 hours there '
                    + (errors.length === 1 ? 'was <strong>1 error</strong>' : 'were <strong>' + errors.length + ' errors</strong>')
                    + ', across <strong>' + issues.length + '</strong> distinct problem'
                    + (issues.length === 1 ? '' : 's')
                    + (serverCount > 0 ? ', ' + serverCount + ' of them on the server' : '')
                    + '.</p>'
                    + '<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">'
                    + rowsHtml
                    + '</table>'
                    + (issues.length > 15
                        ? '<p style="margin:0 0 16px;font-size:14px;color:#64748b;">and ' + (issues.length - 15) + ' more.</p>'
                        : '')
                    + '<p style="margin:0 0 16px;font-size:14px;color:#64748b;">Some of these will be harmless. What matters is anything on the server, and anything that kept happening.</p>'
                    + button(SITE_URL + '/admin/errors', 'Look at them properly'),
                'You\u2019re receiving this because you own Galloway Getaways. It only sends when something has actually gone wrong.'
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

    return NextResponse.json({
        ok: true,
        sent: sent,
        errors: errors.length,
        issues: issues.length,
    });
}
