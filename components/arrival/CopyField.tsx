'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// Copy a value to the clipboard — for an address, a door code, a wifi password.
// Standing outside with a car full of bags, you want to paste, not retype.
export default function CopyField({ value, label = 'Copy', block = false }: { value: string; label?: string; block?: boolean }) {
    const [done, setDone] = useState(false);
    // `block` makes it a full-width button that sits as one of a pair beside the
    // Get directions button; the default is the small inline copy affordance.
    const cls = block
        ? 'flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-700 transition hover:border-stone-400'
        : 'inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-400';
    return (
        <button
            type="button"
            onClick={async () => {
                try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
            }}
            className={cls}
        >
            {done ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {done ? 'Copied' : label}
        </button>
    );
}
