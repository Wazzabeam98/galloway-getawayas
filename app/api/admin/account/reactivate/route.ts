import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// Bringing a deactivated account back is NOT self-serve — a suspended login
// cannot sign in to undo its own suspension, which is the point. The person
// asks us, and one of us runs this. is_admin is checked on the server (a client
// claim means nothing), then the service-role RPC lifts the suspension,
// un-hides the profile and republishes exactly the listings/experiences we hid.
//
// A trade's Stripe subscription is NOT restarted here (a cancelled subscription
// can't be revived) — the trade re-subscribes through the normal billing flow.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const admin = adminClient();
        const { data: me } = await admin
            .from('profiles')
            .select('is_admin')
            .eq('id', user.id)
            .maybeSingle();
        if (!me || me.is_admin !== true) {
            return NextResponse.json({ ok: false, error: 'Not allowed' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const target: string = body && body.userId;
        if (!target) {
            return NextResponse.json({ ok: false, error: 'Missing userId' }, { status: 400 });
        }

        const { error } = await admin.rpc('reactivate_account', { target });
        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('[admin/account/reactivate] failed', err, { path: 'api/admin/account/reactivate' });
        return NextResponse.json({ ok: false, error: 'Could not reactivate the account.' }, { status: 500 });
    }
}
