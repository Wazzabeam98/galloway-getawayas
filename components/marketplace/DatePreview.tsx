'use client';

import { useMemo } from 'react';
import { optionAvailability, seatConfig } from '@/lib/serviceSlots';
import { unitMultiplies } from '@/lib/serviceOrders';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';

export interface PreviewItem { id: string; name: string; price: number; unit: string; capacity?: number | null; minPeople?: number | null; }
export interface PreviewOpen { date: string; time: string; row: { capacity: number; seats_taken: number; private: boolean } | null; }
export interface PreviewDeclared { id: string; date: string; time: string; duration: number; capacity: number; seats_taken: number; private: boolean; title: string | null; }
export interface PreviewPick { date: string; time: string; itemId: string; quantity: number; }

// The next few available dates, shown IN the panel — Airbnb's shape: a stack of
// rounded cards (date + time range on the left, spots on the right) under the
// price and "Show dates" button, with a "Show all dates" link that opens the full
// dialog. A guest sees there's availability without clicking; tapping a card books
// that slot (the cheapest option, one place) straight to Stripe Checkout.

function dayLabel(date: string): string {
    const today = londonDayKey();
    const d = new Date(date + 'T00:00:00Z');
    // Compact so it never truncates in the narrow panel: "Today, 18 Sep",
    // "Tomorrow, 19 Sep", else "Mon, 21 Sep".
    const full = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    if (date === today) return 'Today, ' + full;
    if (date === shiftDayKey(today, 1)) return 'Tomorrow, ' + full;
    return d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) + ', ' + full;
}
const toMin = (t: string) => { const [h, m] = t.split(':'); return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0); };
const hhmm = (min: number) => { const m = ((min % 1440) + 1440) % 1440; const h12 = m % 720 === 0 ? 12 : Math.floor((m % 720) / 60) || 12; const ap = m < 720 ? 'am' : 'pm'; const mm = m % 60; return h12 + (mm ? ':' + String(mm).padStart(2, '0') : '') + ap; };
const timeRange = (time: string, duration: number | null) => {
    const start = toMin(time.slice(0, 5));
    return !duration || duration <= 0 ? hhmm(start) : hhmm(start) + '–' + hhmm(start + duration);
};

export default function DatePreview({
    items, sessions, declaredSessions, providerCapacity, providerMinPeople, slotLength, limit = 4, busy, onPick, onShowAll,
}: {
    items: PreviewItem[];
    sessions: PreviewOpen[];
    declaredSessions: PreviewDeclared[];
    providerCapacity: number;
    providerMinPeople: number;
    slotLength?: number;
    limit?: number;
    busy: boolean;
    onPick: (p: PreviewPick) => void;
    onShowAll: () => void;
}) {
    // The default option for a one-tap book: the cheapest per-person item, else the
    // cheapest. The full dialog is where a guest picks a different option or party.
    const item = useMemo(() => {
        const priced = items.filter((i) => i.price > 0);
        const pp = priced.filter((i) => unitMultiplies(i.unit));
        const pool = pp.length ? pp : priced;
        return pool.length ? pool.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    }, [items]);
    const perPerson = !!item && unitMultiplies(item.unit);
    const minQ = item && perPerson ? Math.max(1, Number(item.minPeople ?? providerMinPeople) || 1) : 1;

    const offerings = useMemo(() => {
        const open = sessions.map((s) => ({ key: 'o:' + s.date + ' ' + s.time, date: s.date, time: s.time, kind: 'open' as const, title: null as string | null, duration: slotLength || null, row: s.row }));
        const dec = declaredSessions.map((d) => ({ key: 'd:' + d.id, date: d.date, time: d.time, kind: 'declared' as const, title: d.title, duration: d.duration, row: { capacity: d.capacity, seats_taken: d.seats_taken, private: d.private } }));
        return [...open, ...dec].sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
    }, [sessions, declaredSessions, slotLength]);

    const availOf = (o: { kind: 'open' | 'declared'; row: { capacity: number; seats_taken: number; private: boolean } | null }) => {
        if (!item) return { possible: false, seatsLeft: 0 };
        const pool = o.kind === 'declared'
            ? { slot_capacity: o.row ? o.row.capacity : 0, slot_min_people: providerMinPeople }
            : seatConfig(item.capacity ?? null, item.minPeople ?? null, { slot_capacity: providerCapacity, slot_min_people: providerMinPeople });
        return optionAvailability(o.row, item.unit, pool);
    };

    const cards = useMemo(() => offerings.map((o) => ({ o, a: availOf(o) })).filter((x) => x.a.possible && minQ <= x.a.seatsLeft).slice(0, limit),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [offerings, item, minQ, limit]);

    if (!item || !cards.length) return null;

    return (
        <div className="mt-4 space-y-2">
            {cards.map(({ o, a }) => {
                const declared = o.kind === 'declared';
                return (
                    <button key={o.key} type="button" disabled={busy} onClick={() => onPick({ date: o.date, time: o.time, itemId: item.id, quantity: minQ })}
                        className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition disabled:opacity-60 ${declared ? 'border-violet-200 hover:border-violet-400' : 'border-slate-200 hover:border-slate-400'}`}>
                        <span className="min-w-0">
                            <span className="block whitespace-nowrap text-[15px] font-semibold text-slate-900">{dayLabel(o.date)}</span>
                            <span className="mt-0.5 block truncate text-sm text-slate-500">
                                {declared && o.title ? <><span className="font-medium text-violet-700">{o.title}</span>{' · '}</> : null}
                                {timeRange(o.time, o.duration)}
                            </span>
                        </span>
                        <span className="flex-none whitespace-nowrap text-right text-xs font-semibold text-slate-700">
                            {perPerson ? `${a.seatsLeft} spot${a.seatsLeft === 1 ? '' : 's'} available` : 'Available'}
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
