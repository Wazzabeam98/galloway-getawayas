'use client';

import { useState } from 'react';

// A long description is most of a phone screen before a guest reaches
// anything else. Two lines here, the whole thing on a laptop where there is
// room for it — so nothing is hidden from a desktop reader who could already
// see it.
const CLAMP_ABOVE = 140;

export default function ShowMoreText({ text }: { text: string }) {
    const [open, setOpen] = useState(false);

    // Short descriptions get no control at all — a "Show more" that reveals
    // half a line is just another thing to read.
    const worthClamping = (text || '').length > CLAMP_ABOVE;

    return (
        <div className="mt-2">
            <div
                className={`whitespace-pre-line ${
                    worthClamping && !open ? 'line-clamp-2 lg:line-clamp-none' : ''
                }`}
            >
                {text}
            </div>

            {worthClamping && (
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="lg:hidden mt-2 text-sm font-semibold text-slate-900 underline underline-offset-4"
                >
                    {open ? 'Show less' : 'Show more'}
                </button>
            )}
        </div>
    );
}
