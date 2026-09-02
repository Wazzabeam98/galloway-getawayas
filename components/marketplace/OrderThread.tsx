'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';

// The message thread on a guest experience order, sized to sit INSIDE a card —
// the guest's trip row and the provider's dashboard order. Same fetch / poll /
// send as EnquiryThread, but compact and headerless: the card it lives in
// already says which order this is. The RLS on messages means only the two
// parties to the order see it.
type Msg = { id: string; sender_id: string; body: string; created_at: string; read_at: string | null };
type Data = {
    ok: boolean;
    viewerId: string;
    other: { id: string; name: string };
    messages: Msg[];
    error?: string;
};

function timeLabel(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

export default function OrderThread({ orderId, onUnread }: { orderId: string; onUnread?: (n: number) => void }) {
    const [data, setData] = useState<Data | null>(null);
    const [error, setError] = useState('');
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
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
        if (!body || sending) return;
        setSending(true); setError('');
        setText('');
        try {
            const res = await fetch('/api/messages/order/' + orderId, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
            });
            const d = await res.json();
            if (!res.ok || !d.ok) { setError(d.error || 'Could not send.'); setText(body); setSending(false); return; }
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
                    return (
                        <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${mine ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-900'}`}>
                                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                                <div className={`mt-0.5 text-[10px] ${mine ? 'text-emerald-100/80' : 'text-slate-400'}`}>{timeLabel(m.created_at)}</div>
                            </div>
                        </div>
                    );
                })}
                <div ref={endRef} />
            </div>
            <div className="border-t border-slate-200 px-3 py-2">
                {error && <div className="mb-1.5 text-[12px] text-rose-700">{error}</div>}
                <div className="flex items-end gap-2">
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                        placeholder={`Message ${data.other.name}…`}
                        rows={1}
                        className="min-h-[40px] max-h-32 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                    />
                    <button onClick={send} disabled={sending || !text.trim()} className="inline-flex flex-none items-center rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                </div>
            </div>
        </div>
    );
}
