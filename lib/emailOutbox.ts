// The retry queue for outgoing email: RECORD a failed send, and later RE-SEND
// it — the same split the push outbox uses.
//
// Every email the site sends goes through lib/email → sendEmail, which tries
// Resend once. When that one attempt fails — Resend is down, rate-limits, or
// the network drops — the send used to be only logged, and the email was gone.
// A booking, cancellation or payout email lost that way is a guest never told
// their card failed, or a host never told they were paid.
//
// So sendEmail now records the failed send here (queueFailedEmail), and the
// push job (/api/cron/push-outbox) drains this queue (drainEmailOutbox),
// re-sending each row until it works or a handful of attempts have passed. Like
// the push outbox, this is only ever sent from the job — never from payment,
// payout or settlement code — and recording a failure can never itself throw or
// hold anything up.
//
// EXACTLY ONCE, EVEN ON RETRY. Each queued email carries the Idempotency-Key
// its first attempt gave Resend; a retry hands Resend the same key, so a send
// that actually went through despite reporting a failure is deduplicated there
// rather than sent twice. drainEmailOutbox takes the sender as an argument
// (lib/email's sendEmailOnly) so this file never imports lib/email back — and so
// a retry re-sends the email without recording its push a second time.

import { adminClient } from './supabaseAdmin';
import { isAutomatedTestAddress } from './testAddresses';

const RECORD_TIMEOUT_MS = 1500;
const BATCH = 50;
const STALE_MINUTES = 15;
const KEEP_DAYS = 3;
const MAX_ATTEMPTS = 6;
// Minutes to wait before the Nth retry (attempt 1 → 1 min, and so on). The last
// value repeats for any attempt beyond the list.
const BACKOFF_MINUTES = [1, 5, 15, 30, 60, 120];

// The first retry waits a minute, so the same cron run that recorded a failure
// (the job sends event emails too) does not immediately re-send it.
const INITIAL_DELAY_MS = 60 * 1000;

export type EmailSender = (to: string, subject: string, html: string, idempotencyKey?: string) => Promise<boolean>;

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | null> {
    return new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), ms);
        Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
    });
}

function enabled(): boolean {
    return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
        && process.env.EMAIL_OUTBOX_DISABLED !== '1';
}

/**
 * Record an email whose one live send has just failed, so the job can try it
 * again. Never throws, and is time-boxed, so it can't hold up or break the
 * booking, payment or payout the email rides along with.
 *
 * Only genuine transient failures are queued: a suppressed reserved-TLD address
 * never fails (sendEmail returns true for it), and a send with no API key or no
 * recipient is a configuration fault a retry cannot fix, so neither is queued.
 */
export async function queueFailedEmail(
    to: string,
    subject: string,
    html: string,
    idempotencyKey: string,
    client?: any,
): Promise<void> {
    try {
        if (!to || isAutomatedTestAddress(to)) return;
        if (!idempotencyKey) return;
        // No key means nothing is being emailed at all — a retry cannot help, and
        // a local run without one would otherwise fill the queue with sends that
        // can never succeed.
        if (!process.env.RESEND_API_KEY) return;
        if (!client && !enabled()) return;

        const admin = client || adminClient();
        await withTimeout(
            admin.from('email_outbox').upsert({
                idempotency_key: idempotencyKey,
                to_email: to,
                subject: String(subject || '').slice(0, 300),
                html: String(html || ''),
                status: 'pending',
                attempts: 0,
                next_attempt_at: new Date(Date.now() + INITIAL_DELAY_MS).toISOString(),
            }, { onConflict: 'idempotency_key', ignoreDuplicates: true }),
            RECORD_TIMEOUT_MS,
        );
    } catch {
        // Recording a retry must never break the send path.
    }
}

/** Claim one due row (pending → sending). The row, or null if someone else won it. */
async function claim(admin: any, id: string, now: Date): Promise<any | null> {
    const { data } = await admin
        .from('email_outbox')
        .update({ status: 'sending', claimed_at: now.toISOString() })
        .eq('id', id)
        .eq('status', 'pending')
        .select('*');
    return data && data[0] ? data[0] : null;
}

/**
 * Re-send every email now due. `send` is lib/email's sendEmailOnly, injected so
 * this file never imports lib/email (and so the resend records no fresh push —
 * the push was recorded when the email was first tried). Never throws: whatever
 * is not reached stays pending for the next run.
 */
export async function drainEmailOutbox(
    admin: any,
    send: EmailSender,
    opts: { now?: Date } = {},
): Promise<{ claimed: number; sent: number; failed: number; retrying: number }> {
    const tally = { claimed: 0, sent: 0, failed: 0, retrying: 0 };
    try {
        const now = opts.now || new Date();

        // A run that died mid-send leaves a row 'sending'; put it back to
        // pending once it is clearly abandoned. Re-sending is safe — the
        // Idempotency-Key stops Resend doubling an email that did go out.
        await admin.from('email_outbox')
            .update({ status: 'pending', claimed_at: null })
            .eq('status', 'sending')
            .lt('claimed_at', new Date(now.getTime() - STALE_MINUTES * 60000).toISOString());

        // Rows nobody needs any more.
        await admin.from('email_outbox')
            .delete()
            .in('status', ['sent', 'failed'])
            .lt('created_at', new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString());

        const { data: due } = await admin.from('email_outbox')
            .select('id')
            .eq('status', 'pending')
            .lte('next_attempt_at', now.toISOString())
            .order('next_attempt_at', { ascending: true })
            .limit(BATCH);

        for (const d of due || []) {
            const row = await claim(admin, d.id, now);
            if (!row) continue;
            tally.claimed++;

            let ok = false;
            try { ok = await send(row.to_email, row.subject, row.html, row.idempotency_key); }
            catch { ok = false; }

            if (ok) {
                await admin.from('email_outbox')
                    .update({ status: 'sent', done_at: now.toISOString() })
                    .eq('id', row.id);
                tally.sent++;
                continue;
            }

            const attempts = (row.attempts || 0) + 1;
            if (attempts >= MAX_ATTEMPTS) {
                await admin.from('email_outbox')
                    .update({ status: 'failed', attempts, done_at: now.toISOString(), last_error: 'gave up after ' + attempts + ' attempts' })
                    .eq('id', row.id);
                tally.failed++;
            } else {
                const delay = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
                await admin.from('email_outbox')
                    .update({ status: 'pending', attempts, claimed_at: null, next_attempt_at: new Date(now.getTime() + delay * 60000).toISOString() })
                    .eq('id', row.id);
                tally.retrying++;
            }
        }
    } catch {
        // Leave whatever was not reached for the next run.
    }
    return tally;
}
