// "Stay signed in on this device" — how long a sign-in lasts, and why the
// server re-issues the sign-in cookie on every page.
//
// WHAT WAS GOING WRONG. Supabase itself never ends a session here (time-box and
// inactivity timeout are both "never" on production), and the auth helpers ask
// for a cookie that lasts for ever. But the cookie is mostly written by
// JavaScript in the page (document.cookie, every time the hourly access token
// refreshes in an open tab), and Safari — every iPhone, and Safari on a Mac —
// caps a cookie written by script at SEVEN DAYS. The only place the server
// re-issued it was /dashboard. So a guest on an iPhone who did not visit for a
// week came back signed out, and met the welcome-back panel far more often
// than a deliberate sign-out would explain.
//
// THE FIX. The middleware re-issues the sign-in cookie on every page load, from
// the server, with an explicit lifetime. A server-set first-party cookie is not
// capped by Safari, and each visit pushes the expiry forward again.
//
// HOW LONG. Matched to Airbnb, measured rather than guessed: in a browser
// signed in to airbnb.co.uk on 02/10/2026 its logged-in cookies ("li", "hli")
// were set to run about a year (373 days left). So: 365 days, renewed on every
// visit — come back within a year of your last visit and you are still in.
//
// THE CHOICE. The tick on the Log in or sign up panel, on by default. Unticked
// (a shared or borrowed computer) the sign-in cookie becomes a browser-session
// cookie, gone when the browser closes, and the device does not remember the
// account for the welcome-back panel.
//
// THE CHOICE BELONGS TO ONE SIGN-IN, NOT TO THE DEVICE. It used to be a gg_stay
// cookie of "0" or "1" that lasted a year. Only the Log in or sign up panel
// wrote it; the other ways in (the email step on List your home and the
// provider sign-up, a password, an emailed link) did not. So one untick, ever,
// left "0" behind, and every later sign-in on that device by any other route
// quietly became a browser-session sign-in that a closed tab or a phone
// reclaiming memory ended. Recording the choice on every route is necessary but
// not enough on its own: the next route someone adds would forget.
//
// So "don't stay" is now bound to the session it was chosen for. The panel
// writes gg_nostay=pending (fifteen minutes, enough to type a code or go round
// Google); the middleware, on the first page of the new session, rebinds it to
// that session's id. From then on it only counts while the session id matches.
// A value from any earlier sign-in matches nothing, so it is ignored and
// deleted, whichever route the new sign-in came by. Absent means stay. The old
// gg_stay cookie is deleted on sight.
//
// Kept free of React and of '@/' imports so the unit test can run it directly.

export const STAY_COOKIE = 'gg_nostay';
export const LEGACY_STAY_COOKIE = 'gg_stay';
export const STAY_PENDING = 'pending';
export const STAY_PENDING_MAX_AGE_SECONDS = 15 * 60;
export const STAY_DAYS = 365;
export const STAY_MAX_AGE_SECONDS = STAY_DAYS * 24 * 60 * 60;

// sb-<project ref>-auth-token, and its .0/.1 chunks when the session is large.
const AUTH_COOKIE = /^sb-[a-z0-9]+-auth-token(\.\d+)?$/;

export function isAuthCookie(name: string): boolean {
    return AUTH_COOKIE.test(String(name || ''));
}

// Whether to stay signed in. Absent means stay: the tick is on by default.
// With the session id known (the middleware always knows it), only a "don't
// stay" bound to THIS session, or one just chosen, opts out. Without it (page
// code that has no session to hand) a value that is present is trusted: the
// middleware has already deleted any stale one on the response that served the
// page.
export function wantsToStay(value: string | null | undefined, sessionId?: string | null): boolean {
    if (!value) return true;
    if (value === STAY_PENDING) return false;
    if (!sessionId) return false;
    return value !== sessionId;
}

