'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { formatGBP } from '@/lib/formatMoney';
import { checkAdminOrderRefund, REFUND_REASON_MIN } from '@/lib/adminOrderRefund';

// The refund control on one experience order in /admin/experience-orders.
// Shaped like the host's "Refund guest" panel (components/BookingActions.tsx):
// the full amount is the main button with the figure in its label, a part
// refund is a deliberate second choice. The reason comes first because nothing
// is sent without one — both the guest and the provider are shown it.
//
// The same rule as the route (lib/adminOrderRefund), so the form refuses what
// the route would. The route re-reads what is left from Stripe regardless.
export default function AdminOrderRefund({
    orderId,
    refundable,
    amountRefunded,
    moneyNote,
}: {
    orderId: string;
    refundable: number;
    amountRefunded: number;
    moneyNote: string;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [partial, setPartial] = useState(false);
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');

    const close = () => { setOpen(false); setPartial(false); setAmount(''); setReason(''); setError(''); };

    const send = async (requested: string | number) => {
        if (working) return;
        const check = checkAdminOrderRefund({ amount: requested, reason, refundable });
        if (check.ok === false) { setError(check.error); return; }
        setError('');
        setWorking(true);
        try {
            const res = await fetch('/api/admin/experience-orders/refund', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ orderId, amount: check.amount, reason: check.reason, expectedRefunded: amountRefunded }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.ok) {
                setError((body && body.error) || 'Could not process the refund.');
                setWorking(false);
                return;
            }
            toast.success(formatGBP(body.refunded) + ' refunded. The guest and the provider have been emailed.');
            close();
            setWorking(false);
            router.refresh();
        } catch {
            setError('Something went wrong. Nothing was refunded — try again.');
            setWorking(false);
        }
    };

    if (!open) {
        return (
            <div className="mt-4">
                <button type="button" onClick={() => setOpen(true)}
                    className="px-4 py-1.5 border border-slate-300 hover:border-slate-500 text-slate-700 text-sm font-semibold rounded-lg">
                    Refund guest
                </button>
            </div>
        );
    }

    return (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
            <div className="text-sm font-semibold text-slate-900">Refund the guest</div>
            <p className="text-sm text-slate-600 mt-1">{moneyNote}</p>

            <label className="block mt-3 text-xs font-semibold text-slate-700" htmlFor={'reason-' + orderId}>
                Reason
            </label>
            <textarea id={'reason-' + orderId} value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
                disabled={working}
                placeholder="What happened — the guest and the provider both see this."
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm outline-none focus:border-slate-900" />
            <p className="text-[12px] text-slate-500">At least {REFUND_REASON_MIN} characters.</p>

            <button type="button" onClick={() => send(refundable)} disabled={working}
                className="mt-3 w-full px-4 py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                {working && !partial ? 'Refunding…' : 'Refund the full ' + formatGBP(refundable)}
            </button>

            {!partial ? (
                <button type="button" onClick={() => { setPartial(true); setError(''); }} disabled={working}
                    className="mt-3 text-sm font-semibold text-slate-600 underline hover:text-slate-900 disabled:opacity-50">
                    Refund part of it instead
                </button>
            ) : (
                <div className="mt-3 pt-3 border-t border-slate-200">
                    <div className="text-xs text-slate-500 mb-2">Anything up to {formatGBP(refundable)}.</div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-slate-500">£</span>
                        <input type="number" min="0" step="0.01" inputMode="decimal" value={amount}
                            onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus disabled={working}
                            className="w-28 border rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-slate-900" />
                        <button type="button" onClick={() => send(amount)} disabled={working}
                            className="px-4 py-2 border border-slate-300 bg-white hover:border-slate-900 text-slate-800 text-sm font-semibold rounded-lg disabled:opacity-50">
                            {working ? 'Refunding…' : 'Refund that instead'}
                        </button>
                    </div>
                </div>
            )}

            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

            <button type="button" onClick={close} disabled={working}
                className="mt-3 block text-sm font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-50">
                Don&apos;t refund anything
            </button>
        </div>
    );
}
