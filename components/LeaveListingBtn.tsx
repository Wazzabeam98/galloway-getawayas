'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';

// A co-host shouldn't have to ask the owner to be let go.
export default function LeaveListingBtn({
    accessId,
    title,
}: {
    accessId: string;
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
                body: JSON.stringify({ action: 'leave', accessId: accessId }),
            });
            const data = await res.json();

            if (data && data.ok) {
                toast.success('You no longer help with ' + title + '.', { theme: 'colored' });
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
                className="text-xs font-semibold text-slate-500 underline hover:text-slate-800 mt-2"
            >
                Stop helping with this
            </button>
        );
    }

    return (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm text-slate-700 mb-2">
                Stop helping with {title}? You&apos;ll lose access straight away, and the owner will
                be told. They can invite you back if you both change your minds.
            </p>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={leave}
                    disabled={working}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                >
                    {working ? 'Just a moment…' : 'Yes, step away'}
                </button>
                <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                    Stay
                </button>
            </div>
        </div>
    );
}
