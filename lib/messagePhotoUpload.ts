import type { SupabaseClient } from '@supabase/supabase-js';
import {
    PHOTO_BUCKET, MAX_PHOTOS_PER_MESSAGE, PHOTO_ERRORS,
    checkStoredPhoto, stripImageMetadata, type StoredType,
} from '@/lib/messagePhotos';
import type { ThreadKind } from '@/lib/messagePhotoAccess';

// The one upload path for a photo message, whatever the thread — a booking, an
// experience order or a trade enquiry (first built for bookings in #524). The
// route decides who may send and to whom; this does the rest, identically for
// all three:
//   - every file must really be an image by its bytes, under 10MB, at most six
//   - any EXIF/GPS still in it is stripped before it is stored
//   - stored in the private bucket under a random name
//   - the message and its photos written in one transaction
// Every file is checked before any is stored, and anything stored is removed
// again if the message cannot be written.

const BODY_MAX = 4000;
const EXT: Record<StoredType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export type PreparedUpload = {
    body: string;
    files: { full: Uint8Array; fullType: StoredType; thumb: Uint8Array | null; thumbType: StoredType | null; width: number | null; height: number | null }[];
};

/** Read and check a multipart photo message. */
export async function readPhotoForm(request: Request): Promise<{ ok: true; upload: PreparedUpload } | { ok: false; status: number; error: string }> {
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return { ok: false, status: 413, error: PHOTO_ERRORS.tooLarge };
    }
    const body = String(form.get('body') || '').trim();
    if (body.length > BODY_MAX) return { ok: false, status: 400, error: 'That message is too long.' };

    const photos = form.getAll('photos').filter((f): f is File => f instanceof File);
    const thumbs = form.getAll('thumbs').filter((f): f is File => f instanceof File);
    if (photos.length === 0) return { ok: false, status: 400, error: 'Choose a photo to send.' };
    if (photos.length > MAX_PHOTOS_PER_MESSAGE) return { ok: false, status: 400, error: PHOTO_ERRORS.tooMany };
    if (thumbs.length !== 0 && thumbs.length !== photos.length) return { ok: false, status: 400, error: PHOTO_ERRORS.unreadable };

    const widths = form.getAll('widths').map((v) => Math.round(Number(v)) || null);
    const heights = form.getAll('heights').map((v) => Math.round(Number(v)) || null);

    const files: PreparedUpload['files'] = [];
    for (let i = 0; i < photos.length; i++) {
        const raw = new Uint8Array(await photos[i].arrayBuffer());
        const ok = checkStoredPhoto(raw);
        if ('error' in ok) return { ok: false, status: 400, error: ok.error };
        let full: Uint8Array;
        try { full = stripImageMetadata(raw, ok.type); } catch { return { ok: false, status: 400, error: PHOTO_ERRORS.unreadable }; }

        let thumb: Uint8Array | null = null;
        let thumbType: StoredType | null = null;
        if (thumbs[i]) {
            const rawThumb = new Uint8Array(await thumbs[i].arrayBuffer());
            const tk = checkStoredPhoto(rawThumb);
            if ('error' in tk) return { ok: false, status: 400, error: tk.error };
            try { thumb = stripImageMetadata(rawThumb, tk.type); thumbType = tk.type; } catch { return { ok: false, status: 400, error: PHOTO_ERRORS.unreadable }; }
        }
        files.push({ full, fullType: ok.type, thumb, thumbType, width: widths[i] || null, height: heights[i] || null });
    }
    return { ok: true, upload: { body, files } };
}

/** Where a thread's photos live in the bucket. Booking photos keep #524's place. */
function folderFor(kind: ThreadKind, threadId: string): string {
    return kind === 'booking' ? threadId : kind + '/' + threadId;
}

/**
 * Store the photos and write the message. Returns the saved message with its
 * attachments (ids only — they are opened through the gated route).
 */
export async function storePhotoMessage(admin: SupabaseClient, input: {
    kind: ThreadKind;
    threadId: string;
    senderId: string;
    recipientId: string;
    upload: PreparedUpload;
}): Promise<any> {
    const uploaded: string[] = [];
    try {
        const folder = folderFor(input.kind, input.threadId);
        const rows: any[] = [];
        for (const f of input.upload.files) {
            const key = crypto.randomUUID();
            const path = folder + '/' + key + '.' + EXT[f.fullType];
            const { error: upErr } = await admin.storage.from(PHOTO_BUCKET)
                .upload(path, Buffer.from(f.full), { contentType: f.fullType, upsert: false });
            if (upErr) throw upErr;
            uploaded.push(path);

            let thumbPath: string | null = null;
            if (f.thumb && f.thumbType) {
                thumbPath = folder + '/' + key + '-thumb.' + EXT[f.thumbType];
                const { error: tErr } = await admin.storage.from(PHOTO_BUCKET)
                    .upload(thumbPath, Buffer.from(f.thumb), { contentType: f.thumbType, upsert: false });
                if (tErr) throw tErr;
                uploaded.push(thumbPath);
            }
            rows.push({
                path, thumb_path: thumbPath, content_type: f.fullType,
                width: f.width || '', height: f.height || '', size_bytes: f.full.length,
            });
        }

        const { data: messageId, error: rpcErr } = await admin.rpc('send_thread_message_with_photos', {
            p_kind: input.kind,
            p_thread: input.threadId,
            p_sender: input.senderId,
            p_recipient: input.recipientId,
            p_body: input.upload.body,
            p_photos: rows,
        });
        if (rpcErr || !messageId) throw rpcErr || new Error('no message id');

        const [{ data: message }, { data: atts }] = await Promise.all([
            admin.from('messages').select('id, sender_id, body, created_at, read_at, photo_count').eq('id', messageId).maybeSingle(),
            admin.from('message_attachments').select('id, width, height, position').eq('message_id', messageId).order('position'),
        ]);
        return message ? { ...message, attachments: (atts || []).map(({ position, ...a }: any) => a) } : null;
    } catch (err) {
        if (uploaded.length) await admin.storage.from(PHOTO_BUCKET).remove(uploaded).catch(() => {});
        throw err;
    }
}

/** The photos on a thread's messages, by message id, for the thread GET routes. */
export async function attachmentsFor(admin: SupabaseClient, kind: ThreadKind, threadId: string, messages: any[]): Promise<Record<string, { id: string; width: number | null; height: number | null }[]>> {
    const ids = (messages || []).filter((m: any) => Number(m.photo_count) > 0).map((m: any) => m.id);
    const out: Record<string, any[]> = {};
    if (!ids.length) return out;
    const column = kind === 'booking' ? 'booking_id' : kind === 'order' ? 'order_id' : 'enquiry_id';
    const { data: atts } = await admin
        .from('message_attachments')
        .select('id, message_id, width, height, position')
        .eq(column, threadId)
        .in('message_id', ids)
        .order('position', { ascending: true });
    (atts || []).forEach((a: any) => {
        (out[a.message_id] = out[a.message_id] || []).push({ id: a.id, width: a.width, height: a.height });
    });
    return out;
}
