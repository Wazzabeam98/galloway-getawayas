'use client';

// A TRADE'S CALENDAR — the same month grid a host gets, for a plumber.
//
// It shows the jobs a trade has accepted on the days the host asked for, and
// lets the trade take a day off the way a host blocks a date. It deliberately
// reads like app/dashboard/calendar: a Monday-first month grid of aspect-square
// day cells, an emerald Wrench on a day with work, a slate "Day off" cell for a
// blocked day, a colour key beneath, and prev/next month.
//
// A job is always "asked for", never a slot the trade committed to — the same
// line the rest of the trade side holds. Blocking a day is advisory: it does not
// refuse an enquiry, it just marks the day on the trade's own calendar (they
// still agree the actual day with the host). Writes go through
// /api/services/trade-blocks, owner-checked.

import { useMemo, useState } from 'react';
import {
    startOfMonth, endOfMonth, eachDayOfInterval, getDay, format,
    addMonths, subMonths, isBefore, startOfDay,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';

export interface CalendarJob {
    dayKey: string;       // yyyy-mm-dd (the day asked for)
    title: string;        // the job summary
    window: string;       // "8am to 11am" / "any time"
    hostFirst: string;    // the owner's first name
}

export default function TradeCalendar({
    providerId,
    jobs,
    blockedDays,
}: {
    providerId: string;
    jobs: CalendarJob[];
    blockedDays: string[];
}) {
    const router = useRouter();
    const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
    const [busyDay, setBusyDay] = useState<string | null>(null);
    const [error, setError] = useState('');
    // Optimistic local view of the blocked set, so a click paints at once.
    const [blocked, setBlocked] = useState<Set<string>>(new Set(blockedDays));

    const jobsByDay = useMemo(() => {
        const m: Record<string, CalendarJob[]> = {};
        for (const j of jobs) (m[j.dayKey] = m[j.dayKey] || []).push(j);
        return m;
    }, [jobs]);

    const days = useMemo(() => eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }), [month]);
    const leadingBlanks = useMemo(() => (getDay(startOfMonth(month)) + 6) % 7, [month]);

    async function toggleBlock(key: string, isBlocked: boolean) {
        setBusyDay(key);
        setError('');
        // Optimistic paint.
        setBlocked((prev) => {
            const next = new Set(prev);
            if (isBlocked) next.delete(key); else next.add(key);
            return next;
        });
        try {
            const res = await fetch('/api/services/trade-blocks', {
                method: isBlocked ? 'DELETE' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId, day: key }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) {
                // Roll the paint back on failure.
                setBlocked((prev) => {
                    const next = new Set(prev);
                    if (isBlocked) next.add(key); else next.delete(key);
                    return next;
                });
                setError(data.error || 'Could not change that day.');
            } else {
                router.refresh();
            }
        } catch {
            setBlocked((prev) => {
                const next = new Set(prev);
                if (isBlocked) next.add(key); else next.delete(key);
                return next;
            });
            setError('Could not change that day.');
        } finally {
            setBusyDay(null);
        }
    }

    function onDayClick(key: string, isPast: boolean, hasWork: boolean) {
        if (isPast || hasWork) return;   // never block a day you already have work on
        toggleBlock(key, blocked.has(key));
    }

    const jobDaysThisMonth = days.filter((d) => (jobsByDay[format(d, 'yyyy-MM-dd')] || []).length).length;

    return (
        <div>
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">{format(month, 'MMMM yyyy')}</h2>
                <div className="flex gap-1">
                    <button type="button" onClick={() => setMonth((m) => subMonths(m, 1))} className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:border-slate-500" aria-label="Previous month">
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setMonth((m) => addMonths(m, 1))} className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:border-slate-500" aria-label="Next month">
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-7 text-center text-xs font-semibold text-slate-500 mb-2">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`blank-${i}`} />)}
                {days.map((day) => {
                    const key = format(day, 'yyyy-MM-dd');
                    const isPast = isBefore(day, startOfDay(new Date()));
                    const dayJobs = jobsByDay[key] || [];
                    const hasWork = !isPast && dayJobs.length > 0;
                    const isBlocked = blocked.has(key);
                    const title = hasWork
                        ? dayJobs.map((j) => `${j.hostFirst}: ${j.title} — asked for ${j.window}`).join('\n')
                        : isBlocked ? 'Day off — click to put the day back' : (!isPast ? 'Click to take the day off' : '');
                    return (
                        <button
                            key={key}
                            type="button"
                            disabled={isPast || busyDay === key}
                            onClick={() => onDayClick(key, isPast, hasWork)}
                            title={title}
                            className={`relative aspect-square rounded-xl border-2 p-1.5 flex flex-col items-start justify-between text-left transition ${
                                isPast ? 'opacity-30 cursor-not-allowed border-slate-100' :
                                hasWork ? 'border-emerald-600 bg-emerald-50' :
                                isBlocked ? 'border-slate-300 bg-slate-100 text-slate-400' :
                                'border-slate-200 hover:border-slate-400'
                            }`}
                        >
                            {hasWork && (
                                <span className="absolute top-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                                    <Wrench className="h-2.5 w-2.5" />
                                </span>
                            )}
                            <span className={`text-xs font-semibold ${isBlocked ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                                {format(day, 'd')}
                            </span>
                            {hasWork ? (
                                <span className="w-full truncate text-[9px] font-medium text-emerald-900">{dayJobs[0].hostFirst}</span>
                            ) : isBlocked ? (
                                <span className="text-[9px]">Day off</span>
                            ) : null}
                        </button>
                    );
                })}
            </div>

            {error && <p className="mt-3 text-[13px] text-rose-700">{error}</p>}

            <div className="mt-6 border-t pt-5">
                <div className="mb-4 text-xs text-slate-500">
                    {jobDaysThisMonth > 0
                        ? `${jobDaysThisMonth} day${jobDaysThisMonth === 1 ? '' : 's'} with work asked for this month`
                        : 'No work asked for this month yet'}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                    <div className="flex items-center gap-1.5">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600"><Wrench className="h-2.5 w-2.5 text-white" /></span>
                        Work asked for
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded bg-slate-100 border border-slate-300" /> Day off
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded border-2 border-slate-200" /> Available
                    </div>
                </div>
                <p className="mt-3 text-xs text-slate-400">
                    Click a free day to take it off; click it again to put it back. A day off is for your own diary — you still agree the actual day with the owner.
                </p>
            </div>
        </div>
    );
}
