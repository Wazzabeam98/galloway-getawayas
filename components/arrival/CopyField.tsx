'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// Copy a value to the clipboard — for an address, a door code, a wifi password.
// Standing outside with a car full of bags, you want to paste, not retype.
export default function CopyField({ value, label = 'Copy', block = false, iconOnly = false }: { value: string; label?: string; block?: boolean; iconOnly?: boolean }) {
    const [done, setDone] = useState(false);
    // Three shapes:
    // - `block`: a full-width button, one of a pair beside Get directions.
    // - `iconOnly`: just the copy icon, for sitting snug against a value (the
    //   what3words row) where a second "Copy" word next to "Copy address" would
    //   read like a mistake. A square 44px tap target — the mobile minimum — with
    //   the label carried by aria-label and title so it stays readable to a
    //   screen reader and a mouse user even with no text on screen.
    // - default: the small inline copy affordance with its label.
    const cls = block
        ? 'flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-700 transition hover:border-stone-400'
        : 'inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-400';
    const onClick = async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
    };
    if (iconOnly) {
        return (
            <button
                type="button"
                onClick={onClick}
                aria-label={done ? 'Copied' : label}
                title={label}
                className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 transition hover:border-stone-400"
            >
                {done ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </button>
        );
    }
    return (
        <button
            type="button"
            onClick={onClick}
            className={cls}
        >
            {done ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {done ? 'Copied' : label}
        </button>
    );
}
