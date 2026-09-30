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
    id: string;           // the enquiry id — clicking the day opens it
    dayKey: string;       // yyyy-mm-dd (the day asked for)
    title: string;        // the job summary
    window: string;       // "8am to 11am" / "any time"
    hostFirst: string;    // the owner's first name
}

export default function TradeCalendar({
    providerId,
    jobs,
    blockedDays,
    clashDays = [],
}: {
    providerId: string;
    jobs: CalendarJob[];
    blockedDays: string[];
    // Days where two accepted jobs overlap in the same window — flagged amber, not
    // blocked (a soft double-book the trade chose to take).
    clashDays?: string[];
}) {
    const router = useRouter();
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    // Every day that has work, soonest first — used to open the calendar on the
    // month the work is actually in (not an empty current month) and to point at
    // the next month with work when this one is empty.
    const workDayKeys = useMemo(
        () => jobs.map((j) => j.dayKey).filter((k) => k >= todayKey).sort(),
        [jobs, todayKey],
    );
    // Open on the first month that has work; fall back to this month when there is
    // none. A trade whose jobs are all in October lands on October, not on an
    // empty September reading "No work asked for this month yet".
    const [month, setMonth] = useState<Date>(() =>
        workDayKeys.length ? startOfMonth(new Date(workDayKeys[0] + 'T12:00:00')) : startOfMonth(new Date()),
    );
    const [busyDay, setBusyDay] = useState<string | null>(null);
    const [error, setError] = useState('');
    // Optimistic local view of the blocked set, so a click paints at once.
    const [blocked, setBlocked] = useState<Set<string>>(new Set(blockedDays));

    const jobsByDay = useMemo(() => {
        const m: Record<string, CalendarJob[]> = {};
        for (const j of jobs) (m[j.dayKey] = m[j.dayKey] || []).push(j);
        return m;
    }, [jobs]);
    const clashSet = useMemo(() => new Set(clashDays), [clashDays]);

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

    function onDayClick(key: string, isPast: boolean) {
        if (isPast) return;
        const dayJobs = jobsByDay[key] || [];
        if (dayJobs.length > 0) {
            // A day with work opens that enquiry — the way a host opens a booking
            // from their calendar. It lands on the Requests page's Accepted folder
            // with the enquiry selected (both jobs of a clash day are there too).
            router.push('/services/dashboard?enquiry=' + encodeURIComponent(dayJobs[0].id));
            return;
        }
        // A free day is the trade's own diary — click to take it off.
        toggleBlock(key, blocked.has(key));
    }

    const jobDaysThisMonth = days.filter((d) => (jobsByDay[format(d, 'yyyy-MM-dd')] || []).length).length;
    // The first day with work in a month after the one on screen, so an empty
    // month can point the trade at where their jobs actually are.
    const monthKey = format(month, 'yyyy-MM');
    const nextWorkKey = workDayKeys.find((k) => k.slice(0, 7) > monthKey) || null;

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
                    const isClash = hasWork && clashSet.has(key);
                    const title = hasWork
                        ? (isClash ? 'Two jobs in the same window — check you can do both.\n' : '')
                            + dayJobs.map((j) => `${j.hostFirst}: ${j.title} — asked for ${j.window}`).join('\n')
                            + '\nClick to open.'
                        : isBlocked ? 'Day off — click to put the day back' : (!isPast ? 'Click to take the day off' : '');
                    return (
                        <button
                            key={key}
                            type="button"
                            disabled={isPast || busyDay === key}
                            onClick={() => onDayClick(key, isPast)}
                            title={title}
                            className={`relative aspect-square overflow-hidden rounded-xl border-2 p-1 sm:p-1.5 flex flex-col items-start justify-start gap-0.5 text-left transition ${
                                isPast ? 'opacity-30 cursor-not-allowed border-slate-100' :
                                isClash ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-400 ring-offset-1 hover:bg-amber-100' :
                                hasWork ? 'border-emerald-600 bg-emerald-50 hover:bg-emerald-100' :
                                isBlocked ? 'border-slate-300 bg-slate-100 text-slate-400' :
                                'border-slate-200 hover:border-slate-400'
                            }`}
                        >
                            {hasWork && (
                                <span className={`absolute top-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full text-white shadow-sm ${isClash ? 'bg-amber-500' : 'bg-emerald-600'}`}>
                                    <Wrench className="h-2.5 w-2.5" />
                                </span>
                            )}
                            <span className={`text-xs font-semibold ${isBlocked ? 'text-slate-400 line-through' : hasWork ? (isClash ? 'text-amber-900' : 'text-emerald-900') : 'text-slate-800'}`}>
                                {format(day, 'd')}
                            </span>
                            {/* A job day reads like a host's booking day, filled out:
                                the owner's name, the time window they asked for, and
                                (for a single job) a short job title. Two jobs on a day
                                show both, and keep the amber clash treatment. */}
                            {hasWork ? (
                                <span className="mt-0.5 w-full min-w-0 leading-tight">
                                    {/* A phone's square can't hold two jobs with their
                                        windows, so a multi-job day reads "2 jobs" there
                                        (the amber ring still marks a clash) and opens
                                        both on tap. A single job shows the name. */}
                                    {dayJobs.length >= 2 && (
                                        <span className={`sm:hidden block truncate text-[9px] font-semibold ${isClash ? 'text-amber-900' : 'text-emerald-900'}`}>
                                            {dayJobs.length} jobs
                                        </span>
                                    )}
                                    {/* Wider cells show every job in full: the name, the
                                        window they asked for, and (for a single job) a
                                        short title — matching a host's booking cell. */}
                                    <span className={dayJobs.length >= 2 ? 'hidden sm:block space-y-0.5' : 'block space-y-0.5'}>
                                        {dayJobs.slice(0, 2).map((j) => (
                                            <span key={j.id} className="block min-w-0">
                                                <span className={`block truncate text-[9px] sm:text-[10px] font-semibold ${isClash ? 'text-amber-900' : 'text-emerald-900'}`}>
                                                    {j.hostFirst}
                                                </span>
                                                <span className={`hidden sm:block truncate text-[9px] ${isClash ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                    {j.window}
                                                </span>
                                                {dayJobs.length === 1 && (
                                                    <span className="hidden sm:block truncate text-[9px] text-slate-500">{j.title}</span>
                                                )}
                                            </span>
                                        ))}
                                        {dayJobs.length > 2 && (
                                            <span className={`block text-[9px] font-semibold ${isClash ? 'text-amber-800' : 'text-emerald-800'}`}>
                                                +{dayJobs.length - 2} more
                                            </span>
                                        )}
                                    </span>
                                </span>
                            ) : isBlocked ? (
                                <span className="mt-auto text-[9px]">Day off</span>
                            ) : null}
                        </button>
                    );
                })}
            </div>

            {error && <p className="mt-3 text-[13px] text-rose-700">{error}</p>}

            <div className="mt-6 border-t pt-5">
                <div className="mb-4 text-xs text-slate-500">
                    {jobDaysThisMonth > 0 ? (
                        `${jobDaysThisMonth} day${jobDaysThisMonth === 1 ? '' : 's'} with work asked for this month`
                    ) : nextWorkKey ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                            No work asked for this month.
                            <button
                                type="button"
                                onClick={() => setMonth(startOfMonth(new Date(nextWorkKey + 'T12:00:00')))}
                                className="font-semibold text-emerald-700 underline hover:text-emerald-800"
                            >
                                Next work is in {format(new Date(nextWorkKey + 'T12:00:00'), 'MMMM yyyy')} →
                            </button>
                        </span>
                    ) : (
                        'No work asked for yet'
                    )}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                    <div className="flex items-center gap-1.5">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600"><Wrench className="h-2.5 w-2.5 text-white" /></span>
                        Work asked for
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500"><Wrench className="h-2.5 w-2.5 text-white" /></span>
                        Two jobs, same window — check
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
