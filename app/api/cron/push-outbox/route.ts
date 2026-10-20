// The push job. Every minute: work out the day-of reminders, then send every
// recorded push exactly once (lib/pushDispatch), and the emails for events
// recorded by triggers (lib/eventEmails). The only place a push in the
// outbox is sent from — never payment, payout or settlement code.

import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { recordCronRun } from '@/lib/cronHeartbeat';
import { drainOutbox } from '@/lib/pushDispatch';
import { queueReminders } from '@/lib/pushReminders';
import { payoutCheck } from '@/lib/pushPayoutCheck';
import { eventMail } from '@/lib/eventEmails';
import { drainEmailOutbox } from '@/lib/emailOutbox';
import { sendEmailOnly } from '@/lib/email';

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
        // Two kinds of row are handled rather than pushed as they stand: the
        // payout-details check (a read at Stripe), and the 'notify.*' events
        // recorded by triggers, which send their email here — and the email
        // records its push like any other.
        const tally = await drainOutbox(admin, {
            special: async (a, row) => (await payoutCheck(a, row)) || (await eventMail(a, row)),
        });
        // Then retry any email whose live send failed earlier (lib/emailOutbox).
        // The same job, because it is the one place email is sent from outside
        // the request that caused it.
        const emails = await drainEmailOutbox(admin, sendEmailOnly);
        await recordCronRun(JOB, true, 'reminders=' + reminders + ' sent=' + tally.sent + ' skipped=' + tally.skipped + ' failed=' + tally.failed
            + ' email_sent=' + emails.sent + ' email_retrying=' + emails.retrying + ' email_failed=' + emails.failed);
        return NextResponse.json({ ok: true, reminders, ...tally, emails });
    } catch (err: any) {
        await logError('[push-outbox] the push job failed', { error: (err && err.message) || String(err) }, { path: 'api/cron/push-outbox' });
        await recordCronRun(JOB, false, (err && err.message) || String(err));
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
