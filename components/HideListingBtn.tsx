'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { EyeOff, Undo2 } from 'lucide-react';
import { toast } from 'react-toastify';

// Hiding takes a property out of search and stops new bookings. Stays that are
// already booked are untouched — a host who wants to stop letting still has to
// see out the guests who have paid.
export default function HideListingBtn({
    id,
    hidden,
    title,
}: {
    id: string;
    hidden: boolean;
    title?: string;
}) {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const [working, setWorking] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const apply = async () => {
        setWorking(true);

        const { error } = await supabase
            .from('listings')
            .update({ status: hidden ? 'published' : 'hidden' })
            .eq('id', id);

        setWorking(false);
        setConfirming(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        toast.success(
            hidden
                ? 'Back on the site and taking bookings.'
                : 'Hidden. Bookings you already have are unaffected.',
            { theme: 'colored' }
        );
        router.refresh();
    };

    // Putting a listing back needs no ceremony — it's the harmless direction.
    if (hidden) {
        return (
            <button
                type="button"
                onClick={apply}
                disabled={working}
                title="Put this listing back on the site"
                className="h-8 px-3 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm flex items-center gap-1.5 text-xs font-semibold disabled:opacity-50"
            >
                <Undo2 className="w-3.5 h-3.5" />
                Relist
            </button>
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={working}
                title="Hide from the site"
                className="h-8 px-3 rounded-full bg-white/95 hover:bg-white shadow-sm flex items-center gap-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
                <EyeOff className="w-3.5 h-3.5" />
                Hide
            </button>

            {confirming && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                    onClick={() => setConfirming(false)}
                >
                    <div
                        className="bg-white rounded-2xl p-6 max-w-sm w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="font-bold text-slate-900 mb-2">
                            Hide {title || 'this listing'}?
                        </h3>
                        <p className="text-sm text-slate-600 mb-2">
                            It comes off the site straight away and stops taking new bookings.
                            Nobody will be able to find it.
                        </p>
                        <p className="text-sm text-slate-600 mb-4">
                            Bookings you have already accepted are not affected — you still need to
                            host those guests. Cancelling them counts as a host cancellation.
                        </p>
                        <p className="text-xs text-slate-400 mb-5">
                            You can put it back whenever you like.
                        </p>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={apply}
                                disabled={working}
                                className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-xl disabled:opacity-50"
                            >
                                {working ? 'Hiding…' : 'Hide it'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirming(false)}
                                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >
                                Keep it listed
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
