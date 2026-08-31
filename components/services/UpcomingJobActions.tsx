'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, XCircle, Loader2 } from 'lucide-react';

// Amend or cancel an accepted job, from the tradesman's Upcoming work.
//
// Amend moves the day (still "asked for", never a slot). Cancel needs a reason
// — the host is told it, and decides differently between "can't make it" and
// "off sick". Both alert the host; cancel is terminal.
export default function UpcomingJobActions({
    enquiryId, preferredDate,
}: { enquiryId: string; preferredDate: string | null }) {
    const router = useRouter();
    const [open, setOpen] = useState<'none' | 'amend' | 'cancel'>('none');
    const [date, setDate] = useState(preferredDate || '');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function amend() {
        if (!date) { setError('Pick a new day.'); return; }
        setBusy(true); setError('');
        try {
            const res = await fetch('/api/services/enquiries/amend', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enquiryId, preferred_date: date }),
            });
            const d = await res.json();
            if (!res.ok || !d.ok) { setError(d.error || 'Could not change the date.'); setBusy(false); return; }
            router.refresh();
        } catch { setError('Could not change the date.'); setBusy(false); }
    }

    async function cancel() {
        if (!reason.trim()) { setError('Please give the host a reason.'); return; }
        setBusy(true); setError('');
        try {
            const res = await fetch('/api/services/enquiries/cancel', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enquiryId, reason }),
            });
            const d = await res.json();
            if (!res.ok || !d.ok) { setError(d.error || 'Could not cancel.'); setBusy(false); return; }
            router.refresh();
        } catch { setError('Could not cancel.'); setBusy(false); }
    }

    if (open === 'none') {
        return (
            <div className="mt-2.5 flex items-center gap-3">
                <button onClick={() => { setOpen('amend'); setError(''); }} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-600 hover:text-slate-900">
                    <CalendarClock className="w-3.5 h-3.5" /> Change the day
                </button>
                <button onClick={() => { setOpen('cancel'); setError(''); }} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-rose-700 hover:text-rose-800">
                    <XCircle className="w-3.5 h-3.5" /> Cancel
                </button>
            </div>
        );
    }

    return (
        <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            {open === 'amend' ? (
                <>
                    <div className="text-[13px] font-semibold text-slate-800 mb-1.5">Move this job to a new day</div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
                        <button onClick={amend} disabled={busy} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg px-3 py-1.5">
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save new day
                        </button>
                        <button onClick={() => setOpen('none')} className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-800 px-2 py-1.5">Back</button>
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-slate-400">The host is told the new day. It stays a day you’ve asked for, not a booking.</p>
                </>
            ) : (
                <>
                    <div className="text-[13px] font-semibold text-slate-800 mb-1.5">Cancel this job</div>
                    <textarea
                        value={reason} onChange={(e) => setReason(e.target.value)}
                        placeholder="Why? e.g. off sick, or double-booked that day. The host sees this."
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm min-h-[64px]"
                    />
                    <div className="mt-2 flex items-center gap-2">
                        <button onClick={cancel} disabled={busy} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-60 rounded-lg px-3 py-1.5">
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Cancel the job
                        </button>
                        <button onClick={() => setOpen('none')} className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-800 px-2 py-1.5">Keep it</button>
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-amber-700">The host is told straight away — and urgently if it’s within a week.</p>
                </>
            )}
            {error && <div className="mt-1.5 text-[11.5px] text-rose-700">{error}</div>}
        </div>
    );
}
