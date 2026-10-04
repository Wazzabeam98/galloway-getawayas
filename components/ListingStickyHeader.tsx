'use client';

import { useEffect, useState } from 'react';
import { formatGBP } from '@/lib/formatMoney';

// The desktop sticky header Airbnb shows once you scroll past the photos: the
// in-page section links on the left, the price and the Reserve button on the
// right. Hidden until you're past the gallery, then it fades in and rides the
// top of the page under the site nav.
//
// Desktop only (hidden lg:block): on a phone the MobileBookingBar at the foot
// already keeps the price and the CTA in reach, and a second sticky bar up top
// would eat the small screen.
//
// Sits at top-20 (the nav is h-20, sticky top-0, z-50) and one layer below it
// (z-40), so the two never overlap. It's `fixed`, so it takes no layout space
// and can't show a phantom bar mid-page the way a sticky-in-flow one would.
export default function ListingStickyHeader({
    links,
    pricePerNight,
    reserveLabel,
}: {
    links: { id: string; label: string }[];
    pricePerNight: number;
    reserveLabel: string;
}) {
    const [shown, setShown] = useState(false);

    useEffect(() => {
        const sentinel = document.getElementById('sticky-sentinel');
        if (!sentinel) return;
        // Show the bar once the sentinel (sat just below the gallery) has scrolled
        // UP past the nav — not when it's still below the fold before you scroll.
        // isIntersecting alone can't tell those apart (both read false), so test
        // the sentinel's own top against the nav height (80px): it's negative-ish
        // only once you've scrolled past the photos.
        const io = new IntersectionObserver(
            ([entry]) => setShown(entry.boundingClientRect.top < 80),
            { threshold: [0, 1] }
        );
        io.observe(sentinel);
        return () => io.disconnect();
    }, []);

    const go = (id: string) => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <div
            className={
                'hidden lg:block fixed inset-x-0 top-20 z-40 border-b border-slate-200 bg-white/95 backdrop-blur ' +
                'transition-all duration-200 ' +
                (shown
                    ? 'opacity-100 translate-y-0 pointer-events-auto'
                    : 'opacity-0 -translate-y-2 pointer-events-none')
            }
            aria-hidden={!shown}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
                <nav className="flex items-center gap-7 text-sm font-medium text-slate-600">
                    {links.map((l) => (
                        <button
                            key={l.id}
                            type="button"
                            onClick={() => go(l.id)}
                            className="py-2 border-b-2 border-transparent hover:border-slate-900 hover:text-slate-900 transition"
                        >
                            {l.label}
                        </button>
                    ))}
                </nav>
                <div className="flex items-center gap-4">
                    <span className="text-sm">
                        <span className="font-bold text-slate-900">{formatGBP(pricePerNight)}</span>{' '}
                        <span className="text-slate-500">/ night</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => go('book')}
                        className="rounded-full bg-emerald-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    >
                        {reserveLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
