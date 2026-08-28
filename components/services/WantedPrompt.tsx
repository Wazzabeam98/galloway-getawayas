'use client';

import { useState } from 'react';
import { tradeLabel } from '@/lib/serviceProviders';

// What a host sees when nobody covers them.
//
// This is not an error state, it is the ordinary one for a while: the
// directory opens empty and tradesmen are signed up by hand. So it says what
// is actually happening — we are signing local businesses up now — rather than
// reporting an absence and stopping.
//
// The button is the point. It turns the commonest dead end into the single
// most useful signal the shop produces: which trade, in which town, that
// nobody could be found for. Three of those in Wigtown is a recruiting list.
//
// ONE PRESS, NOTHING REQUIRED. The note is optional and there is no sign-in
// gate — somebody looking round before they have an account is exactly whose
// interest is worth knowing, and asking them to register first trades the
// signal for an identity.
//
// It promises nothing. "We will let you know when somebody covers you" is
// true and is all it says; nobody is dispatched and no tradesman ever sees it.
export default function WantedPrompt({
    trade,
    area,
    listingId,
}: {
    trade: string;
    area: string;
    listingId?: string;
}) {
    const [open, setOpen] = useState(false);
    const [note, setNote] = useState('');
    const [contact, setContact] = useState('');
    const [sending, setSending] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState('');

    const where = area || 'your area';

    const send = async () => {
        setSending(true);
        setError('');

        try {
            const res = await fetch('/api/services/wanted', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trade,
                    area_key: area,
                    listing_id: listingId || null,
                    note,
                    contact,
                }),
            });
            const json = await res.json();
            setSending(false);

            if (!json.ok) { setError(json.error || 'Could not send that.'); return; }
            setDone(true);
        } catch {
            setSending(false);
            setError('Could not send that.');
        }
    };

    if (done) {
        return (
            <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                <p className="font-semibold text-emerald-900">Thank you — that is noted.</p>
                <p className="text-sm text-emerald-900/80 mt-2">
                    It goes on the list of what to find next, and we will let you know when somebody
                    covering {where} signs up.
                </p>
            </div>
        );
    }

    return (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <p className="font-semibold text-slate-900">
                We are signing local businesses up now.
            </p>
            <p className="text-sm text-slate-600 mt-2">
                No {tradeLabel(trade).toLowerCase()} covering {where} has joined yet. Plenty cover more
                ground than their town suggests, so a nearby town is worth a look — and telling us what
                you need is what decides who we approach next.
            </p>

            {!open && (
                <button
                    onClick={() => setOpen(true)}
                    className="mt-4 rounded-xl bg-emerald-700 px-4 py-2.5 text-white text-sm font-semibold hover:bg-emerald-800"
                >
                    Tell us you need a {tradeLabel(trade).toLowerCase()}
                </button>
            )}

            {open && (
                <div className="mt-4 space-y-3">
                    <label className="block">
                        <span className="text-sm font-semibold text-slate-700">
                            Anything else? (optional)
                        </span>
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={3}
                            placeholder="Mostly changeover-day jobs, and someone who can do gas."
                            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                        />
                    </label>

                    <label className="block">
                        <span className="text-sm font-semibold text-slate-700">
                            Email to let you know (optional)
                        </span>
                        <input
                            value={contact}
                            onChange={(e) => setContact(e.target.value)}
                            placeholder="you@example.com"
                            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                        />
                        <span className="block text-xs text-slate-500 mt-1">
                            If you are signed in we already have it.
                        </span>
                    </label>

                    {error && <p className="text-sm text-red-700">{error}</p>}

                    <button
                        onClick={send}
                        disabled={sending}
                        className="rounded-xl bg-emerald-700 px-4 py-2.5 text-white text-sm font-semibold disabled:opacity-50"
                    >
                        {sending ? 'Sending…' : 'Send'}
                    </button>
                </div>
            )}
        </div>
    );
}