// What the middleware does with gg_nostay for a signed-in request: the
// lifetime to give the sign-in cookie, and how to rewrite the choice cookie —
// bind a pending choice to this session, delete one left by an earlier
// session, or leave it.
export function resolveStayChoice(
    value: string | null | undefined,
    sessionId: string | null
): { stay: boolean; rewrite: { value: string } | 'delete' | null } {
    if (!value) return { stay: true, rewrite: null };
    if (value === STAY_PENDING) return { stay: false, rewrite: sessionId ? { value: sessionId } : null };
    if (sessionId && value === sessionId) return { stay: false, rewrite: null };
    return { stay: true, rewrite: 'delete' };
}

// The session id inside a sign-in cookie, read from the access token's payload
// (session_id). It does not change when the token refreshes, so the value the
// browser sent is good for the whole session. Not verified — it only decides
// which of the person's own cookies to keep. Null if it cannot be read.
export function sessionIdFromAuthCookie(raw: string | null | undefined): string | null {
    if (!raw) return null;
    try {
        let decoded = String(raw);
        try { decoded = decodeURIComponent(decoded); } catch { /* already plain */ }
        const parsed = JSON.parse(decoded);
        const token: string = Array.isArray(parsed) ? parsed[0] : parsed && parsed.access_token;
        return sessionIdFromAccessToken(token);
    } catch {
        return null;
    }
}

export function sessionIdFromAccessToken(token: string | null | undefined): string | null {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    try {
        const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '==='.slice((b64.length + 3) % 4);
        const json = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
        const sid = JSON.parse(json).session_id;
        return typeof sid === 'string' && sid ? sid : null;
    } catch {
        return null;
    }
}

// ---- noticing a lost sign-in --------------------------------------------------
//
// gg_seen is written by the middleware on every signed-in page: the session id
// and the time. It lives exactly as long as the sign-in cookie (a year, or the
// browser session), and a deliberate log out deletes it with the sign-in
// cookies. So a request that carries gg_seen but no sign-in cookie, or a sign-in
// cookie Supabase will no longer honour, is a sign-in the person did not end —
// the thing that must not happen — and it is reported (lostSignInToReport).

export const SEEN_COOKIE = 'gg_seen';

export function seenValue(sessionId: string, nowSeconds: number): string {
    return sessionId + '.' + Math.floor(nowSeconds);
}

export function parseSeen(value: string | null | undefined): { sessionId: string; at: number } | null {
    const m = /^([0-9a-f-]{8,64})\.(\d{9,11})$/i.exec(String(value || ''));
    return m ? { sessionId: m[1], at: Number(m[2]) } : null;
}

export type LostSignIn = 'cookie_gone' | 'session_refused';

// Report only on a real page load (not a prefetch or a router fetch, which
// arrive in bursts and would report one loss several times), and only when
// this device had a live sign-in it did not end.
export function lostSignInToReport(args: {
    seen: { sessionId: string; at: number } | null;
    hasAuthCookie: boolean;
    sessionOk: boolean;
    isDocument: boolean;
}): LostSignIn | null {
    if (!args.seen || !args.isDocument) return null;
    if (!args.hasAuthCookie) return 'cookie_gone';
    if (!args.sessionOk) return 'session_refused';
    return null;
}

// How long a device can be away before a missing sign-in cookie is the normal
// end of it rather than a fault. The fault this report exists for drops the
// cookie within an hour or two (the first token refresh, 3 Oct 2026); a
// device that comes back the next morning without it has usually had the
// browser closed overnight, which ends a browser-session sign-in as designed.
// So a cookie_gone after this long is recorded as information, and only a
// sooner one is an error. session_refused is always an error.
export const EXPECTED_COOKIE_LOSS_MINUTES = 12 * 60;

export function lostSignInIsExpected(kind: LostSignIn, minutesSinceSeen: unknown): boolean {
    const minutes = Number(minutesSinceSeen);
    return kind === 'cookie_gone' && isFinite(minutes) && minutes >= EXPECTED_COOKIE_LOSS_MINUTES;
}

