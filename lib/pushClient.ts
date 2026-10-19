// Web push: the browser half. Only ever called from client components.
//
// Permission is asked for ONLY from a button the person pressed (a booking
// made, a message sent, the host dashboard) — never on page load. Browsers
// punish sites that ask unprompted, and Safari refuses outright without a tap.

// Remembered per device. The iPhone "add to Home Screen first" note has its own
// key, so reading it in Safari doesn't stop the real question being asked once
// the Home Screen app is opened.
const ASKED_KEY = { ask: 'gg-push-ask-dismissed', ios: 'gg-push-ios-explained' };

function hasWindow(): boolean {
    return typeof window !== 'undefined' && typeof navigator !== 'undefined';
}

export function isIOSDevice(): boolean {
    if (!hasWindow()) return false;
    return /\b(iPhone|iPod|iPad)\b/.test(navigator.userAgent || '');
}

export function isPhone(): boolean {
    if (!hasWindow()) return false;
    return /\b(iPhone|iPod|Android.+Mobile)\b/.test(navigator.userAgent || '');
}

/** Opened from the Home Screen rather than in a browser tab. */
export function isStandalone(): boolean {
    if (!hasWindow()) return false;
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || (navigator as any).standalone === true;
}

export function pushSupported(): boolean {
    if (!hasWindow()) return false;
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
        && !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
}

/** iPhone Safari can only push once the site is added to the Home Screen. */
export function needsHomeScreenFirst(): boolean {
    return isIOSDevice() && !isStandalone();
}

export function permission(): NotificationPermission | 'unsupported' {
    return pushSupported() ? Notification.permission : 'unsupported';
}

export function askDismissed(kind: 'ask' | 'ios' = 'ask'): boolean {
    try { return localStorage.getItem(ASKED_KEY[kind]) === '1'; } catch { return false; }
}

export function dismissAsk(kind: 'ask' | 'ios' = 'ask'): void {
    try { localStorage.setItem(ASKED_KEY[kind], '1'); } catch { /* private mode */ }
}

function keyBytes(base64url: string): Uint8Array {
    const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
    const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
    try {
        const existing = await navigator.serviceWorker.getRegistration('/');
        return existing || await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch {
        return null;
    }
}

async function subscribeAndSave(): Promise<boolean> {
    const reg = await registration();
    if (!reg) return false;
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '') as any,
        });
    }
    const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return res.ok;
}

/** From a button press: ask, subscribe, save. */
export async function enablePush(): Promise<'granted' | 'denied' | 'unsupported' | 'error'> {
    if (!pushSupported()) return 'unsupported';
    try {
        const answer = await Notification.requestPermission();
        if (answer !== 'granted') return answer === 'denied' ? 'denied' : 'error';
        return (await subscribeAndSave()) ? 'granted' : 'error';
    } catch {
        return 'error';
    }
}

/** Already said yes on this device: make sure the server has it for whoever is signed in now. */
export async function syncPush(): Promise<void> {
    if (permission() !== 'granted') return;
    try { await subscribeAndSave(); } catch { /* best effort */ }
}

/** Signing out on this device: stop pushing this account's news to it. */
export async function forgetPushOnThisDevice(): Promise<void> {
    if (!pushSupported()) return;
    try {
        const reg = await navigator.serviceWorker.getRegistration('/');
        const sub = reg && await reg.pushManager.getSubscription();
        if (!sub) return;
        await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
    } catch {
        // Offline or already gone: signing out goes ahead regardless.
    }
}
