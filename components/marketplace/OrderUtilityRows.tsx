'use client';

import { useState } from 'react';
import { Copy, Check, Printer, ChevronRight } from 'lucide-react';

// The two rows on the order page that are browser actions rather than links —
// copying the address to the clipboard and printing the page. Airbnb's
// reservation screen carries both as quiet chevron rows, and they are the only
// reason this file is a client component; everything else on that page is
// server-rendered.
//
// The row styling is passed in rather than repeated here, so a server-rendered
// link row and these two cannot drift apart.

export function CopyAddressRow({ address, className }: { address: string; className: string }) {
    const [done, setDone] = useState(false);

    return (
        <button
            type="button"
            className={className}
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(address);
                } catch {
                    // Clipboard is refused on an insecure origin and in some
                    // embedded browsers. Say nothing rather than throwing — the
                    // address is on screen directly above, so the guest is not
                    // stuck, and a red error for a convenience action is worse
                    // than the action quietly not happening.
                    return;
                }
                setDone(true);
                setTimeout(() => setDone(false), 2000);
            }}
        >
            <span className="flex items-center gap-3">
                {done ? <Check className="h-4 w-4 flex-none text-emerald-700" /> : <Copy className="h-4 w-4 flex-none text-slate-400" />}
                {done ? 'Address copied' : 'Copy address'}
            </span>
            <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
        </button>
    );
}

export function PrintDetailsRow({ className }: { className: string }) {
    return (
        <button type="button" className={className} onClick={() => window.print()}>
            <span className="flex items-center gap-3">
                <Printer className="h-4 w-4 flex-none text-slate-400" />
                Print details
            </span>
            <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
        </button>
    );
}
