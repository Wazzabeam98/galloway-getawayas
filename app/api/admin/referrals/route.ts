import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Owner-only: mark a referral reward paid, once it has been sent by bank
// transfer. The gate is here, on the server, every time — the screen hiding
// itself is presentation. Mirrors /api/admin/commission.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(): verify the token with the auth server
        // rather than trust a cookie the caller could write.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const admin = adminClient();
        const { data: profile } = await admin
            .from('profiles')
            .select('is_admin')
            .eq('id', user.id)
            .maybeSingle();
        if (!profile || !profile.is_admin) {
            return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });
        }

        const body = await request.json();
        const referralId: string = body && body.referralId;
        if (!referralId) {
            return NextResponse.json({ ok: false, error: 'Missing referral' }, { status: 400 });
        }

        // Only a reward that is actually due can be marked paid — the condition
        // on status means a double-click or a stale page can't flip anything
        // else, and a reward that isn't due yet can't be paid out early.
        const paidAt = new Date().toISOString();
        const { data, error } = await admin
            .from('referrals')
            .update({ status: 'reward_paid', reward_paid_at: paidAt, updated_at: paidAt })
            .eq('id', referralId)
            .eq('status', 'first_stay_done')
            .select('id, status, reward_paid_at')
            .maybeSingle();

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }
        if (!data) {
            return NextResponse.json(
                { ok: false, error: 'That reward is not currently due to be paid.' },
                { status: 409 }
            );
        }

        return NextResponse.json({ ok: true, status: data.status, rewardPaidAt: data.reward_paid_at });
    } catch (err: any) {
        console.error('[admin/referrals]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not save' },
            { status: 500 }
        );
    }
}
