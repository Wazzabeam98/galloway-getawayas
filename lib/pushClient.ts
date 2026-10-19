// Web push: the browser half. Only ever called from client components.
//
// Permission is asked for ONLY from a button the person pressed (a booking
// made, a message sent, the host dashboard) — never on page load. Browsers
// punish sites that ask unprompted, and Safari refuses outright without a tap.

// Remembered per device. "Not now" is remembered with WHEN it was said: the
// question comes back after a booking or a message, but never within a week of
// the last "Not now" (Airbnb's rhythm). The first-open card in the installed
// app is shown once per device (FIRST_RUN_KEY).
const ASK_KEY = 'gg-push-ask-dismissed-at';
const FIRST_RUN_KEY = 'gg-push-first-run-done';
export const ASK_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

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

/** True while a "Not now" from the last week still stands. */
export function askDismissed(now: number = Date.now()): boolean {
    try {
        const at = Number(localStorage.getItem(ASK_KEY) || 0);
        return at > 0 && now - at < ASK_AGAIN_AFTER_MS;
    } catch { return false; }
}

/** "Not now": don't ask again for a week. */
export function dismissAsk(now: number = Date.now()): void {
    try { localStorage.setItem(ASK_KEY, String(now)); } catch { /* private mode */ }
}

/** The installed app's first-open card has been shown on this device. */
export function firstRunDone(): boolean {
    try { return localStorage.getItem(FIRST_RUN_KEY) === '1'; } catch { return true; }
}

export function markFirstRunDone(): void {
    try { localStorage.setItem(FIRST_RUN_KEY, '1'); } catch { /* private mode */ }
}

/** The installed app's first-open card: whether to show it now. */
export function shouldAskOnFirstRun(state: {
    standalone: boolean;
    supported: boolean;
    permission: string;
    signedIn: boolean;
    firstRunDone: boolean;
    snoozed: boolean;
    path: string;
}): boolean {
    return state.standalone
        && state.supported
        && state.permission === 'default'
        && state.signedIn
        && !state.firstRunDone
        && !state.snoozed
        && !state.path.startsWith('/auth');
}

/** Safari itself on an iPhone — the only iPhone browser whose Share sheet can add to the Home Screen reliably; not Chrome, Firefox or an app's built-in browser (Instagram, Facebook, Gmail). */
export function isIOSSafari(): boolean {
    if (!hasWindow()) return false;
    const ua = navigator.userAgent || '';
    return /\b(iPhone|iPod)\b/.test(ua) && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\/|Snapchat|LinkedInApp/.test(ua);
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
