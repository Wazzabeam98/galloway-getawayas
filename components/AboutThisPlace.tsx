'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronRight } from 'lucide-react';

// "About this place" the way Airbnb shows it: a few lines near the top, with a
// "Show more" that opens the full description in a dialog rather than expanding
// the page. Short descriptions show in full with no control.
const CLAMP_ABOVE = 280;

export default function AboutThisPlace({ text }: { text: string }) {
    const clean = (text || '').trim();
    const [open, setOpen] = useState(false);
    const worthClamping = clean.length > CLAMP_ABOVE;

    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (!clean) return null;

    return (
        <div className="mt-8 pt-8 lg:mt-5 lg:pt-0 border-t lg:border-t-0">
            <h2 className="font-semibold text-2xl text-slate-900">About this place</h2>
            <p className={`mt-3 whitespace-pre-line text-slate-700 ${worthClamping && !open ? 'line-clamp-4' : ''}`}>
                {clean}
            </p>

            {worthClamping && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="mt-3 inline-flex items-center gap-1 font-semibold text-slate-900 underline underline-offset-4"
                >
                    Show more <ChevronRight className="h-4 w-4" />
                </button>
            )}

            {open && typeof document !== 'undefined' && createPortal(
                <div
                    className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
                    onClick={() => setOpen(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label="About this place"
                >
                    <div
                        className="relative mt-6 w-full max-w-2xl rounded-2xl bg-white shadow-xl sm:mt-12"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="sticky top-0 flex items-center justify-between rounded-t-2xl border-b border-slate-100 bg-white px-6 py-4">
                            <h3 className="text-lg font-semibold text-slate-900">About this place</h3>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                aria-label="Close"
                                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-100"
                            >
                                <X className="h-5 w-5 text-slate-700" />
                            </button>
                        </div>
                        <div className="px-6 pb-6 pt-4">
                            <p className="whitespace-pre-line leading-relaxed text-slate-700">{clean}</p>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
