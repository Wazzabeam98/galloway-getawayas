'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { ukDateTime } from '@/lib/dayKey';
import { AttachPhotoButton, PendingPhotos, MessagePhotoGrid, type MessageAttachment } from '@/components/messages/MessagePhotos';
import type { PreparedPhoto } from '@/lib/preparePhoto';
import { messagePreview } from '@/lib/messagePhotos';

// The message thread on a guest experience order, sized to sit INSIDE a card —
// the guest's trip row and the provider's dashboard order. Same fetch / poll /
// send as EnquiryThread, but compact and headerless: the card it lives in
// already says which order this is. The RLS on messages means only the two
// parties to the order see it.
type Msg = { id: string; sender_id: string; body: string; created_at: string; read_at: string | null; photo_count?: number; attachments?: MessageAttachment[] };
type Data = {
    ok: boolean;
    viewerId: string;
    other: { id: string; name: string };
    photosVisible?: boolean;
    messages: Msg[];
    error?: string;
};

// DD/MM/YYYY, HH:MM in Europe/London — the shared formatter, so the thread, the
// inbox and EnquiryThread can never drift on how a timestamp reads.
const timeLabel = ukDateTime;

export default function OrderThread({ orderId, onUnread }: { orderId: string; onUnread?: (n: number) => void }) {
    const [data, setData] = useState<Data | null>(null);
    const [error, setError] = useState('');
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    // Photos for the next message — the same preparation and upload as the inbox.
    const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
    const endRef = useRef<HTMLDivElement | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/messages/order/' + orderId, { cache: 'no-store' });
            const d = await res.json();
            if (!res.ok || !d.ok) { setError(d.error || 'Could not open this thread.'); return; }
            setData(d);
            // The GET marks inbound read, so once open there is nothing unread.
            if (onUnread) onUnread(0);
        } catch { setError('Could not open this thread.'); }
    }, [orderId, onUnread]);

    useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
    useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [data?.messages.length]);

    async function send() {
        const body = text.trim();
        if ((!body && photos.length === 0) || sending) return;
        setSending(true); setError('');
        setText('');
        const sentPhotos = photos;
        try {
            let res: Response;
            if (sentPhotos.length > 0) {
                const form = new FormData();
                form.append('body', body);
                sentPhotos.forEach((p) => {
                    form.append('photos', p.full, 'photo.jpg');
                    form.append('thumbs', p.thumb, 'thumb.jpg');
                    form.append('widths', String(p.width));
                    form.append('heights', String(p.height));
                });
                res = await fetch('/api/messages/order/' + orderId, { method: 'POST', body: form });
            } else {
                res = await fetch('/api/messages/order/' + orderId, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
                });
            }
            const d = await res.json().catch(() => null);
            if (!res.ok || !d || !d.ok) { setError((d && d.error) || 'Could not send.'); setText(body); setSending(false); return; }
            sentPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
            setPhotos([]);
            await load();
        } catch { setError('Could not send.'); setText(body); }
        setSending(false);
    }

    if (error && !data) {
        return <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">{error}</div>;
    }
    if (!data) {
        return <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-400">Loading…</div>;
    }

    return (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white">
            <div className="max-h-64 space-y-2 overflow-y-auto px-3 py-3">
                {data.messages.length === 0 && (
                    <p className="py-4 text-center text-xs text-slate-400">No messages yet. Agree the details here — allergies, timing, access.</p>
                )}
                {data.messages.map((m) => {
                    const mine = m.sender_id === data.viewerId;
                    const atts = m.attachments || [];
                    const words = String(m.body || '').trim() || (atts.length === 0 ? messagePreview('', m.photo_count) : '');
                    return (
                        <div key={m.id} className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
                            {atts.length > 0 && (
                                <div className="max-w-[80%]"><MessagePhotoGrid attachments={atts} mine={mine} /></div>
                            )}
                            {words ? (
                                <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${mine ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-900'}`}>
                                    <div className="whitespace-pre-wrap break-words">{words}</div>
                                    <div className={`mt-0.5 text-[10px] ${mine ? 'text-emerald-100/80' : 'text-slate-400'}`}>{timeLabel(m.created_at)}</div>
                                </div>
                            ) : (
                                <div className="text-[10px] text-slate-400 px-1">{timeLabel(m.created_at)}</div>
                            )}
                        </div>
                    );
                })}
                <div ref={endRef} />
            </div>
            <div className="border-t border-slate-200 px-3 py-2">
                {error && <div className="mb-1.5 text-[12px] text-rose-700">{error}</div>}
                <PendingPhotos
                    photos={photos}
                    onRemove={(i) => setPhotos((prev) => { const gone = prev[i]; if (gone) URL.revokeObjectURL(gone.previewUrl); return prev.filter((_, j) => j !== i); })}
                />
                <div className="flex items-end gap-2">
                    {data.photosVisible && (
                        <AttachPhotoButton
                            count={photos.length}
                            onAdd={(more) => setPhotos((prev) => prev.concat(more))}
                            disabled={sending}
                            className="inline-flex flex-none items-center rounded-lg border border-slate-300 px-3 py-2 text-slate-500 hover:text-slate-800 disabled:opacity-40"
                        />
                    )}
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                        placeholder={`Message ${data.other.name}…`}
                        rows={1}
                        className="min-h-[40px] max-h-32 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                    />
                    <button onClick={send} disabled={sending || (!text.trim() && photos.length === 0)} className="inline-flex flex-none items-center rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                </div>
            </div>
        </div>
    );
}
