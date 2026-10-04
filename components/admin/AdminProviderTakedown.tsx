'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EyeOff, Undo2 } from 'lucide-react';
import { toast } from 'react-toastify';

// Taking a live experience or trade off the site, or putting it back — the
// provider twin of AdminListingRow's Hide / Relist. The reason box is the point:
// nothing happens without one, and it goes in admin_actions against your name.
//
// For a trade with a card on file, the take-down also cancels their £20
// subscription, so the confirm says so before the press rather than after.
export default function AdminProviderTakedown({ id, name, ownerName, isTrade, hasSubscription, hidden }: {
    id: string;
    name: string;
    ownerName: string;
    isTrade: boolean;
    hasSubscription: boolean;
    hidden: boolean;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [working, setWorking] = useState(false);

    const apply = async () => {
        setWorking(true);
        const res = await fetch('/api/admin/providers/visibility', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerId: id, hidden: !hidden, reason }),
        });
        const data = await res.json().catch(() => null);
        setWorking(false);

        if (!data || !data.ok) {
            toast.error((data && data.error) || 'Could not change that.', { theme: 'colored' });
            return;
        }

        setOpen(false);
        setReason('');
        toast.success(
            hidden
                ? 'Back on the site.'
                : 'Taken down. ' + (isTrade ? 'Existing enquiries are untouched.' : 'Existing bookings are untouched.')
                    + (data.billing === 'cancelled' ? ' Their subscription is cancelled.' : ''),
            { theme: 'colored' }
        );
        router.refresh();
    };

    return (
        <div className="mt-4 border-t border-slate-100 pt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
                {hidden ? 'Taken down by an admin — not on the site.' : 'On the site.'}
            </p>
            <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={working}
                className={`h-8 px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 ${
                    hidden
                        ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                        : 'border border-slate-300 hover:border-slate-900 text-slate-700'
                }`}
            >
                {hidden ? <Undo2 className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {hidden ? 'Relist' : 'Take down'}
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                    onClick={() => !working && setOpen(false)}
                >
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
                        <h3 className="font-bold text-slate-900 mb-2">
                            {hidden ? 'Put ' : 'Take down '}{name}{hidden ? ' back on the site?' : '?'}
                        </h3>

                        {ownerName && (
                            <p className="text-sm text-slate-600 mb-3">
                                This belongs to {ownerName}. They are not told automatically.
                            </p>
                        )}

                        {!hidden && (
                            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                                {isTrade
                                    ? 'Hosts stop finding them and can’t send new enquiries. Enquiries and jobs already under way carry on.'
                                    : 'Guests stop finding it and can’t book it. Bookings already made carry on — the guests keep them and the provider still runs them.'}
                                {isTrade && hasSubscription && ' Their £20 a month subscription is cancelled at Stripe.'}
                            </p>
                        )}

                        {hidden && isTrade && (
                            <p className="text-sm text-slate-600 mb-3">
                                If the take-down cancelled their subscription, they go back on the card reminders —
                                with their free period over, that is a card link in three days and off the directory in
                                seven if they don’t add one.
                            </p>
                        )}

                        <label className="text-xs font-semibold text-slate-700">
                            Why? This is recorded against your name.
                        </label>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            autoFocus
                            placeholder={isTrade ? 'e.g. Gas Safe registration could not be confirmed' : 'e.g. Photos show a different business'}
                            className="w-full p-2.5 border rounded-lg text-sm mt-1 mb-4"
                        />

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={apply}
                                disabled={working || reason.trim().length < 3}
                                className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-xl disabled:opacity-40"
                            >
                                {working ? 'Saving…' : hidden ? 'Put it back' : 'Take it down'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                disabled={working}
                                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
