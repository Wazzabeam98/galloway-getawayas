'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { RotateCcw, Loader2 } from 'lucide-react';

// Re-ask the same tradesman after a cancel — a fresh enquiry, pre-filled from
// the old one so the host only picks a new day. The cancelled row stays
// finished; this makes a brand new one (its own token, its own accept).
//
// The suggested day is the cottage's next changeover — the check-out when it
// next stands empty and the work is actually due — but only for planned work.
// An emergency needs doing now, not at a turnover, so there it suggests nothing.
export type ReaskSource = {
    provider_id: string;
    listing_id: string | null;
    business_name: string;
    trade: string;
    urgency: string | null;
    summary: string;
    fault_keys: string[] | null;
    host_name: string | null;
    host_phone: string | null;
    window_from: string | null;
    window_to: string | null;
};

export default function ReaskButton({ source, onDone }: { source: ReaskSource; onDone: () => void }) {
    const supabase = createClientComponentClient();
    const [open, setOpen] = useState(false);
    const [date, setDate] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);

    async function openPanel() {
        setOpen(true); setError('');
        // Suggest the next changeover, for planned work only.
        if (source.listing_id && source.urgency === 'planned') {
            const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
            const { data } = await supabase
                .from('bookings')
                .select('check_out')
                .eq('listing_id', source.listing_id)
                .in('status', ['confirmed', 'pending'])
                .gte('check_out', today)
                .order('check_out', { ascending: true })
                .limit(1);
            if (data && data[0] && data[0].check_out) setDate(String(data[0].check_out));
        }
    }

    async function send() {
        if (!date) { setError('Pick a day.'); return; }
        setBusy(true); setError('');
        try {
            const res = await fetch('/api/services/enquiries', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider_id: source.provider_id,
                    listing_id: source.listing_id,
                    trade: source.trade,
                    urgency: source.urgency || 'planned',
                    summary: note.trim() || source.summary,
                    fault_keys: source.fault_keys || [],
                    host_name: source.host_name || '',
                    host_phone: source.host_phone || '',
                    preferred_date: date,
                    window_from: source.window_from,
                    window_to: source.window_to,
                }),
            });
            const d = await res.json();
            if (!res.ok || !d.ok) {
                setError(d.error || (d.problems && d.problems[0]) || 'Could not send that.');
                setBusy(false);
                return;
            }
            setSent(true);
            setTimeout(onDone, 900);
        } catch { setError('Could not send that.'); setBusy(false); }
    }

    if (sent) {
        return <span className="text-sm font-semibold text-emerald-700">Sent — {source.business_name} has a fresh request.</span>;
    }

    if (!open) {
        return (
            <button onClick={openPanel} className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
                <RotateCcw className="w-4 h-4" /> Re-ask {source.business_name}
            </button>
        );
    }

    return (
        <div className="w-full rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="text-[13px] font-semibold text-slate-800">Re-ask {source.business_name}</div>
            <p className="text-[12.5px] text-slate-500 mt-0.5 italic">“{source.summary}”</p>
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                <label className="text-[12.5px] font-semibold text-slate-600">New day</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
                <button onClick={send} disabled={busy} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg px-3 py-1.5">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Send request
                </button>
                <button onClick={() => setOpen(false)} className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-800 px-2 py-1.5">Back</button>
            </div>
            {source.urgency === 'planned' && date && (
                <p className="mt-1.5 text-[11.5px] text-slate-400">Suggested: the cottage’s next changeover. Change it if you need it sooner.</p>
            )}
            {error && <div className="mt-1.5 text-[11.5px] text-rose-700">{error}</div>}
        </div>
    );
}
