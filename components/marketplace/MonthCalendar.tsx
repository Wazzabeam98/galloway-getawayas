'use client';

import { useMemo } from 'react';
import { monthYearLabel } from '@/components/marketplace/present';

// THE full-month date grid, shared by every experience shape.
//
// A slot experience shows it inside its "Show dates" dialog; a request shape (a
// comes-to-you chef, a made-to-order baker) shows it inline in its booking box.
// One component so the two can never drift into a second calendar — the reason
// the request shapes were on a row of three date chips is exactly the divergence
// this prevents.
//
// It takes the set of bookable days and paints every month they span, greying
// the days that aren't available. The caller owns the scroll (the dialog's own
// scroll area, or the panel's), so the grid stacks its months and the weekday
// header sticks to the top of whichever scroll contains it.

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const pad = (n: number) => String(n).padStart(2, '0');
const mondayIndex = (d: Date) => (d.getUTCDay() + 6) % 7;
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const dayKey = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

export default function MonthCalendar({
    availableDays,
    selected,
    onSelect,
    today,
    emptyLabel = 'No dates available just now.',
}: {
    availableDays: Set<string>;
    selected: string | null;
    onSelect: (dateKey: string) => void;
    today: string;
    emptyLabel?: string;
}) {
    // The months the grid spans — first available day to last.
    const months = useMemo(() => {
        const keys = Array.from(availableDays).sort();
        if (!keys.length) return [] as Array<{ y: number; m0: number }>;
        const first = new Date(keys[0] + 'T00:00:00Z');
        const last = new Date(keys[keys.length - 1] + 'T00:00:00Z');
        const out: Array<{ y: number; m0: number }> = [];
        let y = first.getUTCFullYear(), m0 = first.getUTCMonth();
        const endY = last.getUTCFullYear(), endM = last.getUTCMonth();
        while (y < endY || (y === endY && m0 <= endM)) { out.push({ y, m0 }); m0++; if (m0 > 11) { m0 = 0; y++; } }
        return out;
    }, [availableDays]);

    return (
        <div>
            <div className="sticky top-0 z-10 grid grid-cols-7 bg-white py-2 text-center text-xs font-medium text-slate-500">
                {WEEKDAYS.map((w, i) => <div key={i}>{w}</div>)}
            </div>
            {months.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">{emptyLabel}</p>
            ) : months.map(({ y, m0 }) => {
                const lead = mondayIndex(new Date(Date.UTC(y, m0, 1)));
                const n = daysInMonth(y, m0);
                return (
                    <div key={y + '-' + m0} className="mb-6 last:mb-0">
                        <div className="mb-3 text-base font-semibold text-slate-900">{monthYearLabel(dayKey(y, m0, 1))}</div>
                        <div className="grid grid-cols-7 gap-y-1">
                            {Array.from({ length: lead }).map((_, i) => <div key={'b' + i} />)}
                            {Array.from({ length: n }).map((_, i) => {
                                const day = i + 1;
                                const key = dayKey(y, m0, day);
                                const avail = availableDays.has(key);
                                const isToday = key === today;
                                const isSel = key === selected;
                                return (
                                    <div key={key} className="flex justify-center py-0.5">
                                        <button type="button" disabled={!avail} onClick={() => onSelect(key)}
                                            className={`flex h-11 w-11 items-center justify-center rounded-full text-sm transition ${
                                                isSel ? 'bg-slate-900 font-bold text-white'
                                                : !avail ? 'cursor-default text-slate-300'
                                                : isToday ? 'font-semibold text-slate-900 ring-1 ring-slate-900 hover:bg-slate-100'
                                                : 'font-semibold text-slate-900 hover:bg-slate-100'}`}>
                                            {day}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
