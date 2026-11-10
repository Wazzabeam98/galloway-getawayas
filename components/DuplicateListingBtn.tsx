'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy } from 'lucide-react';
import { toast } from 'react-toastify';

// "Create from an existing listing." Copies this listing into a new draft and
// opens it in the add-a-listing wizard, where the host changes only what is
// different for the new place — the title, photos and price. Everything else
// (address, capacity, check-in, amenities, house rules, safety, cancellation,
// discounts, description) comes across. See /api/listings/duplicate.
export default function DuplicateListingBtn({ id, title }: { id: string; title?: string }) {
    const router = useRouter();
    const [working, setWorking] = useState(false);

    const duplicate = async () => {
        if (working) return;
        setWorking(true);
        try {
            const res = await fetch('/api/listings/duplicate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listingId: id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!data || !data.ok || !data.draftId) {
                toast.error((data && data.error) || 'Could not copy that listing.', { theme: 'colored' });
                setWorking(false);
                return;
            }
            const copied = data.sourceTitle || title || '';
            router.push('/addhome?draft=' + encodeURIComponent(data.draftId) + (copied ? '&copied=' + encodeURIComponent(copied) : '&copied=1'));
        } catch {
            toast.error('Something went wrong.', { theme: 'colored' });
            setWorking(false);
        }
    };

    return (
        <button
            type="button"
            onClick={duplicate}
            disabled={working}
            title="Create a new listing from this one"
            className="h-8 px-3 rounded-full bg-white/95 hover:bg-white shadow-sm flex items-center gap-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
        >
            <Copy className="w-3.5 h-3.5" />
            {working ? 'Copying…' : 'Duplicate'}
        </button>
    );
}
