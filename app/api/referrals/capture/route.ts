import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { signedInCaller } from '@/lib/signedInCaller';
import {
    attachReferral,
    referrerForCode,
    REFERRAL_COOKIE,
    REFERRAL_COOKIE_MAX_AGE,
} from '@/lib/referrals';

export const dynamic = 'force-dynamic';

// Remember who referred this visitor. Called from the /refer/<code> landing the
// moment someone opens a referral link: it drops an httpOnly cookie carrying the
// code, which survives sign-up so the referral can be attached when they go on
// to list. Only a code that resolves to a real referrer is stored, so a
// mistyped or stale link leaves nothing behind.
//
// If the visitor is already signed in (an existing guest opening a friend's
// link), the referral is attached as 'invited' right now too — the auth
// callback only fires on a fresh sign-in, so this covers the already-signed-in
// case.
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const code = String((body && body.code) || '').trim().toUpperCase();
        if (!code) {
            return NextResponse.json({ ok: false, error: 'No code' }, { status: 400 });
        }

        const admin = adminClient();
        const referrerId = await referrerForCode(admin, code);
        if (!referrerId) {
            // Not a real referral link — store nothing.
            return NextResponse.json({ ok: true, stored: false });
        }

        cookies().set(REFERRAL_COOKIE, code, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            maxAge: REFERRAL_COOKIE_MAX_AGE,
        });

        // Already signed in? Record the invite now; attachReferral guards
        // self-referral, first-wins and genuinely-new itself.
        const caller = await signedInCaller();
        if (caller && caller.id !== referrerId) {
            await attachReferral(admin, { code, referredUserId: caller.id, stage: 'invited' });
        }

        return NextResponse.json({ ok: true, stored: true });
    } catch (err: any) {
        // A referral is a nicety; never surface an error to the visitor.
        return NextResponse.json({ ok: true, stored: false });
    }
}
