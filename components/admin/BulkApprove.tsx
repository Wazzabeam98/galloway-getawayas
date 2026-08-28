'use client';

import { useState } from 'react';

// Approving a queue in one press, for whichever queue asked.
//
// Both review screens need the same control and the same words, so it is one
// component pointed at a different route rather than two that will drift. The
// per-row buttons underneath stay exactly as they were: this sits above them
// and does the launch-morning case.
//
// APPROVALS ONLY, DELIBERATELY. A decline carries a reason written for one
// business or one property, and a sentence true of ten of them is too vague to
// act on. Both routes refuse a bulk decline; this does not offer one.

export default function BulkApprove({
    endpoint,
    ids,
    noun,
    nounPlural,
}: {
    /** The decide route for this queue. Both accept `ids`. */
    endpoint: string;
    /** Everything that is genuinely ready — a half-finished thing is not here. */
    ids: string[];
    noun: string;
    nounPlural: string;
}) {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');

    if (ids.length === 0) return null;

    async function approveAll() {
        setBusy(true);
        setMessage('');

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: 'approve', ids }),
            });
            const result = await res.json();

            if (!res.ok || result.ok === false) {
                setMessage(result.error || 'That did not work.');
                return;
            }

            // The summary is written server-side so both queues describe the
            // same outcome the same way — including the part people skip, which
            // is how many could not be emailed.
            setMessage(result.summary || 'Done.');
            if (result.decided > 0) setTimeout(() => window.location.reload(), 1400);
        } catch {
            setMessage('That did not work.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
                type="button"
                disabled={busy}
                onClick={approveAll}
                className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold disabled:opacity-40"
            >
                {busy
                    ? 'Working…'
                    : `Approve all ${ids.length} ${ids.length === 1 ? noun : nounPlural}`}
            </button>
            {message && <p className="text-sm font-medium text-slate-800">{message}</p>}
        </div>
    );
}
