'use client';

import { useState } from 'react';
import { Check, X, CalendarClock, Loader2 } from 'lucide-react';

// A tradesman has asked to move an accepted job to a different day. The host
// decides — same shape as accepting the enquiry in the first place. Yes moves
// the day; No keeps the one they asked for. Nothing changed until this.
export default function DateChangeRequest({
    enquiryId, proposedDate, currentDate, onDone,
}: { enquiryId: string; proposedDate: string; currentDate: string | null; onDone: () => void }) {
    const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
    const [error, setError] = useState('');

    function pretty(d: string | null) {
        if (!d) return '';
        const dt = new Date(d + 'T12:00:00Z');
        return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
    }

    async function respond(reply: 'yes' | 'no') {
        setBusy(reply); setError('');
        try {
            const res = await fetch('/api/services/enquiries/respond-date', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enquiryId, reply }),
            });
            const d = await res.json();
            if (!res.ok || !d.ok) { setError(d.error || 'Could not save that.'); setBusy(null); return; }
            onDone();
        } catch { setError('Could not save that.'); setBusy(null); }
    }

    return (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <div className="flex items-start gap-2">
                <CalendarClock className="w-4 h-4 text-amber-700 flex-none mt-0.5" strokeWidth={2} />
                <div className="text-sm text-amber-900">
                    They’ve asked to move this to <b>{pretty(proposedDate)}</b>
                    {currentDate ? <> — you asked for {pretty(currentDate)}.</> : '.'}
                    <span className="block text-[13px] text-amber-800/90 mt-0.5">You know if a guest is in that day. Nothing moves unless you agree.</span>
                </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
                <button onClick={() => respond('yes')} disabled={busy !== null} className="inline-flex items-center gap-1 text-[13px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg px-3 py-1.5">
                    {busy === 'yes' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" strokeWidth={2.5} />} Move it to {pretty(proposedDate).replace(/,.*$/, '')}
                </button>
                <button onClick={() => respond('no')} disabled={busy !== null} className="inline-flex items-center gap-1 text-[13px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg px-3 py-1.5">
                    {busy === 'no' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" strokeWidth={2.5} />} Keep the original
                </button>
            </div>
            {error && <div className="mt-1.5 text-[11.5px] text-rose-700">{error}</div>}
        </div>
    );
}
