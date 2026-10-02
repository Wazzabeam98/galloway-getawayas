'use client';

import { useState } from 'react';

// The "Pay the balance now" action on a deposit-paid stay's reservation page.
// The balance is normally taken from the card automatically on the due date;
// this lets the guest settle it sooner. Opens the same Stripe balance checkout
// the payment-reminder email links to. Booker-only — the page renders it inside
// the money section that a companion never sees.
export default function PayBalanceButton({ bookingId }: { bookingId: string }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const pay = async () => {
        setBusy(true); setError('');
        try {
            const res = await fetch('/api/stripe/balance-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId }),
            });
            const data = await res.json();
            if (data && data.ok && data.url) { window.location.href = data.url; return; }
            setError((data && data.error) || 'Could not open the payment page. Please try again.');
        } catch {
            setError('Could not open the payment page. Please try again.');
        }
        setBusy(false);
    };

    return (
        <>
            <button
                type="button"
                onClick={pay}
                disabled={busy}
                className="mt-2 inline-flex items-center rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
            >
                {busy ? 'Opening payment…' : 'Pay the balance now'}
            </button>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </>
    );
}
