'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';

// A co-host shouldn't have to ask the owner to be let go. This lives in the
// listing's own settings now (not on a dashboard card), so it leaves by listing
// id — the route finds the caller's own grant on it.
export default function LeaveListingBtn({
    listingId,
    title,
}: {
    listingId: string;
    title: string;
}) {
    const router = useRouter();
    const [confirming, setConfirming] = useState(false);
    const [working, setWorking] = useState(false);

    const leave = async () => {
        setWorking(true);

        try {
            const res = await fetch('/api/listing-access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'leave', listingId: listingId }),
            });
            const data = await res.json();

            if (data && data.ok) {
                toast.success('You no longer help with ' + title + '.', { theme: 'colored' });
                router.push('/dashboard');
                router.refresh();
                return;
            }

            toast.error((data && data.error) || 'Could not do that.', { theme: 'colored' });
        } catch (err) {
            toast.error('Could not do that.', { theme: 'colored' });
        }

        setWorking(false);
        setConfirming(false);
    };

    if (!confirming) {
        return (
            <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-sm font-semibold text-slate-600 underline hover:text-slate-900"
            >
                Leave this listing
            </button>
        );
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-700 mb-3">
                Stop helping with {title}? You&apos;ll lose access straight away, and the owner will
                be told. They can invite you back if you both change your minds.
            </p>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={leave}
                    disabled={working}
                    className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                >
                    {working ? 'Just a moment…' : 'Yes, step away'}
                </button>
                <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                >
                    Stay
                </button>
            </div>
        </div>
    );
}
