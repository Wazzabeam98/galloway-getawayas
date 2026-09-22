'use client';

import { useState } from 'react';
import { KeyRound, Eye, EyeOff, Check, Copy } from 'lucide-react';

// The door code for a property, on the host's reservation page. The code itself
// is only ever passed to this component by the server AFTER it has checked
// can_listing — a co-host without the listing permission never has it read, so
// the value never reaches their browser (the wall is server-side; this is only
// its presentation). Held behind a Show toggle so it isn't shoulder-surfed off
// an open laptop, with a copy button for the common case.
export default function DoorCode({ code }: { code: string }) {
    const [shown, setShown] = useState(false);
    const [copied, setCopied] = useState(false);

    async function copy() {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard blocked — the code is on screen to read */
        }
    }

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
            <div className="flex items-center gap-2 text-slate-900">
                <KeyRound className="h-4 w-4 flex-none text-slate-400" />
                <span className="text-sm font-semibold">Door code</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
                <span className={`min-w-0 flex-1 font-mono text-2xl tracking-[0.2em] text-slate-900 ${shown ? '' : 'select-none'}`}>
                    {shown ? code : '••••'}
                </span>
                <button
                    type="button"
                    onClick={() => setShown((s) => !s)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                >
                    {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    {shown ? 'Hide' : 'Show'}
                </button>
                {shown && (
                    <button
                        type="button"
                        onClick={copy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                    >
                        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                )}
            </div>
            <p className="mt-2 text-xs text-slate-400">
                Only people you’ve given the listing to can see this. The guest gets it in their check-in message, never here.
            </p>
        </div>
    );
}
