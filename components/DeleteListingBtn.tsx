'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { toast } from 'react-toastify';

// Deleting a listing for good. The dashboard only shows this for a listing the
// host owns that has never had a booking (lib/listingRemoval); a booked one
// gets Hide instead, so this is never a button that then refuses.
export default function DeleteListingBtn({
    id,
    title,
    canHide,
}: {
    id: string;
    title?: string;
    // Whether Hide is offered beside it — a draft or a listing waiting for
    // approval cannot be hidden, so the dialog must not suggest it.
    canHide: boolean;
}) {
    const router = useRouter();
    const [working, setWorking] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const name = title && title.trim() ? title.trim() : 'this listing';

    const apply = async () => {
        setWorking(true);
        let data: any = null;
        try {
            const res = await fetch('/api/listings/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listingId: id }),
            });
            data = await res.json();
        } catch {
            data = null;
        }
        setWorking(false);
        setConfirming(false);

        if (!data || !data.ok) {
            toast.error((data && data.error) || 'Could not delete that listing.', { theme: 'colored' });
            // A booking that landed since the page loaded turns this into a
            // Hide on the refreshed dashboard.
            if (data && data.mustHide) router.refresh();
            return;
        }

        toast.success('Listing deleted.', { theme: 'colored' });
        router.refresh();
    };

    return (
        <>
            <button
                type="button"
                onClick={(e) => { e.preventDefault(); setConfirming(true); }}
                disabled={working}
                title="Delete this listing permanently"
                className="h-8 px-3 rounded-full bg-white/95 hover:bg-white shadow-sm flex items-center gap-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"
            >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
            </button>

            {confirming && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                    onClick={() => !working && setConfirming(false)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={'delete-listing-' + id}
                        className="bg-white rounded-2xl p-6 max-w-sm w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 id={'delete-listing-' + id} className="font-bold text-slate-900 mb-2">
                            Delete {name}?
                        </h3>
                        <p className="text-sm text-slate-600 mb-2">
                            This is permanent. The listing, its photos, its calendar and its
                            settings are deleted and can&apos;t be brought back.
                        </p>
                        <p className="text-sm text-slate-600 mb-5">
                            It has never had a booking, which is why it can be deleted.
                            {canHide && ' If you only want it off the site for a while, hide it instead.'}
                        </p>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={apply}
                                disabled={working}
                                className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-semibold rounded-xl disabled:opacity-50"
                            >
                                {working ? 'Deleting…' : 'Delete permanently'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirming(false)}
                                disabled={working}
                                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >
                                Keep it
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
