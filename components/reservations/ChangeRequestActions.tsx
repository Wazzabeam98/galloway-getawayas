'use client';

import { useState } from 'react';

// The action buttons on a change-review page. One component, three shapes:
//   - answer (default): Accept/Approve + Decline (the counterparty deciding)
//   - payOnly: a single "Continue to payment" (guest paying after approval)
//   - withdrawOnly: a single "Withdraw request" (the proposer taking it back)
// Accept with a price increase returns a Stripe URL; everything else reloads.
export default function ChangeRequestActions({
    changeId, acceptLabel, declineLabel, payOnly, withdrawOnly,
}: {
    changeId: string;
    acceptLabel?: string;
    declineLabel?: string;
    payOnly?: boolean;
    withdrawOnly?: boolean;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const send = async (action: 'accept' | 'decline') => {
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/bookings/change/respond', {
                method: 'POST', headers: { 'content-type': 'application/json' },
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

    if (withdrawOnly) {
        return (
            <div className="mt-4 space-y-2">
                {error && <p className="text-[13px] text-rose-600">{error}</p>}
                <button type="button" disabled={busy} onClick={() => { if (confirm('Withdraw this change request?')) send('decline'); }} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50">
                    Withdraw request
                </button>
            </div>
        );
    }

    if (payOnly) {
        return (
            <div className="mt-5 space-y-3">
                {error && <p className="text-[13px] text-rose-600">{error}</p>}
                <button type="button" disabled={busy} onClick={() => send('accept')} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                    {acceptLabel || 'Continue to payment'}
                </button>
                <p className="text-[12px] text-slate-500">This takes you to the same secure Stripe page.</p>
            </div>
        );
    }

    return (
        <div className="mt-5 space-y-2">
            {error && <p className="text-[13px] text-rose-600">{error}</p>}
            <button type="button" disabled={busy} onClick={() => send('accept')} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                {acceptLabel || 'Accept'}
            </button>
            <button type="button" disabled={busy} onClick={() => { if (confirm('Decline this change? The booking stays exactly as it is.')) send('decline'); }} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50">
                {declineLabel || 'Decline'}
            </button>
        </div>
    );
}
