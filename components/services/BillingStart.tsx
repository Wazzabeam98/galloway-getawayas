'use client';

import { useState } from 'react';

// The button that opens Stripe.
//
// A POST rather than a link, so nothing starts a subscription by merely
// fetching a URL — see the page this sits on, and the enquiry reply beside it,
// for why that matters in an inbox full of scanners.
//
// Card details are typed on Stripe's own page. Nothing card-shaped is ever
// asked for here, and this component holds no payment state of any kind.
export default function BillingStart({ token, monthly }: { token: string; monthly: number }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState('');

    const start = async () => {
        setBusy(true);
        setError('');

        try {
            const res = await fetch('/api/services/billing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });

            const json = await res.json();

            if (!json.ok) {
                setBusy(false);
                setError(json.error || 'Could not open the payment page.');
                return;
            }

            // Already set up. Nothing to send him to, and telling him so is
            // better than bouncing him to Stripe to be confused.
            if (json.already) {
                setBusy(false);
                setDone(json.message || 'You are already set up.');
                return;
            }

            window.location.href = json.url;
        } catch (err: any) {
            setBusy(false);
            setError('Could not open the payment page. Please try again.');
        }
    };

    if (done) {
        return <p className="mt-8 rounded-xl bg-emerald-50 text-emerald-900 p-4">{done}</p>;
    }

    return (
        <div className="mt-8">
            <button
                type="button"
                onClick={start}
                disabled={busy}
                className="w-full rounded-xl bg-emerald-700 px-5 py-3 text-white font-semibold hover:bg-emerald-800 disabled:opacity-60"
            >
                {busy ? 'Opening…' : 'Add a card — £' + monthly + ' a month'}
            </button>

            {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

            <p className="mt-3 text-sm text-slate-500">
                You will be taken to Stripe to enter your card. We never see or hold your card
                details.
            </p>
        </div>
    );
}
