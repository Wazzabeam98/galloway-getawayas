"use client"

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { getImageUrl } from '@/lib/utils';

// The listing photo gallery — the same on every cottage and experience page.
//
// DESKTOP is an Airbnb-style mosaic, never an equal grid: one large photo on the
// left, and beside it either four smaller (5+), two stacked (3–4), a single
// full-height photo across the remaining third (2), or nothing (1, full width at
// the normal height). Anything past what the mosaic shows lives behind "Show all".
//
// MOBILE is one swipeable photo at a time with a "1 / N" counter; tapping any
// photo opens the full gallery.
//
// `area` is only used for the alt text, and it is there because the title on its
// own is a name rather than a description — naming the property, what it is and the
// town it is in is the most that can be said truthfully, and it is what guests
// search for.
export default function PhotoGallery({
    images,
    title,
    area,
}: {
    images: string[];
    title: string;
    area?: string;
}) {
    const place = (area || '').trim() || 'Dumfries & Galloway';
    const describe = (n: number) =>
        n === 1
            ? `${title}, self-catering accommodation in ${place}`
            : `${title} in ${place} — photo ${n}`;
    const [open, setOpen] = useState(false);
    const [current, setCurrent] = useState(0);   // mobile carousel index, for the counter

    // Stop the page behind scrolling while the overlay is up, and let Escape close it.
    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = previous;
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (!images || images.length === 0) {
        return (
            <div className="rounded-2xl w-full h-[300px] md:h-[460px] bg-slate-100 flex items-center justify-center text-slate-400 my-4">
                No photos yet
            </div>
        );
    }

    const n = images.length;
    const hero = images[0];
    // How many small photos sit beside the hero on desktop: 5+ → four, 3–4 → two,
    // 2 → one. The rest are only reachable through "Show all".
    const sideCount = n >= 5 ? 4 : n >= 3 ? 2 : n === 2 ? 1 : 0;
    const side = images.slice(1, 1 + sideCount);
    // The grid, chosen so the hero is never one of several equal cells:
    //   2   → 3 cols, 1 row  (hero spans 2 = two-thirds, one photo the last third)
    //   3–4 → 3 cols, 2 rows (hero spans 2×2, two stacked in the last column)
    //   5+  → 4 cols, 2 rows (hero spans 2×2, four in the right half)
    const desktopGrid = n === 2 ? 'md:grid-cols-3 md:grid-rows-1'
        : n <= 4 ? 'md:grid-cols-3 md:grid-rows-2'
        : 'md:grid-cols-4 md:grid-rows-2';
    const heroSpan = n === 2 ? 'md:col-span-2' : 'md:col-span-2 md:row-span-2';

    return (
        <>
            <div className="relative my-4">
                {/* MOBILE — one photo at a time, full bleed, with a counter. Tapping
                    a photo opens the full gallery. Same on every page. */}
                <div className="md:hidden relative -mx-4">
                    <div
                        onScroll={(e) => setCurrent(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
                        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                        {images.map((img, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => setOpen(true)}
                                className="relative h-[300px] w-screen flex-none snap-center"
                            >
                                <Image
                                    src={getImageUrl(img)}
                                    alt={describe(i + 1)}
                                    fill
                                    priority={i === 0}
                                    sizes="100vw"
                                    className="object-cover"
                                />
                            </button>
                        ))}
                    </div>
                    {n > 1 && (
                        <div className="pointer-events-none absolute right-6 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white tabular-nums">
                            {current + 1} / {n}
                        </div>
                    )}
                </div>

                {/* DESKTOP — the mosaic (hidden below md). One photo runs full width
                    at the normal height; everything else is the hero + its side. */}
                {n === 1 ? (
                    <div className="hidden md:block relative w-full h-[460px]">
                        <Image
                            src={getImageUrl(hero)}
                            alt={describe(1)}
                            fill
                            priority
                            sizes="(max-width: 1024px) 100vw, 1216px"
                            className="object-cover rounded-2xl"
                        />
                    </div>
                ) : (
                    <div className={`hidden md:grid ${desktopGrid} gap-2 h-[460px] rounded-2xl overflow-hidden`}>
                        <button
                            type="button"
                            onClick={() => setOpen(true)}
                            className={`${heroSpan} relative group h-full w-full`}
                        >
                            <Image
                                src={getImageUrl(hero)}
                                alt={describe(1)}
                                fill
                                priority
                                sizes="(max-width: 768px) 100vw, 608px"
                                className="object-cover"
                            />
                            <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                        </button>

                        {side.map((img, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => setOpen(true)}
                                className="relative group h-full w-full"
                            >
                                <Image
                                    src={getImageUrl(img)}
                                    alt={describe(i + 2)}
                                    fill
                                    sizes="(max-width: 768px) 1px, 304px"
                                    className="object-cover"
                                />
                                <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                            </button>
                        ))}
                    </div>
                )}

                {/* Show all — desktop only; on mobile a tap on the photo opens it. */}
                {n > 1 && (
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className="hidden md:flex absolute bottom-4 right-4 min-h-[44px] bg-white hover:bg-slate-50 border border-slate-900/10 shadow-sm rounded-lg px-4 py-2 text-sm font-semibold text-slate-900 items-center gap-2"
                    >
                        <span className="grid grid-cols-3 gap-[2px]">
                            {Array.from({ length: 9 }).map((_, i) => (
                                <span key={i} className="w-[3px] h-[3px] bg-slate-900 rounded-[1px]" />
                            ))}
                        </span>
                        Show all {n} photos
                    </button>
                )}
            </div>

            {open && (
                <div className="fixed inset-0 z-[60] bg-white overflow-y-auto">
                    <div className="sticky top-0 bg-white/95 backdrop-blur border-b px-4 md:px-8 py-4 flex items-center justify-between">
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="text-sm font-semibold text-slate-900 hover:underline"
                        >
                            &larr; Back to listing
                        </button>
                        <span className="text-sm text-slate-500">
                            {n} photo{n === 1 ? '' : 's'}
                        </span>
                    </div>

                    <div className="max-w-3xl mx-auto px-4 md:px-0 py-6 space-y-4">
                        {images.map((img, i) => (
                            <Image
                                key={i}
                                src={getImageUrl(img)}
                                alt={describe(i + 1)}
                                width={1536}
                                height={1024}
                                sizes="(max-width: 768px) 100vw, 768px"
                                className="w-full h-auto rounded-xl"
                            />
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
