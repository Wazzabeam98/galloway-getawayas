// What this browser remembers about signing in, so the Log in or sign up
// panel (components/auth/AuthPanel) can do two things Airbnb does:
//
// 1. WELCOME BACK. Someone who signed out on this device is recognised next
//    time: their photo, their first name, their address masked, one Log in
//    button and a "Not you?". Written while they are signed in (the navbar's
//    RememberAccount) — so it is already there the moment they sign out — and
//    forgotten on "Not you?" or when the account is deleted or deactivated.
//
// 2. A CODE IN FLIGHT. A phone browser often throws the tab away while its
//    owner is in their mail or messages app fetching the code. The pending
//    sign-in is kept in sessionStorage (this tab only, gone when it closes)
//    so the reloaded page reopens the panel on "Confirm it's you" instead of
//    stranding the code.
//
// Browser storage can be missing or throw (private windows, blocked site
// data), so every read and write is wrapped and failure simply means "not
// remembered". Nothing here is trusted for anything but convenience — the
// code sent to the remembered address is still the proof.

export interface RememberedAccount {
    firstName: string;
    avatarUrl: string | null;
    kind: 'email' | 'phone';
    value: string;
}

export interface PendingSignIn {
    kind: 'email' | 'phone';
    value: string;
    at: number;
    next?: string | null;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const REMEMBER_KEY = 'gg_remembered_account';
export const PENDING_KEY = 'gg_pending_sign_in';
// A code lasts as long as Supabase keeps it; past this the panel starts fresh.
export const PENDING_TTL_MS = 15 * 60 * 1000;

function local(): StorageLike | null {
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}
function session(): StorageLike | null {
    try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

function read<T>(store: StorageLike | null, key: string): T | null {
    if (!store) return null;
    try {
        const raw = store.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}
function write(store: StorageLike | null, key: string, value: unknown): void {
    if (!store) return;
    try { store.setItem(key, JSON.stringify(value)); } catch { /* not remembered */ }
}
function remove(store: StorageLike | null, key: string): void {
    if (!store) return;
    try { store.removeItem(key); } catch { /* nothing to forget */ }
}

export function validRemembered(r: any): r is RememberedAccount {
    return !!r && (r.kind === 'email' || r.kind === 'phone') && typeof r.value === 'string' && r.value.length > 0
        && typeof r.firstName === 'string';
}

export function readRemembered(store: StorageLike | null = local()): RememberedAccount | null {
    const r = read<RememberedAccount>(store, REMEMBER_KEY);
    return validRemembered(r) ? r : null;
}
export function rememberAccount(r: RememberedAccount, store: StorageLike | null = local()): void {
    if (validRemembered(r)) write(store, REMEMBER_KEY, r);
}
export function forgetAccount(store: StorageLike | null = local()): void {
    remove(store, REMEMBER_KEY);
}

export function readPending(now: number = Date.now(), store: StorageLike | null = session()): PendingSignIn | null {
    const p = read<PendingSignIn>(store, PENDING_KEY);
    if (!p || (p.kind !== 'email' && p.kind !== 'phone') || !p.value || typeof p.at !== 'number') return null;
    if (now - p.at > PENDING_TTL_MS) {
        remove(store, PENDING_KEY);
        return null;
    }
    return p;
}
export function savePending(p: PendingSignIn, store: StorageLike | null = session()): void {
    write(store, PENDING_KEY, p);
}
export function clearPending(store: StorageLike | null = session()): void {
    remove(store, PENDING_KEY);
}

// ---- when a code last went to an address (this tab) -------------------------
//
// Supabase refuses a second code to the same address inside 60 seconds. Rather
// than let the press fail with "wait a minute", the panel remembers when it last
// sent one and goes straight to "Confirm it's you" with the seconds left on the
// resend button — the same screen and wording whether the person came through
// Log in on the welcome-back card, or through "Not you?" and typed it again.

export const RESEND_SECONDS = 60;
export const SENT_KEY = 'gg_code_sent';

export function recordCodeSent(value: string, at: number = Date.now(), store: StorageLike | null = session()): void {
    const map = read<Record<string, number>>(store, SENT_KEY) || {};
    map[value] = at;
    write(store, SENT_KEY, map);
}

export function secondsUntilResend(value: string, now: number = Date.now(), store: StorageLike | null = session()): number {
    const map = read<Record<string, number>>(store, SENT_KEY) || {};
    const at = map[value];
    if (typeof at !== 'number') return 0;
    return Math.max(0, Math.ceil(RESEND_SECONDS - (now - at) / 1000));
}
