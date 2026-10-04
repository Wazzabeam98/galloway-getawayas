'use client';

import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';

// The desktop section bar, Airbnb's way. On a listing page the main nav scrolls
// away (ChromeGate un-sticks it), and this takes its place at the very top once
// you're past the photos — the section links on the left always, and the price,
// rating and booking button on the right ONLY once the booking card itself has
// scrolled out of view (so the two never say the same thing at once).
//
// The button reads "Check availability" until dates are chosen and scrolls back
// to the booking card's calendar; once a range is chosen it becomes the request-
// to-book action. It learns the date state from the booking card via a custom
// event (the card writes dates to the URL with replaceState, which
// useSearchParams can't see).
//
// Desktop only (hidden lg:block): a phone keeps the bottom MobileBookingBar.
const BAR_H = 56; // h-14

export default function ListingStickyHeader({
    links,
    pricePerNight,
    reserveLabel,
    showScore,
    ratingAvg,
    ratingCount,
}: {
    links: { id: string; label: string }[];
    pricePerNight: number;
    reserveLabel: string;
    showScore: boolean;
    ratingAvg: number;
    ratingCount: number;
}) {
    const [barShown, setBarShown] = useState(false);
    const [cardGone, setCardGone] = useState(false);
    const [hasDates, setHasDates] = useState(false);

    // Show the bar once the photos have scrolled off the top.
    useEffect(() => {
        const sentinel = document.getElementById('sticky-sentinel');
        if (!sentinel) return;
        const io = new IntersectionObserver(
            ([entry]) => setBarShown(entry.boundingClientRect.top <= 0),
            { threshold: [0, 1] }
        );
        io.observe(sentinel);
        return () => io.disconnect();
    }, []);

    // Reveal the right-hand price/button once the booking card has scrolled past
    // the bar (its release point reaches the bar line).
    useEffect(() => {
        const sentinel = document.getElementById('bookcard-sentinel');
        if (!sentinel) return;
        const io = new IntersectionObserver(
            ([entry]) => setCardGone(entry.boundingClientRect.top <= BAR_H),
            { threshold: [0, 1] }
        );
        io.observe(sentinel);
        return () => io.disconnect();
    }, []);

    // Date state: initial from the URL, then kept current by the booking card's
    // event.
    useEffect(() => {
        try {
            const p = new URLSearchParams(window.location.search);
            setHasDates(!!(p.get('check_in') && p.get('check_out')));
        } catch { /* ignore */ }
        const onDates = (e: Event) => setHasDates(!!(e as CustomEvent).detail?.hasDates);
        window.addEventListener('gg:booking-dates', onDates as EventListener);
        return () => window.removeEventListener('gg:booking-dates', onDates as EventListener);
    }, []);

    const go = (id: string) => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <div
            className={
                'hidden lg:block fixed inset-x-0 top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur ' +
                'transition-all duration-200 ' +
                (barShown
                    ? 'opacity-100 translate-y-0 pointer-events-auto'
                    : 'opacity-0 -translate-y-full pointer-events-none')
            }
            aria-hidden={!barShown}
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

                {/* Right side: price, rating and button, only once the booking
                    card has gone. Kept mounted and faded so it doesn't jump. */}
                <div
                    className={
                        'flex items-center gap-4 transition-opacity duration-200 ' +
                        (cardGone ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
                    }
                >
                    <div className="text-right leading-tight">
                        <div className="text-sm">
                            <span className="font-bold text-slate-900">£{pricePerNight}</span>{' '}
                            <span className="text-slate-500">/ night</span>
                        </div>
                        {showScore && (
                            <div className="flex items-center justify-end gap-1 text-xs text-slate-500">
                                <Star className="h-3 w-3 fill-slate-900 text-slate-900" />
                                <span className="font-semibold text-slate-900">{ratingAvg.toFixed(2)}</span>
                                <span>· {ratingCount} review{ratingCount === 1 ? '' : 's'}</span>
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => go('book')}
                        className="rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    >
                        {hasDates ? reserveLabel : 'Check availability'}
                    </button>
                </div>
            </div>
        </div>
    );
}
