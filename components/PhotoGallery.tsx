"use client"

import React, { useState, useEffect } from 'react';
import { getImageUrl } from '@/lib/utils';

// Airbnb-style photo mosaic: one large image on the left, four smaller
// ones filling a 2x2 block on the right, and a button to open the rest.
export default function PhotoGallery({
    images,
    title,
}: {
    images: string[];
    title: string;
}) {
    const [open, setOpen] = useState(false);

    // Stop the page behind scrolling while the overlay is up, and let
    // Escape close it.
    useEffect(() => {
        if (!open) return;

        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
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

    const hero = images[0];
    const side = images.slice(1, 5);

    return (
        <>
            <div className="relative my-4">
                {/* One photo only — let it run full width */}
                {images.length === 1 ? (
                    <img
                        src={getImageUrl(hero)}
                        alt={title}
                        className="w-full h-[300px] md:h-[460px] object-cover rounded-2xl"
                    />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-2 h-[300px] md:h-[460px] rounded-2xl overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setOpen(true)}
                            className="md:col-span-2 md:row-span-2 relative group h-full w-full"
                        >
                            <img
                                src={getImageUrl(hero)}
                                alt={title}
                                className="w-full h-full object-cover"
                            />
                            <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                        </button>

                        {side.map((img, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => setOpen(true)}
                                className="hidden md:block relative group h-full w-full"
                            >
                                <img
                                    src={getImageUrl(img)}
                                    alt={`${title} — photo ${i + 2}`}
                                    className="w-full h-full object-cover"
                                />
                                <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                            </button>
                        ))}

                        {/* Fill any empty cells so the grid never looks broken
                            when a host has uploaded fewer than five photos */}
                        {Array.from({ length: Math.max(0, 4 - side.length) }).map((_, i) => (
                            <div key={`blank-${i}`} className="hidden md:block bg-slate-100" />
                        ))}
                    </div>
                )}

                {images.length > 1 && (
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className="absolute bottom-4 right-4 bg-white hover:bg-slate-50 border border-slate-900/10 shadow-sm rounded-lg px-4 py-2 text-sm font-semibold text-slate-900 flex items-center gap-2"
                    >
                        <span className="grid grid-cols-3 gap-[2px]">
                            {Array.from({ length: 9 }).map((_, i) => (
                                <span key={i} className="w-[3px] h-[3px] bg-slate-900 rounded-[1px]" />
                            ))}
                        </span>
                        Show all photos
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
                            {images.length} photo{images.length === 1 ? '' : 's'}
                        </span>
                    </div>

                    <div className="max-w-3xl mx-auto px-4 md:px-0 py-6 space-y-4">
                        {images.map((img, i) => (
                            <img
                                key={i}
                                src={getImageUrl(img)}
                                alt={`${title} — photo ${i + 1}`}
                                className="w-full rounded-xl"
                            />
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
