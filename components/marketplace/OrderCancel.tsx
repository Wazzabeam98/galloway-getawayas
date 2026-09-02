'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle } from 'lucide-react';

// The cancel action for a booked experience, on the booking's own page. States
// the exact outcome before anything happens. Inside the no-refund window it gives
// the guest a real choice — ask the provider to refund, or walk away and forfeit —
// rather than blocking them; and the walk-away double-confirms and is recorded.
export default function OrderCancel({
    orderId, status, charged, free, price, providerName,
}: {
    orderId: string; status: string; charged: boolean; free: boolean; price: number; providerName: string;
}) {
    const router = useRouter();
    // 'closed' | 'open' (the outcome panel) | 'forfeit' (walk-away double-confirm)
    const [view, setView] = useState<'closed' | 'open' | 'forfeit'>('closed');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState('');

    async function act(mode: 'refund' | 'ask' | 'forfeit') {
        setBusy(true); setError('');
        try {
            const res = await fetch('/api/services/orders/cancel', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, mode }),
            });
            const d = await res.json();
            if (d && d.ok) {
                if (d.requested) {
                    setDone('Asked ' + providerName + ' for a refund — their reply will come to the messages above.');
                } else if (d.status === 'refunded') {
                    setDone('Cancelled — your refund is on its way.');
                } else {
                    setDone('Cancelled.');
                }
                setView('closed');
                router.refresh();
            } else setError((d && d.error) || 'Could not do that.');
        } catch { setError('Could not do that.'); }
        setBusy(false);
    }

    if (done) return <p className="text-sm font-medium text-emerald-700">{done}</p>;

    if (view === 'closed') {
        return (
            <button type="button" onClick={() => { setView('open'); setError(''); }}
                className="text-sm font-medium text-stone-500 underline underline-offset-2 hover:text-stone-800">
                Cancel this booking
            </button>
        );
    }

    // The walk-away second step — the only irreversible money loss in the flow, so
    // it asks twice and names the number both times.
    if (view === 'forfeit') {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <div className="text-sm font-semibold text-red-900">Cancel and lose the £{price.toFixed(2)}?</div>
                <p className="mt-1 text-sm text-red-800">
                    This can’t be undone. You won’t get the £{price.toFixed(2)} back, {providerName} keeps it, and your booking is cancelled.
                </p>
                <div className="mt-3 flex items-center gap-2">
                    <button type="button" disabled={busy} onClick={() => act('forfeit')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Yes, cancel and forfeit £{price.toFixed(2)}
                    </button>
                    <button type="button" onClick={() => setView('open')} className="px-3 py-2 text-sm font-semibold text-stone-600 hover:text-stone-900">Go back</button>
                </div>
                {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
            </div>
        );
    }

    // view === 'open' — the outcome panel, three shapes by what a cancel means now.
    return (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
            {!charged ? (
                <>
                    <div className="text-sm font-semibold text-stone-900">Withdraw this request?</div>
                    <p className="mt-1 text-sm text-stone-600">
                        Nothing has been charged{status === 'holding' ? ' — your place is only being held' : ''}, so there’s nothing to refund. This just takes it back.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                        <button type="button" disabled={busy} onClick={() => act('refund')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-stone-900 disabled:opacity-50">
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Yes, withdraw it
                        </button>
                        <button type="button" onClick={() => setView('closed')} className="px-3 py-2 text-sm font-semibold text-stone-600 hover:text-stone-900">Keep it</button>
                    </div>
                </>
            ) : free ? (
                <>
                    <div className="text-sm font-semibold text-stone-900">Cancel and get your money back?</div>
                    <p className="mt-1 text-sm text-stone-600">
                        You’ll get your full <span className="font-semibold">£{price.toFixed(2)}</span> back to your card. Refunds usually land in five to ten days, and {providerName}’s time reopens.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                        <button type="button" disabled={busy} onClick={() => act('refund')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cancel &amp; refund £{price.toFixed(2)}
                        </button>
                        <button type="button" onClick={() => setView('closed')} className="px-3 py-2 text-sm font-semibold text-stone-600 hover:text-stone-900">Keep booking</button>
                    </div>
                </>
            ) : (
                <>
                    <div className="text-sm font-semibold text-stone-900">Cancelling now won’t get your money back</div>
                    <p className="mt-1 text-sm text-stone-600">
                        You’re inside {providerName}’s cancellation window, so the <span className="font-semibold">£{price.toFixed(2)}</span> you paid isn’t refunded automatically. You can ask {providerName} to refund you — or cancel anyway and forfeit it.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button type="button" disabled={busy} onClick={() => act('ask')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} Ask {providerName} to refund
                        </button>
                        <button type="button" onClick={() => setView('forfeit')}
                            className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:text-red-900">
                            Cancel anyway — no refund
                        </button>
                        <button type="button" onClick={() => setView('closed')} className="px-3 py-2 text-sm font-semibold text-stone-600 hover:text-stone-900">Keep booking</button>
                    </div>
                </>
            )}
            {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
        </div>
    );
}
