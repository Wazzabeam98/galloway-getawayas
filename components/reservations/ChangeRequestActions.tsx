'use client';

import { useState } from 'react';

// The guest's answer to a proposed change: accept (which moves any money and
// rewrites the stay) or decline. Accept with a price increase returns a Stripe
// URL to send them to; otherwise the page reloads onto the updated state.
export default function ChangeRequestActions({ changeId, delta }: { changeId: string; delta: number }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const send = async (action: 'accept' | 'decline') => {
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/bookings/change/respond', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ changeId, action }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { setError(body?.error || 'Could not do that.'); setBusy(false); return; }
            if (body.url) { window.location.href = body.url; return; }
            window.location.reload();
        } catch {
            setError('Something went wrong. Try again.');
            setBusy(false);
        }
    };

    const acceptLabel = delta > 0
        ? 'Accept and pay £' + delta.toFixed(2)
        : delta < 0
            ? 'Accept and get £' + Math.abs(delta).toFixed(2) + ' back'
            : 'Accept the change';

    return (
        <div className="mt-5 space-y-2">
            {error && <p className="text-[13px] text-rose-600">{error}</p>}
            <button type="button" disabled={busy} onClick={() => send('accept')} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                {acceptLabel}
            </button>
            <button type="button" disabled={busy} onClick={() => { if (confirm('Decline this change? Your booking stays exactly as it is.')) send('decline'); }} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50">
                Decline
            </button>
        </div>
    );
}
