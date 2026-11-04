import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { bookingPhotoRole } from '@/lib/messagePhotoAccess';
import {
    PHOTO_BUCKET, MAX_PHOTOS_PER_MESSAGE, PHOTO_ERRORS,
    checkStoredPhoto, stripImageMetadata, type StoredType,
} from '@/lib/messagePhotos';

export const dynamic = 'force-dynamic';

const BODY_MAX = 5000;
const EXT: Record<StoredType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Send a message with photos on a booking's thread. Multipart: `body` (optional
// words), `photos` (1–6 files) and `thumbs` (the browser's small copy of each,
// same order). Text-only messages still go straight from the browser under the
// row policy; a photo has to come through here, because the files land in a
// private bucket only the service role can write.
//
// Every check the browser made is made again: each file must really be an image
// by its bytes (not by what it says it is), under 10MB, no more than six, and
// any EXIF/GPS still in it is stripped before it is stored.
export async function POST(request: Request, { params }: { params: { bookingId: string } }) {
    const uploaded: string[] = [];
    const admin = adminClient();
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const access = await bookingPhotoRole(admin, user.id, params.bookingId, { allowAdmin: false });
        if (!access) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
        const { booking, role } = access;

        let form: FormData;
        try {
            form = await request.formData();
        } catch {
            return NextResponse.json({ ok: false, error: PHOTO_ERRORS.tooLarge }, { status: 413 });
        }
        const body = String(form.get('body') || '').trim();
        if (body.length > BODY_MAX) return NextResponse.json({ ok: false, error: 'That message is too long.' }, { status: 400 });

        const photos = form.getAll('photos').filter((f): f is File => f instanceof File);
        const thumbs = form.getAll('thumbs').filter((f): f is File => f instanceof File);
        if (photos.length === 0) return NextResponse.json({ ok: false, error: 'Choose a photo to send.' }, { status: 400 });
        if (photos.length > MAX_PHOTOS_PER_MESSAGE) return NextResponse.json({ ok: false, error: PHOTO_ERRORS.tooMany }, { status: 400 });
        if (thumbs.length !== 0 && thumbs.length !== photos.length) return NextResponse.json({ ok: false, error: PHOTO_ERRORS.unreadable }, { status: 400 });

        const widths = form.getAll('widths').map((v) => Math.round(Number(v)) || null);
        const heights = form.getAll('heights').map((v) => Math.round(Number(v)) || null);

        // Check every file before storing any, so a bad fourth photo never
        // leaves three orphans behind.
        const prepared: { full: Uint8Array; fullType: StoredType; thumb: Uint8Array | null; thumbType: StoredType | null }[] = [];
        for (let i = 0; i < photos.length; i++) {
            const raw = new Uint8Array(await photos[i].arrayBuffer());
            const ok = checkStoredPhoto(raw);
            if ('error' in ok) return NextResponse.json({ ok: false, error: ok.error }, { status: 400 });
            let full: Uint8Array;
            try { full = stripImageMetadata(raw, ok.type); } catch { return NextResponse.json({ ok: false, error: PHOTO_ERRORS.unreadable }, { status: 400 }); }

            let thumb: Uint8Array | null = null;
            let thumbType: StoredType | null = null;
            if (thumbs[i]) {
                const rawThumb = new Uint8Array(await thumbs[i].arrayBuffer());
                const tk = checkStoredPhoto(rawThumb);
                if ('error' in tk) return NextResponse.json({ ok: false, error: tk.error }, { status: 400 });
                try { thumb = stripImageMetadata(rawThumb, tk.type); thumbType = tk.type; } catch { return NextResponse.json({ ok: false, error: PHOTO_ERRORS.unreadable }, { status: 400 }); }
            }
            prepared.push({ full, fullType: ok.type, thumb, thumbType });
        }

        // Stored under the booking, with a random name: nothing about the
        // person, the place or the original file is in the key.
        const rows: any[] = [];
        for (let i = 0; i < prepared.length; i++) {
            const p = prepared[i];
            const key = crypto.randomUUID();
            const path = booking.id + '/' + key + '.' + EXT[p.fullType];
            const { error: upErr } = await admin.storage.from(PHOTO_BUCKET)
                .upload(path, Buffer.from(p.full), { contentType: p.fullType, upsert: false });
            if (upErr) throw upErr;
            uploaded.push(path);

            let thumbPath: string | null = null;
            if (p.thumb && p.thumbType) {
                thumbPath = booking.id + '/' + key + '-thumb.' + EXT[p.thumbType];
                const { error: tErr } = await admin.storage.from(PHOTO_BUCKET)
                    .upload(thumbPath, Buffer.from(p.thumb), { contentType: p.thumbType, upsert: false });
                if (tErr) throw tErr;
                uploaded.push(thumbPath);
            }
            rows.push({
                path, thumb_path: thumbPath, content_type: p.fullType,
                width: widths[i] || '', height: heights[i] || '', size_bytes: p.full.length,
            });
        }

        // The guest writes to the host; anyone on the host's side writes to the
        // guest — the same recipient the browser's own insert uses.
        const recipientId = role === 'guest' ? booking.host_id : booking.guest_id;

        const { data: messageId, error: rpcErr } = await admin.rpc('send_booking_message_with_photos', {
            p_booking: booking.id,
            p_sender: user.id,
            p_recipient: recipientId,
            p_body: body,
            p_photos: rows,
        });
        if (rpcErr || !messageId) throw rpcErr || new Error('no message id');

        const [{ data: message }, { data: atts }] = await Promise.all([
            admin.from('messages').select('id, sender_id, body, created_at, read_at, photo_count').eq('id', messageId).maybeSingle(),
            admin.from('message_attachments').select('id, width, height, position').eq('message_id', messageId).order('position'),
        ]);

        return NextResponse.json({
            ok: true,
            message: message ? { ...message, attachments: (atts || []).map(({ position, ...a }: any) => a) } : null,
        });
    } catch (err) {
        if (uploaded.length) {
            await admin.storage.from(PHOTO_BUCKET).remove(uploaded).catch(() => {});
        }
        await logError('[messages/photos] send failed', err, { path: 'messages/threads/photos' });
        return NextResponse.json({ ok: false, error: 'Your photo couldn’t be sent. Try again.' }, { status: 500 });
    }
}
