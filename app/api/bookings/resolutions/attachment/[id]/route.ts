import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/adminAudit';

export const dynamic = 'force-dynamic';

const BUCKET = 'resolution-attachments';

// A private attachment on a money resolution (receipt or damage photo). It lives
// in a non-public bucket; this route hands back a short-lived signed URL, and
// only to the two parties or an admin. Nobody reads it by guessing a URL.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const admin = adminClient();
        const { data: att } = await admin
            .from('booking_resolution_attachments')
            .select('id, path, resolution_id')
            .eq('id', params.id)
            .maybeSingle();
        if (!att) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        const { data: res } = await admin
            .from('booking_resolutions')
            .select('host_id, guest_id')
            .eq('id', att.resolution_id)
            .maybeSingle();
        if (!res) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        const allowed = user.id === res.host_id || user.id === res.guest_id || await isAdmin(user.id);
        if (!allowed) return NextResponse.json({ ok: false, error: 'Not allowed' }, { status: 403 });

        const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrl(att.path, 60);
        if (error || !signed) return NextResponse.json({ ok: false, error: 'Could not open that file' }, { status: 500 });

        return NextResponse.redirect(signed.signedUrl);
    } catch {
        return NextResponse.json({ ok: false, error: 'Could not open that file' }, { status: 500 });
    }
}
