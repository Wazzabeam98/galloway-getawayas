import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { bookingPhotoRole } from '@/lib/messagePhotoAccess';
import { readPhotoForm, storePhotoMessage } from '@/lib/messagePhotoUpload';

export const dynamic = 'force-dynamic';

// Send a message with photos on a booking's thread. Multipart: `body` (optional
// words), `photos` (1–6 files) and `thumbs` (the browser's small copy of each,
// same order). Text-only booking messages still go straight from the browser
// under the row policy; a photo has to come through here, because the files
// land in a private bucket only the service role can write.
//
// The checks, the stripping and the storage are lib/messagePhotoUpload — the
// same code every kind of thread uses.
export async function POST(request: Request, { params }: { params: { bookingId: string } }) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const admin = adminClient();
        const access = await bookingPhotoRole(admin, user.id, params.bookingId, { allowAdmin: false });
        if (!access) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
        const { booking, role } = access;

        const read = await readPhotoForm(request);
        if (!read.ok) return NextResponse.json({ ok: false, error: read.error }, { status: read.status });

        // The guest writes to the host; anyone on the host's side writes to the
        // guest — the same recipient the browser's own insert uses.
        const recipientId = role === 'guest' ? booking.host_id : booking.guest_id;

        const message = await storePhotoMessage(admin, {
            kind: 'booking', threadId: booking.id, senderId: user.id, recipientId, upload: read.upload,
        });
        return NextResponse.json({ ok: true, message });
    } catch (err) {
        await logError('[messages/photos] send failed', err, { path: 'messages/threads/photos' });
        return NextResponse.json({ ok: false, error: 'Your photo couldn’t be sent. Try again.' }, { status: 500 });
    }
}
