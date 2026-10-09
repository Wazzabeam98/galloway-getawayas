'use client';

import { useState } from 'react';
import { MessageSquare, X } from 'lucide-react';

// "Message the provider" — a general contact route on the experience listing
// (kept when ranges and price on enquiry were dropped, 9 Oct 2026). A button that
// opens a small compose dialog; sending POSTs to /api/experiences/enquiry, which
// writes the enquiry and emails the provider. An item is optional — the listing's
// button sends none.
export default function EnquireButton({
    providerId,
    providerName,
    itemId = null,
    itemName = null,
    compact = false,
}: {
    providerId: string;
    providerName: string;
    itemId?: string | null;
    itemName?: string | null;
    // compact: a slimmer button for a tight menu row.
    compact?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState('');

    const send = async () => {
        if (!message.trim() || sending) return;
        setSending(true);
        setError('');
        try {
            const res = await fetch('/api/experiences/enquiry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId, itemId, message: message.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.ok) {
                setDone(true);
            } else {
                setError(data.error || 'That couldn’t be sent — try again.');
            }
        } catch {
            setError('That couldn’t be sent — try again.');
        }
        setSending(false);
    };

    return (
        <>
            <button
                type="button"
                onClick={() => { setOpen(true); setDone(false); setError(''); }}
                className={'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-900 bg-white font-semibold text-slate-900 transition hover:bg-slate-50 '
                    + (compact ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm')}
            >
                <MessageSquare className="h-4 w-4" aria-hidden />
                Message the provider
            </button>

            {open && (
                <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6"
                    role="dialog" aria-modal="true" aria-label={'Message ' + providerName}>
                    <div className="flex w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
                        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                            <h2 className="text-base font-bold text-slate-900">Message {providerName}</h2>
                            <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {done ? (
                            <div className="px-5 py-6">
                                <p className="text-sm text-slate-700">
                                    Sent — {providerName} will reply by email.
                                </p>
                                <div className="mt-5 flex justify-end">
                                    <button type="button" onClick={() => setOpen(false)}
                                        className="rounded-full bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
                                        Done
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="px-5 py-4">
                                {itemName && (
                                    <p className="mb-2 text-sm text-slate-500">About <span className="font-medium text-slate-700">{itemName}</span></p>
                                )}
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                                    rows={4}
                                    autoFocus
                                    placeholder="Ask about dates, your group, or anything else you’d like to know."
                                    className="w-full rounded-2xl border-2 border-slate-200 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                                />
                                {error && <p className="mt-2 text-sm font-medium text-amber-700">{error}</p>}
                                <div className="mt-4 flex items-center justify-end gap-4">
                                    <button type="button" onClick={() => setOpen(false)}
                                        className="text-sm font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-900">
                                        Cancel
                                    </button>
                                    <button type="button" onClick={send} disabled={sending || !message.trim()}
                                        className={'rounded-full px-5 py-2 text-sm font-semibold transition '
                                            + (sending || !message.trim() ? 'cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-emerald-700 text-white hover:bg-emerald-800')}>
                                        {sending ? 'Sending…' : 'Send'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
