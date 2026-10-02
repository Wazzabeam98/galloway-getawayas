// "Phone number or email" — the one field the Log in or sign up panel opens on
// (components/auth/AuthPanel), and the masking the welcome-back screen shows.
//
// Airbnb's panel takes either in a single box and works out which it was; so
// does this. The rules:
//
//  - An @ means email. Anything else that is mostly digits is a phone number.
//  - Phone numbers are UK mobiles only (07…, +44 7…, 44 7…). Texts cost money
//    per message and an open international field is how SMS-pumping fraud
//    runs up a bill, so anything else is refused with a plain way out: use
//    your email. The Twilio account's geo permissions are the server-side
//    half of this rule (the code is sent by Supabase, not by our server).
//  - Nothing is guessed. A number that cannot be read with confidence is
//    refused rather than texted.
//
// Kept free of React and of '@/' imports so the unit test can run it directly.

import { looksLikeEmail, tidyEmail } from './emailCodeSignIn';

export type Identifier =
    | { kind: 'email'; value: string }
    | { kind: 'phone'; value: string }
    | { kind: 'invalid'; message: string };

const NOT_A_UK_MOBILE = 'We can only text UK mobile numbers. Use your email address instead.';

// "07700 900123", "+44 (0)7700-900123", "447700900123" → "+447700900123".
// Returns null for anything that is not a UK mobile.
export function ukMobileToE164(raw: string): string | null {
    let s = String(raw || '').trim().replace(/\(0\)/g, '').replace(/[\s\-().]/g, '');
    if (s.startsWith('00')) s = '+' + s.slice(2);
    if (!/^\+?\d+$/.test(s)) return null;
    if (s.startsWith('+44')) s = s.slice(3);
    else if (s.startsWith('+')) return null;
    else if (s.startsWith('44') && s.length === 12) s = s.slice(2);
    if (s.startsWith('0')) s = s.slice(1);
    // A UK mobile is 7 followed by nine more digits.
    return /^7\d{9}$/.test(s) ? '+44' + s : null;
}

export function parseIdentifier(raw: string): Identifier {
    const s = String(raw || '').trim();
    if (!s) return { kind: 'invalid', message: 'Enter your phone number or email.' };
    if (s.includes('@')) {
        return looksLikeEmail(s)
            ? { kind: 'email', value: tidyEmail(s) }
            : { kind: 'invalid', message: 'That email address doesn’t look right. Check it and try again.' };
    }
    // Mostly digits (allowing the spaces, dashes, brackets and + people type).
    if (/^[+\d\s\-().]{6,}$/.test(s)) {
        const e164 = ukMobileToE164(s);
        return e164 ? { kind: 'phone', value: e164 } : { kind: 'invalid', message: NOT_A_UK_MOBILE };
    }
    return { kind: 'invalid', message: 'Enter a UK mobile number or an email address.' };
}

// "liamworrall18@hotmail.com" → "l•••••••••••8@hotmail.com". Enough to know
// it is yours, not enough to read it off someone else's screen.
export function maskEmail(email: string): string {
    const e = tidyEmail(email);
    const at = e.lastIndexOf('@');
    if (at < 1) return e;
    const local = e.slice(0, at);
    const domain = e.slice(at);
    if (local.length <= 2) return local[0] + '•' + domain;
    return local[0] + '•'.repeat(Math.min(local.length - 2, 8)) + local[local.length - 1] + domain;
}

// "+447700900123" → "07••• •••123".
export function maskPhone(e164: string): string {
    const digits = String(e164 || '').replace(/\D/g, '');
    const last = digits.slice(-3);
    return '07••• •••' + last;
}

// Readable form for "We texted a code to 07700 900123".
export function displayPhone(e164: string): string {
    const m = /^\+44(7\d{3})(\d{6})$/.exec(String(e164 || ''));
    return m ? '0' + m[1] + ' ' + m[2] : String(e164 || '');
}

export function maskIdentifier(id: { kind: 'email' | 'phone'; value: string }): string {
    return id.kind === 'email' ? maskEmail(id.value) : maskPhone(id.value);
}
