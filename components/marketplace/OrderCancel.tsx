'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle, Ban } from 'lucide-react';

// The cancel action for a booked experience, on the booking's own page. States
// the exact outcome before anything happens. Inside the no-refund window it says
// so plainly and lets the guest cancel anyway (double-confirmed and recorded),
// with a quiet "Message the provider" link beneath in case they want to ask
// first — rather than leading with a structured refund request.
//
// `className` turns the trigger into an action-row icon button (Ban + "Cancel")
// instead of the plain underlined link; `panelClassName` is put on the outcome
// panels so the caller can float them full-width below the row (basis-full).
export default function OrderCancel({
    orderId, status, charged, free, price, providerName, className, panelClassName,
}: {
    orderId: string; status: string; charged: boolean; free: boolean; price: number; providerName: string;
    className?: string; panelClassName?: string;
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

    const cx = (...c: (string | undefined | false)[]) => c.filter(Boolean).join(' ');

    if (done) return <p className={cx(panelClassName, 'text-sm font-medium text-emerald-700')}>{done}</p>;

    // The trigger toggles the outcome panel open and shut. As an action-row icon
    // button when `className` is given, or the plain underlined link otherwise.
    const trigger = (
        <button type="button" onClick={() => { setView(view === 'closed' ? 'open' : 'closed'); setError(''); }}
            className={className || 'text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800'}>
            {/* Wrapped so the icon and label stay together at the left of a
                justify-between action row — unwrapped, the two became separate
                flex children and the word "Cancel" was flung to the far right.
                No trailing chevron on purpose: the neighbouring rows navigate,
                this one opens a panel in place, and the chevron is what tells
                those two apart. */}
            {className ? <span className="flex items-center gap-3"><Ban className="h-4 w-4 flex-none text-slate-400" /> Cancel reservation</span> : 'Cancel this booking'}
        </button>
    );

    return (
        <>
            {trigger}

            {/* The walk-away second step — the only irreversible money loss in the
                flow, so it asks twice and names the number both times. */}
            {view === 'forfeit' && (
                <div className={cx(panelClassName, 'rounded-xl border border-red-200 bg-red-50 p-4')}>
                    <div className="text-sm font-semibold text-red-900">Cancel and lose the £{price.toFixed(2)}?</div>
                    <p className="mt-1 text-sm text-red-800">
                        This can’t be undone. You won’t get the £{price.toFixed(2)} back, {providerName} keeps it, and your booking is cancelled.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                        <button type="button" disabled={busy} onClick={() => act('forfeit')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Yes, cancel and forfeit £{price.toFixed(2)}
                        </button>
                        <button type="button" onClick={() => setView('open')} className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900">Go back</button>
                    </div>
                    {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
                </div>
            )}

            {/* The outcome panel — three shapes by what a cancel means now. */}
            {view === 'open' && (
                <div className={cx(panelClassName, 'rounded-xl border border-slate-200 bg-white p-4')}>
                    {!charged ? (
                <>
                    <div className="text-sm font-semibold text-slate-900">Withdraw this request?</div>
                    <p className="mt-1 text-sm text-slate-600">
                        Nothing has been charged{status === 'holding' ? ' — your place is only being held' : ''}, so there’s nothing to refund. This just takes it back.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                        <button type="button" disabled={busy} onClick={() => act('refund')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50">
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cancel reservation
                        </button>
                        <button type="button" onClick={() => setView('closed')} className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900">Keep it</button>
                    </div>
                </>
            ) : free ? (
                <>
                    <div className="text-sm font-semibold text-slate-900">Cancel and get your money back?</div>
                    <p className="mt-1 text-sm text-slate-600">
                        You’ll get your full <span className="font-semibold">£{price.toFixed(2)}</span> back to your card.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                        {/* A full refund is on the table, so this confirm is not a
                            destructive act — neutral, like the withdraw button. The
                            red is reserved for the no-refund walk-away below. */}
                        <button type="button" disabled={busy} onClick={() => act('refund')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50">
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cancel reservation
                        </button>
                        <button type="button" onClick={() => setView('closed')} className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900">Keep booking</button>
                    </div>
                </>
            ) : (
                <>
                    <div className="text-sm font-medium text-slate-900">You won’t be refunded if you cancel now.</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setView('forfeit')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-800">
                            Cancel reservation
                        </button>
                        <button type="button" onClick={() => setView('closed')} className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900">Keep booking</button>
                    </div>
                    <Link href={'/messages?o=' + orderId}
                        className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800">
                        <MessageCircle className="h-3.5 w-3.5" /> Message {providerName}
                    </Link>
                </>
                    )}
                    {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
                </div>
            )}
        </>
    );
}
