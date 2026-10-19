// Web push: the server half.
//
// Called by the notification layer (app/api/notify) AFTER the email it goes
// with has been sent. Never from payment, payout or settlement code — a push is
// a nicety on top of an email, and nothing that moves money should wait on a
// phone's push service or be able to fail because of one.
//
// NEVER THROWS, AND NEVER WAITS LONG. Every send is time-boxed and every error
// is caught here, so a push service that is down, slow or refusing cannot hold
// up or break the email or the booking it rides along with. A device the push
// service says is gone (404/410 — the app was deleted, permission withdrawn)
// has its row removed; anything else is logged once and forgotten.
//
// Quiet when the VAPID keys are not set (local, CI, a preview without them):
// pushing is simply off, with nothing logged.

import webpush from 'web-push';
import { logError } from './logError';

export type PushMessage = {
    title: string;
    body: string;
    /** Where tapping it opens. Always a path on this site. */
    url: string;
    /** Same tag replaces the earlier notification instead of stacking. */
    tag?: string;
};

export type StoredSubscription = { endpoint: string; p256dh: string; auth: string };

// The push services browsers actually use. The server POSTs to whatever
// endpoint a browser hands /api/push/subscribe, so an unlisted host is refused
// at the door — otherwise the site could be made to send requests anywhere.
const PUSH_HOSTS: RegExp[] = [
    /(^|\.)fcm\.googleapis\.com$/,          // Chrome, Edge, Android
    /(^|\.)android\.googleapis\.com$/,
    /(^|\.)push\.apple\.com$/,              // Safari, iPhone Home Screen apps
    /(^|\.)push\.services\.mozilla\.com$/,  // Firefox
    /(^|\.)notify\.windows\.com$/,          // older Edge
];

export function isPushEndpoint(endpoint: unknown): boolean {
    if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
    try {
        const u = new URL(endpoint);
        return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
    } catch {
        return false;
    }
}

/** A subscription as the browser sends it, checked; null if it isn't one. */
export function cleanSubscription(input: any): StoredSubscription | null {
    const endpoint = input && input.endpoint;
    const keys = (input && input.keys) || {};
    const ok = (k: unknown) => typeof k === 'string' && /^[A-Za-z0-9_\-=]{8,200}$/.test(k);
    if (!isPushEndpoint(endpoint) || !ok(keys.p256dh) || !ok(keys.auth)) return null;
    return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

function clip(text: string, max: number): string {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** What the service worker receives. A site path only — never another origin. */
export function pushPayload(msg: PushMessage): string {
    const url = typeof msg.url === 'string' && msg.url.startsWith('/') && !msg.url.startsWith('//') ? msg.url : '/';
    return JSON.stringify({
        title: clip(msg.title, 80),
        body: clip(msg.body, 160),
        url,
        tag: msg.tag || undefined,
    });
}

export function pushConfigured(): boolean {
    return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

const SEND_TIMEOUT_MS = 5000;

type Sender = (sub: StoredSubscription, payload: string) => Promise<unknown>;

function webPushSender(): Sender {
    const subject = process.env.VAPID_SUBJECT || 'mailto:hello@gallowaygetaways.co.uk';
    return (sub, payload) => webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        {
            vapidDetails: {
                subject,
                publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
                privateKey: process.env.VAPID_PRIVATE_KEY || '',
            },
            TTL: 60 * 60 * 24,
            urgency: 'high',
            timeout: SEND_TIMEOUT_MS,
        },
    );
}

/**
 * Push to every device this person has turned notifications on for.
 * Returns how many accepted it. Never throws.
 */
export async function pushToUser(
    admin: any,
    userId: string | null | undefined,
    msg: PushMessage,
    send?: Sender,
): Promise<number> {
    try {
        if (!userId) return 0;
        if (!send && !pushConfigured()) return 0;
        const sender = send || webPushSender();

        const { data: subs, error } = await admin
            .from('push_subscriptions')
            .select('endpoint, p256dh, auth')
            .eq('user_id', userId);
        if (error) throw error;
        if (!subs || subs.length === 0) return 0;

        const payload = pushPayload(msg);
        let delivered = 0;
        let failure: any = null;

        await Promise.all(subs.map(async (sub: StoredSubscription) => {
            try {
                await withTimeout(sender(sub, payload), SEND_TIMEOUT_MS + 1000);
                delivered++;
            } catch (err: any) {
                const status = err && err.statusCode;
                if (status === 404 || status === 410) {
                    // The device is gone for good. Forget it.
                    await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
                } else {
                    failure = failure || err;
                }
            }
        }));

        if (failure) {
            await logError('[push] a push notification was not delivered', {
                status: failure.statusCode || null,
                error: (failure.body || failure.message || String(failure)).toString().slice(0, 300),
            }, { path: 'lib/push', userId });
        }
        return delivered;
    } catch (err: any) {
        await logError('[push] could not send push notifications', {
            error: (err && err.message) || String(err),
        }, { path: 'lib/push', userId: userId || undefined });
        return 0;
    }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('push timed out')), ms);
        p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
}
