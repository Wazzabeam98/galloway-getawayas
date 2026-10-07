import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { ukMobileToE164 } from '@/lib/signInIdentifier';
import { phoneLoginDecision } from '@/lib/phoneLogin';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// The one case the Log in panel must stop before it sends a phone code: a number
// that is NOT a confirmed login phone, but is sitting unconfirmed on some
// account's Account-details (profiles.phone). Signing in with it would create a
// new, empty account instead of opening theirs — so we block it and point them
// at the fix (log in with email, confirm the number in settings).
//
// Every other case proceeds normally: a CONFIRMED login phone opens that account
// (Supabase's native phone OTP), and a number on no account at all creates one
// as before. The client is told only block-or-proceed; the three-way state
// (phone_login_state, service-role-only) never reaches it, so this is not a
// browser-reachable "does this number have an account?" oracle.

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        const e164 = ukMobileToE164(String(body?.phone || ''));
        // Not a readable UK mobile — let the normal flow show its own message.
        if (!e164) return NextResponse.json({ ok: true, blocked: false });

        const admin = adminClient();
        const { data, error } = await admin.rpc('phone_login_state', { p_phone: e164 });
        if (error) {
            // Fail OPEN: a lookup blip must never lock someone out of signing in.
            // The worst case is the pre-existing behaviour (a possible stray
            // account), which the rest of this change stops recurring.
            logError('phone-login-check', error);
            return NextResponse.json({ ok: true, blocked: false });
        }

        const decision = phoneLoginDecision(data as string);
        return NextResponse.json({ ok: true, ...decision });
    } catch (err: any) {
        logError('phone-login-check', err);
        return NextResponse.json({ ok: true, blocked: false });
    }
}
