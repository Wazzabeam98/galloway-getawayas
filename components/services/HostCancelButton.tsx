'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

// A host calling off a job they'd had a tradesman accept — guests cancelled,
// or the work's no longer needed. The tradesman is told (plainly; his day's
// just freed). A reason is offered but not required of the host.
export default function HostCancelButton({ enquiryId, onDone }: { enquiryId: string; onDone: () => void }) {
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function cancel() {
        setBusy(true); setError('');
        try {
            const res = await fetch('/api/services/enquiries/cancel', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enquiryId, reason }),
            });
            const d = await res.json();
            if (!res.ok || !d.ok) { setError(d.error || 'Could not cancel.'); setBusy(false); return; }
            onDone();
        } catch { setError('Could not cancel.'); setBusy(false); }
    }

    if (!open) {
        return (
            <button onClick={() => setOpen(true)} className="text-sm text-rose-700 underline hover:text-rose-800">
                Cancel this job
            </button>
        );
    }

    return (
        <div className="w-full rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="text-[13px] font-semibold text-slate-800 mb-1.5">Cancel this job</div>
            <textarea
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Optional — a line for the tradesman (e.g. guests cancelled)."
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm min-h-[56px]"
            />
            <div className="mt-2 flex items-center gap-2">
                <button onClick={cancel} disabled={busy} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-60 rounded-lg px-3 py-1.5">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Cancel the job
                </button>
                <button onClick={() => setOpen(false)} className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-800 px-2 py-1.5">Keep it</button>
            </div>
            {error && <div className="mt-1.5 text-[11.5px] text-rose-700">{error}</div>}
        </div>
    );
}
