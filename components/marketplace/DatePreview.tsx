'use client';

import { useMemo } from 'react';
import { optionAvailability, seatConfig } from '@/lib/serviceSlots';
import { unitMultiplies } from '@/lib/serviceOrders';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { dayHeadingLabel } from '@/components/marketplace/present';

export interface PreviewItem { id: string; name: string; price: number; unit: string; capacity?: number | null; minPeople?: number | null; }
export interface PreviewOpen { date: string; time: string; row: { capacity: number; seats_taken: number; private: boolean } | null; }
export interface PreviewDeclared { id: string; date: string; time: string; duration: number; capacity: number; seats_taken: number; private: boolean; title: string | null; }

// The next few available DATES, shown IN the panel — Airbnb's shape: a stack of
// rounded cards, one per day (the day on the left, how many times that day on the
// right) under the price and "Show dates" button. A guest sees there's
// availability without clicking; tapping a day opens the full dialog on that day's
// times (an hourly provider would otherwise flood the panel with a card per slot).

const toMin = (t: string) => { const [h, m] = t.split(':'); return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0); };
const hhmm = (min: number) => { const m = ((min % 1440) + 1440) % 1440; const h12 = m % 720 === 0 ? 12 : Math.floor((m % 720) / 60) || 12; const ap = m < 720 ? 'am' : 'pm'; const mm = m % 60; return h12 + (mm ? ':' + String(mm).padStart(2, '0') : '') + ap; };
const timeRange = (time: string, duration: number | null) => {
    const start = toMin(time.slice(0, 5));
    return !duration || duration <= 0 ? hhmm(start) : hhmm(start) + '–' + hhmm(start + duration);
};

export default function DatePreview({
    items, sessions, declaredSessions, providerCapacity, providerMinPeople, slotLength, limit = 4, busy, onPickDay, onShowAll,
}: {
    items: PreviewItem[];
    sessions: PreviewOpen[];
    declaredSessions: PreviewDeclared[];
    providerCapacity: number;
    providerMinPeople: number;
    slotLength?: number;
    limit?: number;
    busy: boolean;
    onPickDay: (date: string) => void;
    onShowAll: () => void;
}) {
    const today = londonDayKey();
    const tomorrow = shiftDayKey(today, 1);

    // The default option availability is read against: the cheapest per-person
    // item, else the cheapest. The full dialog is where a guest picks a different
    // option or party.
    const item = useMemo(() => {
        const priced = items.filter((i) => i.price > 0);
        const perPersonItems = priced.filter((i) => unitMultiplies(i.unit));
        const pool = perPersonItems.length ? perPersonItems : priced;
        return pool.length ? pool.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    }, [items]);
    const perPerson = !!item && unitMultiplies(item.unit);
    const minQ = item && perPerson ? Math.max(1, Number(item.minPeople ?? providerMinPeople) || 1) : 1;

    const offerings = useMemo(() => {
        const open = sessions.map((s) => ({ date: s.date, time: s.time, kind: 'open' as const, title: null as string | null, duration: slotLength || null, row: s.row }));
        const dec = declaredSessions.map((d) => ({ date: d.date, time: d.time, kind: 'declared' as const, title: d.title, duration: d.duration, row: { capacity: d.capacity, seats_taken: d.seats_taken, private: d.private } }));
        return [...open, ...dec].sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
    }, [sessions, declaredSessions, slotLength]);

    const availOf = (o: { kind: 'open' | 'declared'; row: { capacity: number; seats_taken: number; private: boolean } | null }) => {
        if (!item) return { possible: false, seatsLeft: 0 };
        const pool = o.kind === 'declared'
            ? { slot_capacity: o.row ? o.row.capacity : 0, slot_min_people: providerMinPeople }
            : seatConfig(item.capacity ?? null, item.minPeople ?? null, { slot_capacity: providerCapacity, slot_min_people: providerMinPeople });
        return optionAvailability(o.row, item.unit, pool);
    };

    // One entry per day, in date order, keeping only days with a bookable time —
    // and only the first `limit` of them (a "Show all dates" link opens the rest).
    // The card shows how many TIMES a day holds (not a headcount): "56 spots" for a
    // seven-seat sauna over eight hours reads as a 56-person room, which it isn't.
    const days = useMemo(() => {
        const byDate = new Map<string, { date: string; times: typeof offerings; declaredTitle: string | null }>();
        for (const o of offerings) {
            const a = availOf(o);
            if (!a.possible || minQ > a.seatsLeft) continue;
            const g = byDate.get(o.date) || { date: o.date, times: [] as typeof offerings, declaredTitle: null as string | null };
            g.times.push(o);
            if (o.kind === 'declared' && o.title && !g.declaredTitle) g.declaredTitle = o.title;
            byDate.set(o.date, g);
        }
        return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, limit);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [offerings, item, minQ, limit]);

    if (!item || !days.length) return null;

    return (
        <div className="mt-4 space-y-2">
            {days.map((d) => {
                const declared = !!d.declaredTitle;
                const first = d.times[0];
                const n = d.times.length;
                // A time hint under the date (never a count — the count read twice):
                // a declared session's name, one plain time, or the earliest of many.
                const hint = declared && d.declaredTitle
                    ? d.declaredTitle
                    : n === 1
                        ? timeRange(first.time, first.duration)
                        : 'from ' + timeRange(first.time, first.duration).split('–')[0];
                return (
                    <button key={d.date} type="button" disabled={busy} onClick={() => onPickDay(d.date)}
                        className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition disabled:opacity-60 ${declared ? 'border-violet-200 hover:border-violet-400' : 'border-slate-200 hover:border-slate-400'}`}>
                        <span className="min-w-0">
                            <span className="block whitespace-nowrap text-[15px] font-semibold text-slate-900">{dayHeadingLabel(d.date, today, tomorrow)}</span>
                            <span className={`mt-0.5 block truncate text-sm ${declared ? 'text-violet-700' : 'text-slate-500'}`}>{hint}</span>
                        </span>
                        <span className={`flex-none whitespace-nowrap text-right text-xs font-semibold ${declared ? 'text-violet-700' : 'text-emerald-700'}`}>
                            {n} time{n === 1 ? '' : 's'}
                        </span>
                    </button>
                );
            })}
            <button type="button" onClick={onShowAll} className="block w-full pt-1 text-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline">
                Show all dates
            </button>
        </div>
    );
}
