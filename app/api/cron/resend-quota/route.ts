import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { recordCronRun, lastCronRun } from '@/lib/cronHeartbeat';
import { sendEmailToAll, recipients, emailLayout } from '@/lib/email';
import {
    QUOTA_DAILY_LIMIT,
    QUOTA_WARN_AT,
    countSentSince,
    heartbeatDetail,
    shouldWarn,
    warnedDayFrom,
} from '@/lib/resendQuota';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOB = 'resend-quota';

// Hourly: how many emails has the Resend account sent in the last 24 hours,
// and are we near the free plan's 100-a-day cap? Past 80 the directors get one
// email that day (lib/resendQuota says why the cap is dangerous and what is
// counted). Hourly rather than daily because a once-a-day count cannot warn
// before the cap — a busy afternoon would hit it between two checks.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const key = process.env.RESEND_API_KEY;
    if (!key) {
        await recordCronRun(JOB, false, 'RESEND_API_KEY is not set');
        return NextResponse.json({ ok: false, error: 'RESEND_API_KEY is not set' }, { status: 500 });
    }

    const previous = await lastCronRun(JOB);
    const lastWarned = warnedDayFrom(previous?.detail);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    const counted = await countSentSince(key, new Date(now.getTime() - 24 * 3600 * 1000));
    if ('status' in counted) {
        // A sending-only key cannot list emails (401/403). Said plainly, once a
        // run, into the error log the morning digest reads.
        await logError('resend-quota: could not count sent emails', { status: counted.status, detail: counted.detail }, {
            path: '/api/cron/resend-quota',
        });
        await recordCronRun(JOB, false, 'count failed ' + counted.status + ' warned=' + (lastWarned || 'none'));
        return NextResponse.json({ ok: false, status: counted.status }, { status: 502 });
    }

    const { count: sent, complete } = counted as { count: number; complete: boolean };
    let warnedDay = lastWarned;

    if (shouldWarn(sent, lastWarned, today)) {
        const left = Math.max(0, QUOTA_DAILY_LIMIT - sent);
        const shown = complete ? String(sent) : 'at least ' + sent;
        const html = emailLayout(
            `<h1 style="margin:0 0 12px;font-size:20px;">Email allowance nearly used up</h1>
             <p><strong>${shown} of ${QUOTA_DAILY_LIMIT}</strong> emails have gone out in the last 24 hours.</p>
             <p>The Resend free plan stops sending at ${QUOTA_DAILY_LIMIT} a day, without telling anyone. That leaves about <strong>${left}</strong> before booking confirmations, sign-in codes and host notices start failing silently.</p>
             <p>This count includes sign-in codes, which Supabase sends through Resend. Moving to Resend Pro ($20 a month) removes the daily cap.</p>`,
            'You will get this at most once a day.'
        );
        const to = recipients(process.env.DISPUTES_ALERT_EMAIL);
        const result = await sendEmailToAll(to, `Email allowance: ${shown} of ${QUOTA_DAILY_LIMIT} used today`, html);
        if (result.sent.length > 0) warnedDay = today;
        else {
            await logError('resend-quota: warning could not be delivered', { sent, to: to.length }, {
                path: '/api/cron/resend-quota',
            });
        }
    }

    await recordCronRun(JOB, true, heartbeatDetail(sent, warnedDay));
    return NextResponse.json({ ok: true, sent, warnAt: QUOTA_WARN_AT, warned: warnedDay === today });
}
