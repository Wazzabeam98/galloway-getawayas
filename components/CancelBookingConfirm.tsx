'use client';

import { useState } from 'react';
import { cancellationPosition } from '@/lib/cancellationView';

// The "Are you sure?" step of cancelling a stay — the one confirm panel the
// trips card AND the home upcoming-trip card both use, so the two can't drift
// into telling a guest different things. It states the refund in pounds
// (green when it's free or fully refunded, red only when cancelling costs
// money), names the experiences the stay-cancel takes with it, and calls the
// cancel route itself; the parent decides what happens after (refresh, or fold
// the card into its cancelled state) via onCancelled, and how to back out via
// onKeep.
//
// The £ figure is cancellationPosition's — refundDue's, the same sum
// /api/bookings/cancel will actually pay back — so the panel and the refund
// agree.

function fmtDay(s: string): string {
    const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function CancelBookingConfirm({
    bookingId,
    checkIn,
    policy,
    amountPaid,
    amountRefunded,
    cleaningFee,
    orders = [],
    onKeep,
    onCancelled,
}: {
    bookingId: string;
    checkIn: string;
    policy: string | null | undefined;
    amountPaid: number | null | undefined;
    amountRefunded: number | null | undefined;
    cleaningFee?: number | null;
    orders?: { item_name: string | null; service_date: string }[];
    onKeep: () => void;
    onCancelled: () => void;
}) {
    const [cancelling, setCancelling] = useState(false);
    const [error, setError] = useState('');

    const cancel = cancellationPosition({
        checkIn,
        policy,
        amountPaid,
        alreadyRefunded: amountRefunded,
        cleaningFee,
        on: new Date(),
    });
    const paidSoFar = cancel.paidSoFar;
    const refund = cancel.amount;
    const costs = paidSoFar > 0 && refund < paidSoFar;

    const doCancel = async () => {
        setCancelling(true);
        setError('');
        try {
            const res = await fetch('/api/bookings/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId }),
            });
            const data = await res.json();
            if (data && data.ok) { onCancelled(); return; }
            setError((data && data.error) || 'Could not cancel. Please try again.');
        } catch {
            setError('Could not cancel. Please try again.');
        }
        setCancelling(false);
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
            <div className="text-sm font-semibold text-slate-900">Are you sure?</div>
            <p className={'text-sm mt-1 ' + (cancel.kind === 'free' ? 'text-emerald-700' : costs ? 'text-red-700' : 'text-slate-600')}>
                {paidSoFar <= 0
                    ? 'You haven’t paid anything for this stay, so there’s nothing to refund.'
                    : refund >= paidSoFar
                        ? 'You’ll get your full £' + paidSoFar.toFixed(2) + ' back to your card, usually within five to ten days.'
                    : refund > 0
                        ? 'You’ll get £' + refund.toFixed(2) + ' of the £' + paidSoFar.toFixed(2) + ' you’ve paid back to your card, usually within five to ten days.'
                        : 'These dates are inside the non-refundable period for this place, so no refund is due on the £' + paidSoFar.toFixed(2) + ' you’ve paid.'}
            </p>

            {orders.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="text-xs font-semibold text-amber-900">
                        This also cancels the {orders.length === 1 ? 'experience' : 'experiences'} you’ve booked:
                    </div>
                    <ul className="mt-1 space-y-0.5 text-sm text-amber-950">
                        {orders.map((o, i) => (
                            <li key={i}>{o.item_name || 'Experience'}{o.service_date ? ' — ' + fmtDay(o.service_date) : ''}</li>
                        ))}
                    </ul>
                </div>
            )}

            <p className="text-xs text-slate-500 mt-2">
                The dates will be released for someone else, and this can’t be undone.
            </p>

            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

            <div className="mt-3 flex items-center gap-2">
                <button
                    type="button"
                    onClick={doCancel}
                    disabled={cancelling}
                    className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
                >
                    {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
                </button>
                <button
                    type="button"
                    onClick={onKeep}
                    className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                >
                    Keep my booking
                </button>
            </div>
        </div>
    );
}
