'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Send, Loader2, Info } from 'lucide-react';

// The message thread on a job. A written record of what was agreed, and a way
// to talk without swapping numbers. Reachable from an accepted (or cancelled)
// job on either side; the RLS on messages means only the two of them see it.
type Msg = { id: string; sender_id: string; body: string; created_at: string; read_at: string | null };
type Data = {
    ok: boolean;
    viewerId: string;
    other: { id: string; name: string };
    context: {
        reference: string; status: string; trade: string; summary: string;
        askedFor: string | null; cottage: string | null;
        cancelled: { by: string | null; reason: string | null } | null;
    };
    messages: Msg[];
    error?: string;
};

function timeLabel(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

export default function EnquiryThread({ enquiryId, backHref }: { enquiryId: string; backHref: string }) {
    const [data, setData] = useState<Data | null>(null);
    const [error, setError] = useState('');
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const endRef = useRef<HTMLDivElement | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/messages/enquiry/' + enquiryId, { cache: 'no-store' });
            const d = await res.json();
            if (!res.ok || !d.ok) { setError(d.error || 'Could not open this thread.'); return; }
            setData(d);
        } catch { setError('Could not open this thread.'); }
    }, [enquiryId]);

    useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
    useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [data?.messages.length]);

    async function send() {
        const body = text.trim();
        if (!body || sending) return;
        setSending(true); setError('');
        // optimistic
        setText('');
        try {
            const res = await fetch('/api/messages/enquiry/' + enquiryId, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
            });
            const d = await res.json();
            if (!res.ok || !d.ok) { setError(d.error || 'Could not send.'); setText(body); setSending(false); return; }
            await load();
        } catch { setError('Could not send.'); setText(body); }
        setSending(false);
    }

    if (error && !data) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-16 text-center">
                <p className="text-slate-600">{error}</p>
                <Link href={backHref} className="inline-block mt-4 text-emerald-700 font-semibold underline">Go back</Link>
            </div>
        );
    }
    if (!data) {
        return <div className="max-w-2xl mx-auto px-4 py-16 text-slate-500">Loading…</div>;
    }

    const c = data.context;

    return (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 flex flex-col min-h-[70vh]">
            <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
                <ArrowLeft className="w-4 h-4" /> Back
            </Link>

            {/* Who, and which job */}
            <div className="mt-3 pb-4 border-b border-slate-200">
                <h1 className="text-xl font-extrabold tracking-tight text-slate-900">{data.other.name}</h1>
                <p className="text-sm text-slate-500 mt-0.5">{c.trade} · {c.reference}</p>
                <p className="text-sm text-slate-600 mt-2 italic">{c.summary}</p>
                {c.askedFor && <p className="text-xs text-slate-500 mt-1">{c.askedFor}{c.cottage ? ' · ' + c.cottage : ''}</p>}
                {c.cancelled && (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1">
                        <Info className="w-3.5 h-3.5" /> This job was cancelled{c.cancelled.reason ? ' — ' + c.cancelled.reason : ''}
                    </p>
                )}
            </div>

            {/* Messages */}
            <div className="flex-1 py-4 space-y-3 overflow-y-auto">
                {data.messages.length === 0 && (
                    <p className="text-center text-sm text-slate-400 py-8">No messages yet. Say hello, agree the details, keep it here.</p>
                )}
                {data.messages.map((m) => {
                    const mine = m.sender_id === data.viewerId;
                    return (
                        <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${mine ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-900'}`}>
                                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                                <div className={`text-[10.5px] mt-1 ${mine ? 'text-emerald-100/80' : 'text-slate-400'}`}>{timeLabel(m.created_at)}</div>
                            </div>
                        </div>
                    );
                })}
                <div ref={endRef} />
            </div>

            {/* Send */}
            <div className="pt-3 border-t border-slate-200">
                {error && <div className="text-[12px] text-rose-700 mb-1.5">{error}</div>}
                <div className="flex items-end gap-2">
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                        placeholder={`Message ${data.other.name}…`}
                        rows={1}
                        className="flex-1 resize-none rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[44px] max-h-40"
                    />
                    <button onClick={send} disabled={sending || !text.trim()} className="flex-none inline-flex items-center gap-1.5 font-bold text-sm text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-xl px-4 py-2.5">
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                </div>
            </div>
        </div>
    );
}
