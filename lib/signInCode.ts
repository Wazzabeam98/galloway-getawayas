// Send and check a six-digit code to an email address OR a UK mobile — the
// engine behind the Log in or sign up panel (components/auth/AuthPanel).
//
// The email half is lib/emailCodeSignIn's, unchanged: signInWithOtp with
// shouldCreateUser, then verifyOtp type 'email'. The phone half is the same
// call with { phone } — Supabase sends the text through the project's SMS
// provider (Twilio, the account that already texts trades about emergency
// call-outs) and verifyOtp type 'sms' checks it.
//
// The same three rules as the email step:
//  - Nothing exists until the code is entered.
//  - It never says whether an address or number already has an account: the
//    same "we sent a code" screen follows for both.
//  - Supabase's raw wording never reaches the person.
//
// Kept free of React and of '@/' imports so the unit test can run it directly.

import { explainSendError, explainVerifyError, tidyCode, Outcome } from './emailCodeSignIn';

export type CodeTarget = { kind: 'email' | 'phone'; value: string };

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
    if (/invalid.*phone|phone.*invalid/i.test(message)) {
        return 'That number doesn’t look right. Check it, or use your email address instead.';
    }
    return 'We couldn’t text your code. Check the number, or use your email address instead.';
}

// emailRedirectTo: where the link in the email (for anyone who taps it rather
// than typing the code) brings them back to. The caller passes the page they
// were on, so a guest mid-booking lands back on the listing with their dates.
export async function sendSignInCode(
    client: CodeClient,
    target: CodeTarget,
    emailRedirectTo?: string
): Promise<Outcome> {
    if (target.kind === 'phone') {
        const { error } = await client.auth.signInWithOtp({
            phone: target.value,
            options: { shouldCreateUser: true, channel: 'sms' },
        });
        if (error) return { ok: false, message: explainSmsSendError(error) };
        return { ok: true, value: undefined };
    }
    const options: Record<string, unknown> = { shouldCreateUser: true };
    if (emailRedirectTo) options.emailRedirectTo = emailRedirectTo;
    const { error } = await client.auth.signInWithOtp({ email: target.value, options });
    if (error) return { ok: false, message: explainSendError(error) };
    return { ok: true, value: undefined };
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
