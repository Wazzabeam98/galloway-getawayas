// The push job. Every minute: work out the day-of reminders, then send every
// recorded push exactly once (lib/pushDispatch). The only place a push in the
// outbox is sent from — never payment, payout or settlement code.

import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { recordCronRun } from '@/lib/cronHeartbeat';
import { drainOutbox } from '@/lib/pushDispatch';
import { queueReminders } from '@/lib/pushReminders';
import { payoutCheck } from '@/lib/pushPayoutCheck';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOB = 'push-outbox';

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    try {
        const admin = adminClient();
        const reminders = await queueReminders(admin);
        const tally = await drainOutbox(admin, { special: payoutCheck });
        await recordCronRun(JOB, true, 'reminders=' + reminders + ' sent=' + tally.sent + ' skipped=' + tally.skipped + ' failed=' + tally.failed);
        return NextResponse.json({ ok: true, reminders, ...tally });
    } catch (err: any) {
        await logError('[push-outbox] the push job failed', { error: (err && err.message) || String(err) }, { path: 'api/cron/push-outbox' });
        await recordCronRun(JOB, false, (err && err.message) || String(err));
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
