'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// A two-month calendar pop-up for picking new stay dates on a change. Nights
// that are taken (other bookings, blocked days, synced calendars) are struck
// through and can't be picked; the booking's OWN nights stay selectable, since
// the guest already holds them. Pick a check-in, then a check-out, then Save.
function key(d: Date): string {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fromKey(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "2026-09-24" → "Thu 24 Sep"
function fmtDay(s: string): string {
    if (!s) return '';
    const d = new Date(s + 'T12:00:00');
    return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ChangeCalendar({
    listingId, ownCheckIn, ownCheckOut, checkIn, checkOut, onSave, onClose,
}: {
    listingId: string;
    ownCheckIn: string;   // this booking's current nights are always selectable
    ownCheckOut: string;
    checkIn: string;
    checkOut: string;
    onSave: (checkIn: string, checkOut: string) => void;
    onClose: () => void;
}) {
    const supabase = createClientComponentClient();
    const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
    const [ci, setCi] = useState<string>(checkIn);
    const [co, setCo] = useState<string>(checkOut);
    const [month, setMonth] = useState<Date>(fromKey(checkIn.slice(0, 8) + '01'));

    // The booking's own nights, which stay pickable.
    const ownNights = useMemo(() => {
        const s = new Set<string>();
        let d = fromKey(ownCheckIn); const end = fromKey(ownCheckOut);
        while (d < end) { s.add(key(d)); d = addDays(d, 1); }
        return s;
    }, [ownCheckIn, ownCheckOut]);

    useEffect(() => {
        let live = true;
        (async () => {
            const blocked = new Set<string>();
            const addRange = (a: string, b: string) => { let d = new Date(a); const e = new Date(b); while (d < e) { blocked.add(key(d)); d = addDays(d, 1); } };
            const { data: busy } = await supabase.from('listing_busy_nights').select('check_in, check_out').eq('listing_id', listingId).in('status', ['pending', 'confirmed']);
            (busy || []).forEach((b: any) => addRange(b.check_in, b.check_out));
            const { data: ov } = await supabase.from('calendar_overrides').select('date, is_blocked').eq('listing_id', listingId);
            (ov || []).forEach((o: any) => { if (o.is_blocked) blocked.add(String(o.date).slice(0, 10)); });
            try {
                const res = await fetch('/api/ical-import?listing=' + encodeURIComponent(listingId));
                if (res.ok) { const data = await res.json(); (data.events || []).forEach((ev: any) => addRange(ev.start, ev.end)); }
            } catch { /* an unreachable feed just doesn't block */ }
            // The guest already holds their own nights — never strike those out.
            ownNights.forEach((k) => blocked.delete(k));
            if (live) setUnavailable(blocked);
        })();
        return () => { live = false; };
    }, [supabase, listingId, ownNights]);

    const todayKey = key(new Date());
    const isBlocked = (k: string) => unavailable.has(k);

    const pick = (k: string) => {
        if (k < todayKey && !ownNights.has(k)) return;   // no past nights (except your own)
        if (isBlocked(k)) return;
        if (!ci || (ci && co) || k < ci) { setCi(k); setCo(''); return; }
        if (k === ci) return;
        // Refuse a range that jumps a blocked night.
        let d = fromKey(ci); let ok = true;
        while (key(d) < k) { if (isBlocked(key(d)) && !ownNights.has(key(d))) { ok = false; break; } d = addDays(d, 1); }
        if (!ok) { setCi(k); setCo(''); return; }
        setCo(k);
    };

    const inRange = (k: string) => ci && co && k >= ci && k < co;

    const renderMonth = (base: Date) => {
        const y = base.getFullYear(); const m = base.getMonth();
        const first = new Date(y, m, 1);
        const startPad = (first.getDay() + 6) % 7; // Monday-first
        const days = new Date(y, m + 1, 0).getDate();
        const cells: (string | null)[] = [];
        for (let i = 0; i < startPad; i++) cells.push(null);
        for (let d = 1; d <= days; d++) cells.push(key(new Date(y, m, d)));
        return (
            <div className="min-w-0">
                <div className="mb-2 text-center text-sm font-semibold text-slate-900">{MONTHS[m]} {y}</div>
                <div className="grid grid-cols-7 text-center text-[11px] text-slate-400">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="py-1">{d}</div>)}
                </div>
                <div className="mt-1 grid grid-cols-7">
                    {cells.map((k, i) => {
                        if (!k) return <div key={i} className="h-10" />;
                        const past = k < todayKey && !ownNights.has(k);
                        const blocked = isBlocked(k) || past;
                        const selected = k === ci || k === co;
                        const isStart = !!co && k === ci;   // left edge of a chosen range
                        const isEnd = !!co && k === co;      // right edge
                        const mid = inRange(k) && !selected; // strictly between the endpoints
                        return (
                            <div key={i} className="relative flex h-10 items-center justify-center">
                                {/* one continuous shaded band under the between-nights, joined to each circle */}
                                {(mid || isStart || isEnd) && (
                                    <span aria-hidden className={
                                        'absolute inset-y-1 bg-emerald-50 '
                                        + (mid ? 'left-0 right-0 ' : isStart ? 'left-1/2 right-0 ' : 'left-0 right-1/2 ')
                                    } />
                                )}
                                <button type="button" disabled={blocked} onClick={() => pick(k)}
                                    className={
                                        'relative z-10 grid h-9 w-9 place-items-center rounded-full text-[13px] '
                                        + (selected ? 'bg-emerald-700 font-semibold text-white '
                                            : mid ? 'text-emerald-900 '
                                                : blocked ? 'text-slate-300 line-through cursor-not-allowed '
                                                    : 'text-slate-800 hover:bg-slate-100 ')
                                    }>
                                    {Number(k.slice(-2))}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
                <button type="button" onClick={() => setMonth(addMonths(month, -1))} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
                <span className="text-[12px] text-slate-500">Pick your new dates</span>
                <button type="button" onClick={() => setMonth(addMonths(month, 1))} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
            </div>
            {/* Two equal-width months side by side; a single month on mobile, paged by the arrows above. */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {renderMonth(month)}
                <div className="hidden sm:block">{renderMonth(addMonths(month, 1))}</div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[12px] text-slate-500">{ci ? (co ? fmtDay(ci) + ' → ' + fmtDay(co) : fmtDay(ci) + ' → …') : 'Select check-in'}</span>
                <div className="flex gap-2">
                    <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-3 py-2 text-[13px] font-semibold text-slate-700">Cancel</button>
                    <button type="button" disabled={!ci || !co} onClick={() => onSave(ci, co)} className="rounded-xl bg-emerald-700 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">Save</button>
                </div>
            </div>
        </div>
    );
}
