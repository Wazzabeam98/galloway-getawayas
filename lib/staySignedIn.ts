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
// account for the welcome-back panel. The choice is the gg_stay cookie: absent
// or "1" means stay; "0" means don't. A deliberate sign-out clears it, so the
// next sign-in decides afresh.
//
// Kept free of React and of '@/' imports so the unit test can run it directly.

export const STAY_COOKIE = 'gg_stay';
export const STAY_DAYS = 365;
export const STAY_MAX_AGE_SECONDS = STAY_DAYS * 24 * 60 * 60;

// sb-<project ref>-auth-token, and its .0/.1 chunks when the session is large.
const AUTH_COOKIE = /^sb-[a-z0-9]+-auth-token(\.\d+)?$/;

export function isAuthCookie(name: string): boolean {
    return AUTH_COOKIE.test(String(name || ''));
}

// Absent means stay: the tick is on by default, and everyone who signed in
// before the tick existed should keep their sign-in, not lose it.
export function wantsToStay(stayCookieValue: string | null | undefined): boolean {
    return stayCookieValue !== '0';
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

export function stayChoiceInBrowser(): boolean {
    return wantsToStay(readCookie(STAY_COOKIE));
}

// Recorded at the moment of signing in (code accepted, or Google pressed), so
// the middleware knows which lifetime to give the cookie on the next page.
export function recordStayChoice(stay: boolean): void {
    if (typeof document === 'undefined') return;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = STAY_COOKIE + '=' + (stay ? '1' : '0') + '; Path=/; Max-Age=' + STAY_MAX_AGE_SECONDS + '; SameSite=Lax' + secure;
}

// A deliberate sign-out: the next sign-in decides afresh.
export function clearStayChoice(): void {
    if (typeof document === 'undefined') return;
    document.cookie = STAY_COOKIE + '=; Path=/; Max-Age=0; SameSite=Lax';
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
// middleware writes Secure on https; the page script writes it without).
export function clearAuthCookies(): void {
    if (typeof document === 'undefined') return;
    document.cookie.split(/;\s*/).forEach((pair) => {
        const i = pair.indexOf('=');
        const name = i > 0 ? pair.slice(0, i) : '';
        if (!isAuthCookie(name)) return;
        document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax';
        if (location.protocol === 'https:') document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax; Secure';
    });
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
