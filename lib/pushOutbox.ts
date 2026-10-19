// The one shared layer for push notifications: RECORD, never send.
//
// Every email the site sends records a push here (lib/email → recordEmailPush),
// so a new email gets a push without anyone remembering to add one. Events with
// no email (security alerts, day-of reminders) record one with queuePush. The
// push job (/api/cron/push-outbox → lib/pushDispatch) sends each row exactly
// once, later and elsewhere.
//
// That split is the point. sendEmail is called from inside payment, payout and
// settlement code (the Stripe webhook, the payout cron); a push must never be
// SENT from there. Recording is one insert, time-boxed, and every failure is
// swallowed — it can't hold up or break the email, the booking or the payment
// it rides along with.

import { adminClient } from './supabaseAdmin';
import { isAutomatedTestAddress } from './testAddresses';
import { pushForEmail, type PushSpec, scrubPushText } from './pushRules';
import { isPushCategory, type PushCategory } from './pushCategories';
import { createHash } from 'crypto';

const RECORD_TIMEOUT_MS = 1500;

export type QueuedPush = {
    dedupeKey: string;
    kind: string;
    category: PushCategory;
    title: string;
    body: string;
    url: string;
    userId?: string | null;
    toEmail?: string | null;
    context?: Record<string, unknown>;
    source?: 'email' | 'event';
};

function londonDay(at: Date = new Date()): string {
    return at.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | null> {
    return new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), ms);
        Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
    });
}

function enabled(): boolean {
    return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
        && process.env.PUSH_OUTBOX_DISABLED !== '1';
}

/** The row for a push. Exported for tests. */
export function outboxRow(p: QueuedPush) {
    return {
        dedupe_key: p.dedupeKey.slice(0, 300),
        source: p.source || 'event',
        kind: p.kind.slice(0, 80),
        user_id: p.userId || null,
        to_email: p.toEmail ? p.toEmail.trim().toLowerCase() : null,
        category: isPushCategory(p.category) ? p.category : 'reservations',
        title: scrubPushText(p.title, 80),
        body: scrubPushText(p.body, 160),
        url: p.url && p.url.startsWith('/') && !p.url.startsWith('//') ? p.url.slice(0, 300) : '/',
        context: p.context || {},
    };
}

/** Record a push. Returns the dedupe key if recorded (or already there), null if not. Never throws. */
export async function queuePush(p: QueuedPush, client?: any): Promise<string | null> {
    try {
        if (!client && !enabled()) return null;
        const admin = client || adminClient();
        const res: any = await withTimeout(
            admin.from('push_outbox').upsert(outboxRow(p), { onConflict: 'dedupe_key', ignoreDuplicates: true }),
            RECORD_TIMEOUT_MS,
        );
        return res && !res.error ? p.dedupeKey : null;
    } catch {
        return null;
    }
}

/**
 * Called by sendEmail for every email. `override` lets a caller that knows
 * better give the push its own words; `false` means this email has no push
 * (the caller recorded one itself). Never throws.
 */
export async function recordEmailPush(
    to: string,
    subject: string,
    html: string,
    override?: Partial<PushSpec> | false,
    client?: any,
): Promise<string | null> {
    try {
        if (override === false) return null;
        if (!to || isAutomatedTestAddress(to)) return null;
        const derived = pushForEmail(subject, html);
        if (!derived && !override) return null;
        const spec: PushSpec = { ...(derived as PushSpec), ...(override || {}) } as PushSpec;
        // The same email to the same person on the same day is one push — a
        // redelivered webhook that sends the email twice still pushes once.
        const fingerprint = createHash('sha256')
            .update(to.toLowerCase() + '\n' + subject + '\n' + html)
            .digest('hex').slice(0, 32);
        return await queuePush({
            dedupeKey: 'email:' + londonDay() + ':' + fingerprint,
            source: 'email',
            kind: spec.kind,
            category: spec.category,
            title: spec.title,
            body: spec.body,
            url: spec.url,
            toEmail: to,
            context: { ...(spec.context || {}), ...(spec.cohost ? { cohost: spec.cohost } : {}) },
        }, client);
    } catch {
        return null;
    }
}
