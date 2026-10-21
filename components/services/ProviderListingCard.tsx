'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, Sparkles } from 'lucide-react';

// One card on the provider's "Your listing" page — the holiday-let host's
// listing card (app/dashboard/page.tsx), item for item: the photo with its
// status pill, the title, where it is, and a View button for one that is live.
// Clicking it opens that listing's editor. The editor shows one business at a
// time (the gg_business cookie, lib/providerAccess), so the card picks this one
// first — the same cookie the business switcher sets.

export interface ProviderCardItem {
    id: string;
    title: string;
    category: string | null;
    place: string | null;
    image: string | null;
    status: string;
    paused: boolean;
    takenDown: boolean;
    cohosted: boolean;
}

export default function ProviderListingCard({ item }: { item: ProviderCardItem }) {
    const router = useRouter();
    const live = item.status === 'approved' && !item.paused && !item.takenDown;
    const waiting = item.status === 'pending_review';
    const sentBack = item.status === 'declined';
    const hidden = item.status === 'approved' && (item.paused || item.takenDown);

    const pillTone = waiting ? 'bg-sky-100 text-sky-900'
        : sentBack ? 'bg-amber-100 text-amber-800'
        : hidden ? 'bg-slate-200 text-slate-700'
        : live ? 'bg-white/95'
        : 'bg-amber-100 text-amber-800';
    const dotTone = waiting ? 'bg-sky-600'
        : sentBack ? 'bg-amber-500'
        : hidden ? 'bg-slate-500'
        : live ? 'bg-green-500'
        : 'bg-amber-500';
    const pillLabel = waiting ? 'Waiting for approval'
        : sentBack ? 'Needs changes'
        : item.takenDown ? 'Hidden'
        : item.paused ? 'Paused'
        : live ? 'Listed'
        : 'In progress';

    const open = () => {
        document.cookie = 'gg_business=' + encodeURIComponent(item.id) + '; path=/; max-age=31536000; samesite=lax';
        router.push('/services/dashboard/listing');
    };

    return (
        <div className="relative group">
            <button type="button" onClick={open} className="block w-full text-left">
                <div className="w-full h-56 rounded-2xl overflow-hidden bg-slate-200 relative">
                    {item.image ? (
                        <img src={item.image} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                    ) : (
                        <div className="flex items-center justify-center h-full text-slate-400">
                            <Sparkles className="w-10 h-10" />
                        </div>
                    )}
                    <span className={`absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm ${pillTone}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${dotTone}`} />
                        {pillLabel}
                    </span>
                </div>
                <h3 className="font-semibold text-slate-900 mt-3 truncate">{item.title}</h3>
                <p className="text-sm text-slate-500 truncate">{[item.category, item.place].filter(Boolean).join(' · ') || 'No location yet'}</p>
                {waiting && <p className="text-sm font-medium text-sky-800 mt-0.5">We&apos;re checking it over — nothing more for you to do</p>}
                {sentBack && <p className="text-sm font-medium text-amber-800 mt-0.5">Open it to see what to change</p>}
                {hidden && <p className="text-sm font-medium text-slate-600 mt-0.5">Not taking new bookings</p>}
                {item.cohosted && <p className="text-xs text-slate-400 mt-0.5">You co-host this</p>}
            </button>

            {live && (
                <div className="absolute top-3 right-3 z-10 flex gap-2 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition">
                    <Link
                        href={`/experiences/browse/${item.id}`}
                        title="See how guests see it"
                        className="h-8 px-3 rounded-full bg-white/95 hover:bg-white shadow-sm flex items-center gap-1.5 text-xs font-semibold text-slate-700"
                    >
                        <Eye className="w-3.5 h-3.5" />
                        View
                    </Link>
                </div>
            )}
        </div>
    );
}
