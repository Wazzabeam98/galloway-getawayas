'use client';

import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';

// The one payout door for a provider: POST /api/services/connect and go straight
// to Stripe, the same call the slot and experience dashboards already make.
//
// It replaces a Link that pointed at /services/join — the sign-up wizard — so
// pressing "Set up payouts" landed a provider back in the form they had already
// finished instead of at Stripe. Every "set up payouts" control now leads to the
// same place: Stripe Connect onboarding, returning to where they started.
export default function PayoutSetupButton({
    providerId,
    label = 'Set up payouts',
    className = 'inline-flex items-center gap-2 font-bold text-sm text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl px-5 py-3 transition disabled:opacity-60',
}: {
    providerId: string;
    label?: string;
    className?: string;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function go() {
        setBusy(true);
        setError(null);
        try {
            const r = await fetch('/api/services/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId }),
            });
            const d = await r.json();
            if (d && d.ok && d.url) {
                window.location.href = d.url;
                return;
            }
            setError((d && d.error) || 'Could not start payout setup.');
        } catch {
            setError('Could not start payout setup.');
        }
        setBusy(false);
    }

    return (
        <span className="inline-flex flex-col gap-1">
            <button type="button" onClick={go} disabled={busy} className={className}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {busy ? 'Opening Stripe…' : label}
                {!busy ? <ArrowRight className="w-4 h-4" strokeWidth={2.4} /> : null}
            </button>
            {error && <span className="text-xs font-semibold text-rose-700">{error}</span>}
        </span>
    );
}
