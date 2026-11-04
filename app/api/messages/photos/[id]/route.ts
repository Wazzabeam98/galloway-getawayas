import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { mayViewThreadPhotos, threadOfAttachment } from '@/lib/messagePhotoAccess';
import { PHOTO_BUCKET, SIGNED_URL_SECONDS } from '@/lib/messagePhotos';

export const dynamic = 'force-dynamic';

// A photo sent in any conversation — a booking, an experience order or a trade
// enquiry. It lives in a private bucket; this route hands back a short-lived
// signed URL — the same way the resolution centre's attachments are opened —
// and only to the people in the conversation the photo belongs to, or an admin
// (lib/messagePhotoAccess). Anyone else gets the same 404 as a photo that does
// not exist, so changing the id in the URL learns nothing.
//   ?size=thumb  the small copy the thread shows (falls back to the full one)
export async function GET(request: Request, { params }: { params: { id: string } }) {
    const notFound = () => NextResponse.json({ ok: false, error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

        if (!/^[0-9a-f-]{36}$/i.test(params.id)) return notFound();

        const admin = adminClient();
        const { data: att } = await admin
            .from('message_attachments')
            .select('id, path, thumb_path, booking_id, order_id, enquiry_id')
            .eq('id', params.id)
            .maybeSingle();
        if (!att) return notFound();

        const thread = threadOfAttachment(att);
        if (!thread) return notFound();
        if (!(await mayViewThreadPhotos(admin, user.id, thread.kind, thread.id))) return notFound();

        const wantThumb = new URL(request.url).searchParams.get('size') === 'thumb';
        const key = (wantThumb && att.thumb_path) || att.path;
        const { data: signed, error } = await admin.storage.from(PHOTO_BUCKET).createSignedUrl(key, SIGNED_URL_SECONDS);
        if (error || !signed) return NextResponse.json({ ok: false, error: 'Could not open that photo' }, { status: 500 });

        // The redirect itself is never cached: the link inside it dies in a
        // minute, and a cached redirect would outlive it.
        const res = NextResponse.redirect(signed.signedUrl, 302);
        res.headers.set('Cache-Control', 'private, no-store');
        res.headers.set('Referrer-Policy', 'no-referrer');
        return res;
    } catch {
        return NextResponse.json({ ok: false, error: 'Could not open that photo' }, { status: 500 });
    }
}