// A plain cookie line for the middleware's own cookies (gg_nostay, gg_seen).
// maxAge undefined = ends with the browser; 0 = delete.
export function serializeCookie(name: string, value: string, opts: { maxAge?: number; secure: boolean }): string {
    let out = name + '=' + value + '; Path=/; SameSite=Lax';
    if (opts.maxAge !== undefined) out += '; Max-Age=' + opts.maxAge;
    if (opts.secure) out += '; Secure';
    return out;
}

export interface CookieStamp {
    name: string;
    value: string;
    options: { path: string; sameSite: 'lax'; secure: boolean; httpOnly: false; maxAge?: number };
}

// The cookies to re-issue on a response, given what the browser sent and what
// the middleware has already written (a refresh replaces the token, and that
// newer value must win — re-stamping the old one would sign the person out
// with a spent refresh token). A cookie the refresh emptied is left alone.
export function stampsFor(
    requestCookies: { name: string; value: string }[],
    responseCookies: { name: string; value: string }[],
    stay: boolean,
    secure: boolean
): CookieStamp[] {
    const written = new Map(responseCookies.filter((c) => isAuthCookie(c.name)).map((c) => [c.name, c.value]));
    const names = new Set<string>([
        ...requestCookies.filter((c) => isAuthCookie(c.name)).map((c) => c.name),
        ...Array.from(written.keys()),
    ]);
    const sent = new Map(requestCookies.map((c) => [c.name, c.value]));
    const out: CookieStamp[] = [];
    names.forEach((name) => {
        const value = written.has(name) ? written.get(name)! : sent.get(name) || '';
        if (!value) return;
        const options: CookieStamp['options'] = { path: '/', sameSite: 'lax', secure, httpOnly: false };
        if (stay) options.maxAge = STAY_MAX_AGE_SECONDS;
        out.push({ name, value, options });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Header-level helpers. The middleware client appends raw Set-Cookie headers
// itself, and NextResponse.cookies.set would REPLACE every Set-Cookie header
// with its own list (dropping a just-refreshed token), so the stamps are
// appended as raw headers too, after the client's — the last one wins.

// Name and raw value of each Set-Cookie line. Auth cookies carry Max-Age, not
// Expires, so a comma is only ever a header separator for them.
export function parseSetCookies(header: string | null | undefined): { name: string; value: string }[] {
    if (!header) return [];
    return header
        .split(/,(?=\s*[^;=\s]+=)/)
        .map((line) => line.trim().split(';')[0])
        .map((pair) => {
            const i = pair.indexOf('=');
            return i > 0 ? { name: pair.slice(0, i).trim(), value: pair.slice(i + 1) } : null;
        })
        .filter((c): c is { name: string; value: string } => !!c);
}

export function serializeStamp(s: CookieStamp): string {
    let out = s.name + '=' + s.value + '; Path=' + s.options.path + '; SameSite=Lax';
    if (s.options.maxAge !== undefined) out += '; Max-Age=' + s.options.maxAge;
    if (s.options.secure) out += '; Secure';
    return out;
}

// The browser's Cookie header, name and RAW value. Not request.cookies: Next
// URL-decodes values as it reads them, and the session cookie is an encoded
// JSON array — re-issuing the decoded form would corrupt it.
export function parseCookieHeader(header: string | null | undefined): { name: string; value: string }[] {
    if (!header) return [];
    return header
        .split(/;\s*/)
        .map((pair) => {
            const i = pair.indexOf('=');
            return i > 0 ? { name: pair.slice(0, i).trim(), value: pair.slice(i + 1) } : null;
        })
        .filter((c): c is { name: string; value: string } => !!c);
}

// ---- browser side -----------------------------------------------------------

function readCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const hit = document.cookie.split(/;\s*/).find((p) => p.startsWith(name + '='));
    return hit ? hit.slice(name.length + 1) : null;
}

// Pass the session's access token where it is to hand (an auth event carries
// it); without one, see wantsToStay.
export function stayChoiceInBrowser(accessToken?: string | null): boolean {
    return wantsToStay(readCookie(STAY_COOKIE), sessionIdFromAccessToken(accessToken));
}

function deleteCookie(name: string): void {
    document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax';
    if (location.protocol === 'https:') document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax; Secure';
}

// EVERY way of signing in calls this, just before the sign-in itself (code
// typed, password entered, Google pressed): the panel with its tick, every
// other route with true. "Stay" deletes any choice cookie, so nothing from an
// earlier sign-in can carry over; "don't stay" leaves a short-lived pending
// one for the middleware to bind to the new session. The test
// stay-signed-in.test.ts holds every sign-in route to it.
export function recordStayChoice(stay: boolean): void {
    if (typeof document === 'undefined') return;
    deleteCookie(LEGACY_STAY_COOKIE);
    if (stay) {
        deleteCookie(STAY_COOKIE);
        return;
    }
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = STAY_COOKIE + '=' + STAY_PENDING + '; Path=/; Max-Age=' + STAY_PENDING_MAX_AGE_SECONDS + '; SameSite=Lax' + secure;
}

// Signing in again while already signed in (the password check before a
// password change) starts a new session; carry this one's choice over to it.
export function carryStayChoice(): void {
    if (!stayChoiceInBrowser()) recordStayChoice(false);
}

// A deliberate sign-out: the next sign-in decides afresh.
export function clearStayChoice(): void {
    if (typeof document === 'undefined') return;
    deleteCookie(STAY_COOKIE);
    deleteCookie(LEGACY_STAY_COOKIE);
}

// "Don't stay": turn the sign-in cookie the page script just wrote back into a
// browser-session cookie, so closing the browser still signs them out.
export function makeAuthCookiesSessionOnly(): void {
    if (typeof document === 'undefined') return;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie.split(/;\s*/).forEach((pair) => {
        const i = pair.indexOf('=');
        const name = i > 0 ? pair.slice(0, i) : '';
        if (isAuthCookie(name)) document.cookie = name + '=' + pair.slice(i + 1) + '; Path=/; SameSite=Lax' + secure;
    });
}

// ---- signing out of THIS device ----------------------------------------------
//
// Every "Log out" a person presses goes through here: the account menu, "Not
// now — log out" on the terms prompt, and the way out of a sign-up they will
// not finish. It ends this device's session and nothing else.
//
// WHY THIS EXISTS. supabase.auth.signOut() with no options is scope 'global':
// it ended the session on EVERY device. Logging out on a phone signed the
// laptop out too — not at once (its access token stays valid for up to an
// hour, so the laptop still looked signed in) but at its next visit, when the
// refresh was refused and the welcome-back panel asked for a code, however the
// "Stay signed in" tick had been set. The dialog has always said "You'll be
// signed out on this device"; now that is what happens. Signing out
// everywhere is its own button in Account, and closing or deactivating an
// account still ends every session.
//
// AND THE COOKIE GOES WHATEVER THE SERVER SAYS. The library only clears its own
// session when the server answers 200, 401 or 404. A session already ended
// elsewhere answers 403 ("session not found"), the library kept the cookie,
// and the middleware went on re-issuing that dead cookie for a year — so the
// log out button appeared to do nothing until the hour ran out.

// Delete every sign-in cookie this page can see, with and without Secure (the
// middleware writes Secure on https; the page script writes it without) — and
// gg_seen with them, so a sign-out someone chose is never reported as lost.
// Every deliberate ending of a session on this device calls this.
export function clearAuthCookies(): void {
    if (typeof document === 'undefined') return;
    document.cookie.split(/;\s*/).forEach((pair) => {
        const i = pair.indexOf('=');
        const name = i > 0 ? pair.slice(0, i) : '';
        if (isAuthCookie(name)) deleteCookie(name);
    });
    deleteCookie(SEEN_COOKIE);
}

export async function signOutThisDevice(supabase: { auth: { signOut: (o: { scope: 'local' }) => Promise<unknown> } }): Promise<void> {
    try {
        await supabase.auth.signOut({ scope: 'local' });
    } catch {
        // No connection, or the session was already gone: cleared below anyway.
    }
    clearAuthCookies();
    clearStayChoice();
}
