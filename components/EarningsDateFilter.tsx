'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DateRange, Range, RangeKeyDict } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import { CalendarDays } from 'lucide-react';

// The earnings date-range filter, using the SAME calendar the cottage booking
// widget and the change-reservation form use (react-date-range), as a range
// picker — instead of two browser-native <input type="date"> boxes that look and
// behave differently on every OS. It fills its box and reports day-keys
// ("YYYY-MM-DD") on the ?from / ?to query the earnings pages already read.

function keyToDate(k: string): Date {
    const [y, m, d] = String(k || '').split('-').map(Number);
    if (!y) return new Date();
    return new Date(y, (m || 1) - 1, d || 1);
}
function dateToKey(dt: Date | undefined): string {
    if (!dt) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
function label(k: string): string {
    return keyToDate(k).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function EarningsDateFilter({ from, to, basePath = '/dashboard/earnings' }: { from: string; to: string; basePath?: string }) {
    const router = useRouter();
    const params = useSearchParams();
    const [open, setOpen] = useState(false);
    const [range, setRange] = useState<Range>({ startDate: keyToDate(from), endDate: keyToDate(to), key: 'selection' });

    const apply = () => {
        const sp = new URLSearchParams(params?.toString());
        sp.set('from', dateToKey(range.startDate));
        sp.set('to', dateToKey(range.endDate));
        setOpen(false);
        router.push(`${basePath}?${sp.toString()}`);
    };

    return (
        <div className="relative w-full sm:w-auto">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-300"
            >
                <CalendarDays className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <span className="truncate">{label(from)} <span className="text-slate-400">–</span> {label(to)}</span>
            </button>

            {open && (
                <>
                    {/* click-away */}
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 z-50 mt-2 w-[min(92vw,360px)] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                        <div className="[&_.rdrCalendarWrapper]:w-full [&_.rdrMonth]:w-full [&_.rdrDateDisplayWrapper]:hidden">
                            <DateRange
                                ranges={[range]}
                                onChange={(rk: RangeKeyDict) => setRange(rk.selection)}
                                moveRangeOnFirstSelection={false}
                                months={1}
                                weekStartsOn={1}
                                direction="vertical"
                                rangeColors={['#047857']}
                                showMonthAndYearPickers={false}
                                showDateDisplay={false}
                            />
                        </div>
                        <div className="flex justify-end gap-2 px-2 pb-1 pt-2">
                            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:text-slate-800">Cancel</button>
                            <button type="button" onClick={apply} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800">Apply</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
