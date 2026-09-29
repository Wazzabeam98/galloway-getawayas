// The shared "What's your email?" first step — the sign-in logic, apart from
// the screen that draws it (components/auth/EmailFirstStep).
//
// Every sign-up on the site is meant to begin the same way: type an email, get
// a six-digit code, type it in, and you're signed in — a new account made on
// the spot, or your existing one if the address already has one. It is the
// same mechanism the guest-experience wizard's g_verify step has used since
// September (signInWithOtp with shouldCreateUser, then verifyOtp type 'email'),
// lifted out so the holiday-let sign-up — and, next, the guest and trade flows —
// share one copy instead of three.
//
// Three rules it keeps:
//
//  - Nothing exists until the code is entered. shouldCreateUser only creates
//    the auth user; it is not confirmed and cannot sign in until verifyOtp
//    succeeds, so nobody can squat an address they don't own.
//  - It never says whether an address already has an account. The same code
//    email goes to both, and the password route below answers "wrong email or
//    password" for both kinds of failure.
//  - An account that has a password can still use it. The code is the default,
//    not the only way in (logInWithPassword).
//
// Kept free of React and of '@/' imports so the unit test can run it directly.

export interface AuthLike {
    auth: {
        signInWithOtp(args: { email: string; options?: { shouldCreateUser?: boolean; data?: Record<string, unknown> } }): Promise<{ error: any }>;
        verifyOtp(args: { email: string; token: string; type: 'email' }): Promise<{ data: { session: any } | null; error: any }>;
        signInWithPassword(args: { email: string; password: string }): Promise<{ data: { session: any } | null; error: any }>;
    };
}

export type Outcome<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

// Supabase sends six digits by default, but a project can be set to anything
// from six to ten; accept up to ten rather than silently truncating a longer
// code into one that can never work.
export const CODE_MAX_LENGTH = 10;

export function tidyEmail(raw: string): string {
    return (raw || '').trim().toLowerCase();
}

// Deliberately loose — it only has to catch a slip (a missing @, a space),
// not decide what an address is. Supabase is the real judge.
export function looksLikeEmail(raw: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tidyEmail(raw));
}

// Keeps what a person pastes usable: "123 456", "123-456" and a code copied
// with a trailing newline all become "123456".
export function tidyCode(raw: string): string {
    return (raw || '').replace(/[^0-9]/g, '').slice(0, CODE_MAX_LENGTH);
}

function isRateLimited(err: any): boolean {
    return (err && err.status === 429) || /rate limit|security purposes|too many/i.test((err && err.message) || '');
}

// Two different refusals come back as a 429, and they need different words:
//  - "For security purposes, you can only request this after N seconds" is the
//    per-address cooldown — a code has just gone to this address.
//  - "email rate limit exceeded" (over_email_send_rate_limit) is the whole
//    project's email allowance running out — nothing was sent to anyone, so
//    "use the code we already sent" would be untrue.
function isSiteEmailLimit(err: any): boolean {
    return (err && err.code === 'over_email_send_rate_limit') || /email rate limit/i.test((err && err.message) || '');
}

// Plain-English wording for what Supabase says back. Raw messages like
// "Token has expired or is invalid" read as the site being broken.
export function explainSendError(err: any): string {
    if (isSiteEmailLimit(err)) {
        return 'We couldn’t send your code just now — too many emails have gone out from the site in the last hour. Nothing is wrong with your address. Please try again later.';
    }
    if (isRateLimited(err)) {
        return 'We’ve just sent a code to this address. Wait a minute before asking for another.';
    }
    if (/signups? not allowed|signup.*disabled/i.test((err && err.message) || '')) {
        return 'New accounts can’t be created just now. Please try again later.';
    }
    if (/invalid.*email|email.*invalid/i.test((err && err.message) || '')) {
        return 'That email address doesn’t look right. Check it and try again.';
    }
    return 'We couldn’t send your code. Check your connection and try again.';
}

export function explainVerifyError(err: any): string {
    if (isRateLimited(err)) return 'Too many tries. Wait a minute, then try again.';
    if (/expired|invalid|not found/i.test((err && err.message) || '')) {
        return 'That code didn’t work. It may have expired — check it, or send a new one.';
    }
    return 'We couldn’t check your code. Check your connection and try again.';
}

export function explainPasswordError(err: any): string {
    const message: string = (err && err.message) || '';
    if (isRateLimited(err)) return 'Too many tries. Wait a minute, then try again.';
    if (/email not confirmed/i.test(message)) {
        return 'This address hasn’t been confirmed yet. Use an emailed code instead — it confirms it as it signs you in.';
    }
    if (/invalid login credentials/i.test(message)) {
        return 'That email and password don’t match. Try again, or use an emailed code instead.';
    }
    return 'We couldn’t sign you in. Check your connection and try again.';
}

export async function sendCode(client: AuthLike, rawEmail: string): Promise<Outcome> {
    const email = tidyEmail(rawEmail);
    if (!looksLikeEmail(email)) return { ok: false, message: 'Enter your email address.' };
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) return { ok: false, message: explainSendError(error) };
    return { ok: true, value: undefined };
}

export async function verifyCode(client: AuthLike, rawEmail: string, rawCode: string): Promise<Outcome<any>> {
    const email = tidyEmail(rawEmail);
    const token = tidyCode(rawCode);
    if (token.length < 6) return { ok: false, message: 'Enter the 6-digit code from your email.' };
    const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
    if (error || !data || !data.session) return { ok: false, message: explainVerifyError(error) };
    return { ok: true, value: data.session };
}

export async function logInWithPassword(client: AuthLike, rawEmail: string, password: string): Promise<Outcome<any>> {
    const email = tidyEmail(rawEmail);
    if (!looksLikeEmail(email)) return { ok: false, message: 'Enter your email address.' };
    if (!password) return { ok: false, message: 'Enter your password.' };
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data || !data.session) return { ok: false, message: explainPasswordError(error) };
    return { ok: true, value: data.session };
}

// Whether to ask "What's your name?" after signing in. Only when the account
// has none — a returning host keeps the name they already have, and a new one
// made by the code has none (the code step asks for nothing but the email).
export function needsName(profileFullName: string | null | undefined): boolean {
    return !(profileFullName || '').trim();
}
