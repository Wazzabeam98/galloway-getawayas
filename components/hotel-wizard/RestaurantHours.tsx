'use client';

import { Plus, X } from 'lucide-react';

// Restaurant opening hours, per day of the week, Google-Business style: each day
// is Closed or Open with one or two time ranges (e.g. 10:00–14:00 and
// 17:00–21:00). Stored as { mon: [{from,to},…], … } — an empty/absent day array
// is closed. Native time inputs, matching the rest of the time fields.

export type TimeRange = { from: string; to: string };
export type RestaurantSchedule = Record<string, TimeRange[]>;

const DAYS: { key: string; label: string }[] = [
    { key: 'mon', label: 'Monday' }, { key: 'tue', label: 'Tuesday' }, { key: 'wed', label: 'Wednesday' },
    { key: 'thu', label: 'Thursday' }, { key: 'fri', label: 'Friday' }, { key: 'sat', label: 'Saturday' },
    { key: 'sun', label: 'Sunday' },
];

const timeCls = 'rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900';

export default function RestaurantHours({ value, onChange }: {
    value: RestaurantSchedule;
    onChange: (v: RestaurantSchedule) => void;
}) {
    const sched = value || {};
    function setDay(day: string, ranges: TimeRange[]) {
        const next = { ...sched };
        if (ranges.length === 0) delete next[day]; else next[day] = ranges;
        onChange(next);
    }
    // Opening a closed day copies the nearest earlier day that already has hours
    // — so setting Monday and opening Tuesday carries Monday's times down the
    // week (still editable), instead of re-typing them. Falls back to a sensible
    // default when nothing earlier is set. A fresh copy, never the same array.
    function prefillFor(dayIndex: number): TimeRange[] {
        for (let i = dayIndex - 1; i >= 0; i--) {
            const prev = sched[DAYS[i].key];
            if (prev && prev.length) return prev.map((r) => ({ ...r }));
        }
        return [{ from: '09:00', to: '17:00' }];
    }
    return (
        <div className="space-y-2">
            {DAYS.map(({ key, label }, dayIndex) => {
                const ranges = sched[key] || [];
                const open = ranges.length > 0;
                return (
                    <div key={key} className="flex items-start gap-3 py-1.5 border-b border-slate-100 last:border-0">
                        <span className="w-24 shrink-0 pt-1.5 text-sm font-medium text-slate-700">{label}</span>
                        <div className="flex-1">
                            {!open ? (
                                <button type="button" onClick={() => setDay(key, prefillFor(dayIndex))}
                                    className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">Closed — add hours</button>
                            ) : (
                                <div className="space-y-1.5">
                                    {ranges.map((r, i) => (
                                        <div key={i} className="flex items-center gap-1.5">
                                            <input type="time" value={r.from} onChange={(e) => setDay(key, ranges.map((x, idx) => idx === i ? { ...x, from: e.target.value } : x))} className={timeCls} />
                                            <span className="text-slate-400">–</span>
                                            <input type="time" value={r.to} onChange={(e) => setDay(key, ranges.map((x, idx) => idx === i ? { ...x, to: e.target.value } : x))} className={timeCls} />
                                            <button type="button" onClick={() => setDay(key, ranges.filter((_, idx) => idx !== i))} aria-label="Remove" className="p-1 text-slate-400 hover:text-rose-600"><X className="h-4 w-4" /></button>
                                        </div>
                                    ))}
                                    {ranges.length < 2 && (
                                        <button type="button" onClick={() => setDay(key, [...ranges, { from: '17:00', to: '21:00' }])}
                                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800"><Plus className="h-3 w-3" /> Add a second time</button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// A one-line human summary for the public page, e.g.
// "Mon–Fri 10:00–14:00, 17:00–21:00 · Sat 18:00–22:00 · Sun closed".
export function restaurantSummary(sched: RestaurantSchedule | null | undefined): string {
    if (!sched) return '';
    const parts = DAYS.map(({ key, label }) => {
        const ranges = sched[key] || [];
        if (!ranges.length) return null;
        return `${label.slice(0, 3)} ${ranges.map((r) => `${r.from}–${r.to}`).join(', ')}`;
    }).filter(Boolean);
    return parts.join(' · ');
}
