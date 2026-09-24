'use client';

import { useState } from 'react';

// The guest's three answers to a money request: accept and pay, decline, or
// suggest a different amount. Accept returns a Stripe URL to send them to.
export default function GuestResolutionActions({ resolutionId, amount, guestFirst, resumeOnly }: {
    resolutionId: string; amount: number; guestFirst: string; resumeOnly?: boolean;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [countering, setCountering] = useState(false);
    const [counter, setCounter] = useState('');

    const send = async (action: string, counterAmount?: number) => {
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/bookings/resolutions/respond', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ resolutionId, action, counterAmount }),
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

    // Resuming an accepted-but-unpaid request: the only action is to go back to
    // the one Checkout session that is already open (the route reuses it), so no
    // decline/counter here — those were answered when they accepted.
    if (resumeOnly) {
        return (
            <div className="mt-5 space-y-3">
                {error && <p className="text-[13px] text-rose-600">{error}</p>}
                <button type="button" disabled={busy} onClick={() => send('accept')} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                    Continue to payment · £{amount.toFixed(2)}
                </button>
                <p className="text-[12px] text-slate-500">You started paying this request. This takes you back to the same secure Stripe page.</p>
            </div>
        );
    }

    return (
        <div className="mt-5 space-y-3">
            {error && <p className="text-[13px] text-rose-600">{error}</p>}
            {!countering ? (
                <div className="space-y-2">
                    <button type="button" disabled={busy} onClick={() => send('accept')} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                        Accept and pay £{amount.toFixed(2)}
                    </button>
                    <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => setCountering(true)} className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50">
                            Suggest a different amount
                        </button>
                        <button type="button" disabled={busy} onClick={() => { if (confirm('Decline this request? It will be sent to Galloway Getaways to resolve.')) send('decline'); }} className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50">
                            Decline
                        </button>
                    </div>
                </div>
            ) : (
                <div className="rounded-xl border border-slate-200 p-3">
                    <label className="block text-sm font-semibold text-slate-900">What would you pay instead?</label>
                    <div className="mt-1 flex items-center rounded-xl border border-slate-300 px-3">
                        <span className="text-slate-500">£</span>
                        <input inputMode="decimal" value={counter} onChange={(e) => setCounter(e.target.value)} placeholder="0.00" className="w-full py-2.5 pl-1 text-base outline-none" style={{ fontSize: 16 }} />
                    </div>
                    <p className="mt-1 text-[12px] text-slate-500">Your host can accept your amount or decline. Nothing is charged yet.</p>
                    <div className="mt-2 flex gap-2">
                        <button type="button" disabled={busy || !(Number(counter) > 0)} onClick={() => send('counter', Math.round(Number(counter) * 100) / 100)} className="flex-1 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-40">
                            Send suggestion
                        </button>
                        <button type="button" disabled={busy} onClick={() => setCountering(false)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Back</button>
                    </div>
                </div>
            )}
        </div>
    );
}
