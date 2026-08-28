'use client';

import { useState } from 'react';

// Yes or no, and a line to go with it.
//
// A POST rather than a link, so that nothing answers on his behalf by merely
// fetching a URL — see the page this sits on for why that matters.
export default function EnquiryReply({ token }: { token: string }) {
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState('');
    const [error, setError] = useState('');

    const answer = async (reply: 'yes' | 'no') => {
        setBusy(true);
        setError('');

        const res = await fetch('/api/services/enquiries/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, reply, message }),
        });

        const json = await res.json();
        setBusy(false);

        if (!json.ok) {
            setError(json.error || 'Could not send that.');
            return;
        }

        setDone(reply);
    };

    if (done === 'yes') {
        return (
            <p className="mt-8 rounded-xl bg-emerald-50 text-emerald-900 p-4">
                Thanks — we have emailed you their name and number, and told them to expect you.
            </p>
        );
    }

    if (done === 'no') {
        return (
            <p className="mt-8 rounded-xl bg-slate-100 text-slate-700 p-4">
                Thanks for saying so. We have told them to try somebody else, which is far better than
                them waiting.
            </p>
        );
    }

    return (
        <div className="mt-8">
            <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                    Anything to say to them? (optional)
                </span>
                <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    placeholder="Can come Thursday morning if that suits."
                    className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                />
            </label>

            {error && <p className="text-sm text-red-700 mt-3">{error}</p>}

            <button
                onClick={() => answer('yes')}
                disabled={busy}
                className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-white font-semibold disabled:opacity-50"
            >
                Yes, I&rsquo;ll take a look
            </button>
            <button
                onClick={() => answer('no')}
                disabled={busy}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-700 font-semibold disabled:opacity-50"
            >
                No, not this one
            </button>
        </div>
    );
}
