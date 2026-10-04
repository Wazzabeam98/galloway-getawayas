'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { CalendarX2 } from 'lucide-react';

// The trade's own £20 subscription, on Edit your business. Cancelling is at the
// end of the period they've paid for (Tradesperson Agreement 3.4): the confirm
// names that date before the press, the section then says when it ends, and
// "Keep my subscription" undoes it any time before. Dates arrive as DD/MM/YYYY
// strings from the server (the shared formatter, built from the London day key).
//
// Flat section, like Listing status beside it — an editor form, not a lifted card.
export default function TradeSubscription({ providerId, state }: {
    providerId: string;
    state:
        | { kind: 'live'; trialing: boolean; periodEnd: string | null }
        | { kind: 'ending'; endsOn: string | null }
        | { kind: 'ended' }
        | { kind: 'unknown' };
}) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);

    async function act(action: 'cancel' | 'undo' | 'restart') {
        setBusy(true);
        const res = await fetch('/api/services/subscription', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerId, action }),
        });
        const data = await res.json().catch(() => null);
        setBusy(false);
        if (!data || !data.ok) {
            toast.error((data && data.error) || 'Could not change your subscription.', { theme: 'colored' });
            return;
        }
        if (action === 'restart' && data.link) { window.location.href = data.link; return; }
        setConfirming(false);
        toast.success(action === 'cancel' ? 'Your subscription is cancelled.' : 'Your subscription carries on.', { theme: 'colored' });
        router.refresh();
    }

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-xl font-bold text-slate-900">Subscription</h2>

            {state.kind === 'live' && (
                <>
                    <p className="mt-1 text-sm text-slate-500">
                        £20 a month.{' '}
                        {state.periodEnd
                            ? (state.trialing
                                ? 'Your free period ends on ' + state.periodEnd + ', when the first payment is taken.'
                                : 'Your next payment is on ' + state.periodEnd + '.')
                            : ''}
                    </p>
                    {!confirming ? (
                        <button type="button" onClick={() => setConfirming(true)} disabled={busy}
                            className="mt-4 text-sm font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-900">
                            Cancel subscription
                        </button>
                    ) : (
                        <div className="mt-4 rounded-xl border border-slate-200 p-4">
                            <div className="font-semibold text-slate-900">Cancel your subscription?</div>
                            <p className="mt-1 text-sm text-slate-600">
                                {state.periodEnd
                                    ? 'Your listing stays up until ' + state.periodEnd + (state.trialing ? ', the end of your free period' : ', the end of the month you’ve paid for') + ', then comes down. '
                                    : 'Your listing stays up until the end of the month you’ve paid for, then comes down. '}
                                Nothing more is charged{state.trialing ? '' : ', and we don’t refund part months'}. You can change your mind any time before then. Jobs you’ve already accepted aren’t affected.
                            </p>
                            <div className="mt-4 flex flex-wrap gap-3">
                                <button type="button" onClick={() => act('cancel')} disabled={busy}
                                    className="rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-900 disabled:opacity-60">
                                    {busy ? '…' : 'Cancel subscription'}
                                </button>
                                <button type="button" onClick={() => setConfirming(false)} disabled={busy}
                                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900">
                                    Keep it
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {state.kind === 'ending' && (
                <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <div className="flex items-start gap-2.5">
                        <CalendarX2 className="mt-0.5 h-5 w-5 flex-none text-amber-700" aria-hidden />
                        <div>
                            <div className="font-semibold text-slate-900">
                                {state.endsOn ? 'Your subscription ends on ' + state.endsOn : 'Your subscription is cancelled'}
                            </div>
                            <p className="text-sm text-slate-600">
                                Your listing stays up until then, and nothing more is charged. Changed your mind? Keep it and nothing changes.
                            </p>
                        </div>
                    </div>
                    <button type="button" onClick={() => act('undo')} disabled={busy}
                        className="mt-4 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60">
                        {busy ? '…' : 'Keep my subscription'}
                    </button>
                </div>
            )}

            {state.kind === 'ended' && (
                <>
                    <p className="mt-1 text-sm text-slate-500">
                        Your listing isn’t showing to hosts because there’s no subscription running. Add a card to put it back up.
                    </p>
                    <button type="button" onClick={() => act('restart')} disabled={busy}
                        className="mt-4 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60">
                        {busy ? '…' : 'Add a card'}
                    </button>
                </>
            )}

            {state.kind === 'unknown' && (
                <p className="mt-1 text-sm text-slate-500">
                    We can’t load your subscription just now. Try again in a moment.
                </p>
            )}
        </section>
    );
}
