// Send and check a six-digit code to an email address OR a UK mobile — the
// engine behind the Log in or sign up panel (components/auth/AuthPanel).
//
// The email half is lib/emailCodeSignIn's, unchanged: signInWithOtp with
// shouldCreateUser, then verifyOtp type 'email'. The phone half is the same
// call with { phone } — Supabase sends the text through the project's SMS
// provider (Twilio, the account that already texts trades about emergency
// call-outs) and verifyOtp type 'sms' checks it.
//
// Two rules hold throughout:
//  - Nothing exists until the code is entered.
//  - Supabase's raw wording never reaches the person.
//
// The email step no longer hides whether an address has an account. It used to
// send the same "we sent a code" screen either way, so an unrecognised address
// silently became a new, empty account — which is exactly how a real host ended
// up stranded on a Gmail address she'd mistyped (Liam, 14 Nov 2026). Now, the
// Airbnb way: an unrecognised email is said so plainly ("no account with this
// email — create one, or try another?"), and the account is made only when the
// person chooses to. This trades the old no-enumeration property for clarity,
// deliberately, and only on this email panel. Phone is unchanged.
//
// Kept free of React and of '@/' imports so the unit test can run it directly.

import { explainSendError, explainVerifyError, tidyCode, Outcome } from './emailCodeSignIn';

export type CodeTarget = { kind: 'email' | 'phone'; value: string };

// A refusal that means "a code has only just gone to this address" — the
// per-address cooldown — and how many seconds are left on it. Supabase says
// "you can only request this after 42 seconds"; without a number, a minute.
// The site-wide email allowance running out is NOT this: nothing was sent.
export function retryAfterSeconds(err: any): number {
    const message: string = (err && err.message) || '';
    if ((err && err.code === 'over_email_send_rate_limit') || /email rate limit/i.test(message)) return 0;
    const m = /after (\d+) seconds?/i.exec(message);
    if (m) return Number(m[1]);
    if ((err && err.status === 429) || /security purposes/i.test(message)) return 60;
    return 0;
}

// A failed send carries a plain-English message and how long (if at all) to
// wait before another is allowed. noAccount is the one special case: the email
// has no account and we were told not to make one, so the panel asks the person
// whether to create one or fix a typo, rather than silently making a second,
// empty account (the trap that stranded a real host on a Gmail address she'd
// typed by mistake — Liam, 14 Nov 2026).
export type SendOutcome =
    | { ok: true }
    | { ok: false; message: string; retryAfter: number; noAccount?: boolean };

// signInWithOtp with shouldCreateUser:false and no matching account comes back
// as GoTrue's otp_disabled / "Signups not allowed for otp". That is the signal
// "this address is not on the site", and only ever reached on the create:false
// probe — a project that truly disallowed signups would be refused on the
// create:true call too, which this never conflates with it.
function isNoAccount(err: any): boolean {
    const message: string = (err && err.message) || '';
    return (err && err.code === 'otp_disabled') || /signups? not allowed/i.test(message);
}

export interface CodeClient {
    auth: {
        signInWithOtp(args: any): Promise<{ error: any }>;
        verifyOtp(args: any): Promise<{ data: { session: any } | null; error: any }>;
    };
}

function explainSmsSendError(err: any): string {
    const message: string = (err && err.message) || '';
    if ((err && err.status === 429) || /rate limit|security purposes|too many/i.test(message)) {
        return 'We’ve just texted a code to this number. Wait a minute before asking for another.';
    }
    if (/phone.*(disabled|not enabled)|unsupported phone provider|sms.*disabled/i.test(message)) {
        return 'We can’t text codes just now. Use your email address instead.';
    }
    // Supabase reached our text provider and the provider refused (422
    // sms_send_failed) — an account problem on our side, not the guest's
    // number. Found 02/10/2026: Twilio error 20003, the account's Trust Hub
    // business profile not yet approved. "Check the number" would blame them.
    if ((err && err.code === 'sms_send_failed') || /sending .*otp to provider/i.test(message)) {
        return 'We can’t send texts right now. Use your email address instead — we’re on it.';
    }
    if (/invalid.*phone|phone.*invalid/i.test(message)) {
        return 'That number doesn’t look right. Check it, or use your email address instead.';
    }
    return 'We couldn’t text your code. Check the number, or use your email address instead.';
}

// emailRedirectTo: where the link in the email (for anyone who taps it rather
// than typing the code) brings them back to. The caller passes the page they
// were on, so a guest mid-booking lands back on the listing with their dates.
// createUser: whether a missing account should be made on the spot. The email
// panel probes with createUser:false first, so an unrecognised address is
// caught (noAccount) and the person is asked before a second account is made;
// only the explicit "Create a new one" sends again with createUser:true. Phone
// keeps create-or-sign-in (it has its own second-account guard upstream, the
// phone-login-check), and defaulting to true leaves every other caller as it
// was.
export async function sendSignInCode(
    client: CodeClient,
    target: CodeTarget,
    emailRedirectTo?: string,
    opts: { createUser?: boolean } = {}
): Promise<SendOutcome> {
    if (target.kind === 'phone') {
        const { error } = await client.auth.signInWithOtp({
            phone: target.value,
            options: { shouldCreateUser: true, channel: 'sms' },
        });
        if (error) return { ok: false, message: explainSmsSendError(error), retryAfter: retryAfterSeconds(error) };
        return { ok: true };
    }
    const createUser = opts.createUser !== false;
    const options: Record<string, unknown> = { shouldCreateUser: createUser };
    if (emailRedirectTo) options.emailRedirectTo = emailRedirectTo;
    const { error } = await client.auth.signInWithOtp({ email: target.value, options });
    if (error) {
        if (!createUser && isNoAccount(error)) return { ok: false, noAccount: true, message: '', retryAfter: 0 };
        return { ok: false, message: explainSendError(error), retryAfter: retryAfterSeconds(error) };
    }
    return { ok: true };
}

export async function verifySignInCode(client: CodeClient, target: CodeTarget, rawCode: string): Promise<Outcome<any>> {
    const token = tidyCode(rawCode);
    if (token.length < 6) {
        return { ok: false, message: target.kind === 'phone' ? 'Enter the code we texted you.' : 'Enter the code from your email.' };
    }
    const args = target.kind === 'phone'
        ? { phone: target.value, token, type: 'sms' }
        : { email: target.value, token, type: 'email' };
    const { data, error } = await client.auth.verifyOtp(args);
    if (error || !data || !data.session) return { ok: false, message: explainVerifyError(error) };
    return { ok: true, value: data.session };
}
