import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// Approving / declining a hotel for the public site — the hotel twin of
// /api/admin/listings/decide, minimal for phase one. is_admin is checked on the
// server (getUser, not getSession). Approve -> published; decline -> back to
// draft with declined_at, which reopens it in the wizard. A status-guarded
// compare-and-set so two admins deciding at once don't both act.
export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

        const admin = adminClient();
        const { data: me } = await admin.from('profiles').select('is_admin').eq('id', auth.user.id).maybeSingle();
        if (!me || me.is_admin !== true) return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 });

        const body = await req.json();
        const id = String(body.id || '');
        const decision = String(body.decision || '');
        if (!id || (decision !== 'approve' && decision !== 'decline')) {
            return NextResponse.json({ ok: false, error: 'Nothing to decide.' }, { status: 400 });
        }

        const now = new Date().toISOString();
        const patch = decision === 'approve'
            ? { status: 'published' }
            : { status: 'draft', declined_at: now };

        const { data: written, error } = await admin
            .from('hotels')
            .update(patch)
            .eq('id', id)
            .eq('status', 'pending_review')
            .select('id');

        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        if (!written || written.length === 0) {
            return NextResponse.json({ ok: false, error: 'Not waiting for review — someone may have decided it already.' }, { status: 409 });
        }

        revalidatePath('/hotels/browse');
        revalidatePath(`/hotels/${id}`);
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('[admin/hotels/decide] ' + ((err && err.message) || 'failed'), err, { path: 'admin/hotels/decide' });
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
