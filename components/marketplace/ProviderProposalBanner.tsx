'use client';

import { useState } from 'react';
import { CalendarDays, Loader2, Check } from 'lucide-react';

// The guest's side of a PROVIDER-proposed date/time change: the provider parked a
// new date/time (pending_change_by='provider'); the guest accepts (apply) or
// declines (keep the original) here. Nothing moves on the card either way — a
// date change carries no money. Mirrors the provider answering a guest's request.
export default function ProviderProposalBanner({ orderId, whenLabel, businessName }: {
    orderId: string; whenLabel: string; businessName: string;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function answer(action: 'accept' | 'decline') {
        setBusy(action); setError(null);
        try {
            const r = await fetch('/api/services/order/change-date', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, action }),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d && d.ok) { window.location.reload(); return; }
            setError((d && d.error) || 'That didn’t go through. Try again.');
        } catch { setError('That didn’t go through. Try again.'); }
        setBusy(null);
    }

    return (
        <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4">
            <div className="flex items-start gap-3">
                <CalendarDays className="mt-0.5 h-5 w-5 flex-none text-emerald-700" />
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-emerald-950">{businessName} proposed a new time</div>
                    <div className="mt-0.5 text-sm text-emerald-900/80">
                        Move your booking to <span className="font-semibold">{whenLabel}</span>? Nothing changes on your card either way.
                    </div>
                </div>
            </div>
            <div className="mt-3 flex gap-2 pl-8">
                <button type="button" disabled={!!busy} onClick={() => answer('accept')} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                    {busy === 'accept' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Accept
                </button>
                <button type="button" disabled={!!busy} onClick={() => answer('decline')} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500 disabled:opacity-60">
                    Keep the original
                </button>
            </div>
            {error && <p className="mt-2 pl-8 text-[13px] text-rose-700">{error}</p>}
        </div>
    );
}
