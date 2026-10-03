'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, XCircle, Loader2, Clock } from 'lucide-react';
import { ukDate, londonDayKey, shiftDayKey } from '@/lib/dayKey';
import MonthCalendar from '@/components/marketplace/MonthCalendar';

// Amend or cancel an accepted job, from the tradesman's Upcoming work.
//
// Changing the day is a REQUEST, not a move. The host is the one who knows
// whether a guest is in that day, so the tradesman proposes and the host
// accepts or declines — until they do, the agreed day stands. Cancel needs a
// reason and is terminal; the host is told either way.
export default function UpcomingJobActions({
    enquiryId, preferredDate, proposedDate,
}: { enquiryId: string; preferredDate: string | null; proposedDate: string | null }) {
    const router = useRouter();
    const [open, setOpen] = useState<'none' | 'amend' | 'cancel'>('none');
    const [date, setDate] = useState(preferredDate || '');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    // The in-page month calendar — the same grid guests and providers pick a day
    // on, not a bare browser date field. It opens on the job's own month (a trade
    // asking to move a job wants the days around it) and offers the next six
    // months. Days before today are greyed: you can only ask for a day ahead.
    const today = londonDayKey();
    const jobMonthFirst = preferredDate ? preferredDate.slice(0, 7) + '-01' : today;
    const rangeStart = jobMonthFirst < today ? today : jobMonthFirst;
    const availableDays = useMemo(() => {
        const days = new Set<string>();
        let k = rangeStart;
        for (let i = 0; i < 183; i++) { days.add(k); k = shiftDayKey(k, 1); }
        return days;
    }, [rangeStart]);

    function prettyDate(d: string) {
        // DD/MM/YYYY from the shared formatter — the one date format the UI uses.
        return ukDate(d) || d;
    }

    async function propose() {
        if (!date) { setError('Pick a day to ask for.'); return; }
        setBusy(true); setError('');
        try {
            const res = await fetch('/api/services/enquiries/propose-date', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enquiryId, proposed_date: date }),
            });
            const d = await res.json();
            if (!res.ok || !d.ok) { setError(d.error || 'Could not send that.'); setBusy(false); return; }
            router.refresh();
        } catch { setError('Could not send that.'); setBusy(false); }
    }

    async function withdrawProposal() {
        setBusy(true); setError('');
        try {
            const res = await fetch('/api/services/enquiries/propose-date', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enquiryId, clear: true }),
            });
            const d = await res.json();
            if (!res.ok || !d.ok) { setError(d.error || 'Could not withdraw that.'); setBusy(false); return; }
            router.refresh();
        } catch { setError('Could not withdraw that.'); setBusy(false); }
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

    // A date change is already out with the host, waiting.
    if (proposedDate) {
        return (
            <div className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                <div className="flex items-start gap-2">
                    <Clock className="w-4 h-4 text-amber-700 flex-none mt-0.5" strokeWidth={2} />
                    <div className="text-[13px] text-amber-900">
                        You’ve asked to move this to <b>{prettyDate(proposedDate)}</b> — waiting for the host to agree. The original day stands until they do.
                    </div>
                </div>
                <button onClick={withdrawProposal} disabled={busy} className="mt-2 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-60">
                    {busy ? 'Withdrawing…' : 'Withdraw the request'}
                </button>
                {error && <div className="mt-1.5 text-[11.5px] text-rose-700">{error}</div>}
            </div>
        );
    }

    if (open === 'none') {
        return (
            <div className="mt-2.5 flex items-center gap-3">
                <button onClick={() => { setOpen('amend'); setError(''); }} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-600 hover:text-slate-900">
                    <CalendarClock className="w-3.5 h-3.5" /> Ask to change the day
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
                    <div className="text-[13px] font-semibold text-slate-800 mb-1.5">Ask the host for a different day</div>
                    <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white px-3 pb-2">
                        <MonthCalendar
                            availableDays={availableDays}
                            selected={date || null}
                            onSelect={setDate}
                            emptyLabel="No days to ask for just now."
                        />
                    </div>
                    <p className="mt-2 text-[11.5px] text-slate-500">
                        {date ? <>Asking for <b>{ukDate(date)}</b>. </> : 'Pick a day above. '}
                        The host decides — they know if a guest is in that day. Nothing moves until they agree.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                        <button onClick={propose} disabled={busy || !date} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg px-3 py-1.5">
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Ask for this day
                        </button>
                        <button onClick={() => setOpen('none')} className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-800 px-2 py-1.5">Back</button>
                    </div>
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
