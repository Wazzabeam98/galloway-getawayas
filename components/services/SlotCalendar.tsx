'use client';

import { useState } from 'react';
import { dateLabel } from '@/components/marketplace/present';

// The slot diary's month calendar — the ONE place a provider blocks a date, in
// the place they also see their bookings. It reads the same data the diary
// already loads and calls the same routes (via the callbacks below); it adds no
// endpoint and no table. The weekly template lives in the listing editor; here a
// provider closes exceptions to it — a whole day, or part of one.
//
// A booked day and a blocked day are DELIBERATELY different: green "booked"
// versus a grey struck "day off", plus a legend and a caution in the panel. A
// full-day block never cancels a booking (it stops NEW ones), so the two must
// never look alike — a provider must not block a day believing it cancels what's
// on it.

export interface DayPartial { id: string; start: string; end: string }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
// Weekday of a calendar date, computed in UTC so it never drifts by a timezone.
const dowOf = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d)).getUTCDay();

export default function SlotCalendar({
    openWeekdays, blockedDates, partialByDate, bookedByDate, todayIso, busy,
    onToggleFullBlock, onAddPartial, onRemovePartial,
}: {
    openWeekdays: Set<number>;
    blockedDates: Set<string>;
    partialByDate: Record<string, DayPartial[]>;
    bookedByDate: Record<string, number>;
    todayIso: string;
    busy: string | null;
    onToggleFullBlock: (date: string, on: boolean) => void;
    onAddPartial: (date: string, start: string, end: string) => void;
    onRemovePartial: (id: string) => void;
}) {
    const [ty, tm] = [Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)) - 1];
    const [view, setView] = useState({ y: ty, m: tm });      // the month on screen
    const [selected, setSelected] = useState<string | null>(null);
    const [pbStart, setPbStart] = useState('');
    const [pbEnd, setPbEnd] = useState('');

    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const leading = dowOf(view.y, view.m, 1);                // blanks before day 1
    const atFirstMonth = view.y === ty && view.m === tm;     // don't page into the past

    const cells: (string | null)[] = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(keyOf(view.y, view.m, d));

    const move = (delta: number) => {
        const m = view.m + delta;
        setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
    };

    const selPartials = selected ? (partialByDate[selected] || []) : [];
    const selBooked = selected ? (bookedByDate[selected] || 0) : 0;
    const selBlocked = selected ? blockedDates.has(selected) : false;
    const selDow = selected ? dowOf(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)) - 1, Number(selected.slice(8, 10))) : 0;
    const selClosed = selected ? !openWeekdays.has(selDow) : false;

    return (
        <div className="rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">Your calendar</p>
                <div className="flex items-center gap-1">
                    <button type="button" onClick={() => move(-1)} disabled={atFirstMonth}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:border-gray-400 disabled:opacity-40" aria-label="Previous month">‹</button>
                    <span className="w-36 text-center text-sm font-semibold text-gray-800">{MONTHS[view.m]} {view.y}</span>
                    <button type="button" onClick={() => move(1)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:border-gray-400" aria-label="Next month">›</button>
                </div>
            </div>
            <p className="mt-0.5 text-sm text-gray-500">Close a whole day or part of one. A day off stops new bookings; it never cancels a booking you’ve already taken.</p>

            {/* Legend — the booked/blocked distinction, stated. */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-100 ring-1 ring-emerald-300" /> Booked</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-gray-200 ring-1 ring-gray-300" /> Day off</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-white ring-1 ring-amber-300" /> Part blocked</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-white ring-1 ring-gray-300" /> Open</span>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-1 text-center">
                {WEEKDAYS.map((w) => <div key={w} className="py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{w}</div>)}
                {cells.map((date, i) => {
                    if (!date) return <div key={`b${i}`} />;
                    const past = date < todayIso;
                    const dow = dowOf(view.y, view.m, Number(date.slice(8, 10)));
                    const open = openWeekdays.has(dow);
                    const blocked = blockedDates.has(date);
                    const partial = (partialByDate[date] || []).length > 0;
                    const booked = bookedByDate[date] || 0;
                    const isToday = date === todayIso;
                    const isSel = date === selected;

                    // The visual order matters: booked reads first (green), then a
                    // day off (grey struck), then part-blocked (amber ring), then a
                    // plain open/closed cell.
                    let cls = 'bg-white text-gray-700 ring-1 ring-gray-200';
                    let tag: string | null = null;
                    if (past) { cls = 'bg-gray-50 text-gray-300'; }
                    else if (booked > 0) { cls = 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300'; tag = booked + ' booked'; }
                    else if (blocked) { cls = 'bg-gray-200 text-gray-400 line-through ring-1 ring-gray-300'; tag = 'Day off'; }
                    else if (!open) { cls = 'bg-gray-50 text-gray-300 ring-1 ring-gray-100'; }
                    else if (partial) { cls = 'bg-white text-gray-700 ring-1 ring-amber-300'; }

                    return (
                        <button key={date} type="button" disabled={past}
                            onClick={() => { setSelected(date); setPbStart(''); setPbEnd(''); }}
                            className={`relative flex min-h-[52px] flex-col items-center justify-start rounded-lg p-1 text-sm transition ${cls} ${isSel ? 'outline outline-2 outline-gray-900' : ''} ${!past ? 'hover:ring-gray-400' : 'cursor-default'}`}>
                            <span className={`mt-0.5 ${isToday ? 'flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white' : 'font-medium'}`}>{Number(date.slice(8, 10))}</span>
                            {tag && <span className="mt-0.5 text-[9px] font-semibold leading-tight">{tag}</span>}
                            {blocked && partial ? null : (!blocked && partial && !past ? <span className="mt-0.5 text-[9px] font-semibold leading-tight text-amber-600">part</span> : null)}
                        </button>
                    );
                })}
            </div>

            {/* Detail panel for the selected day. */}
            {selected && (
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-900">{dateLabel(selected)}</p>
                        <button type="button" onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-700">Close</button>
                    </div>

                    {selBooked > 0 && (
                        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
                            {selBooked} booking{selBooked === 1 ? '' : 's'} on this day. Taking the day off stops <span className="font-semibold">new</span> bookings — it does not cancel these; they still stand. To cancel one, use “Cancel &amp; refund” on the booking above.
                        </div>
                    )}
                    {selClosed && selBooked === 0 && (
                        <p className="mt-2 text-xs text-gray-500">You have no weekly hours this weekday, so nothing’s bookable then anyway.</p>
                    )}

                    {/* Whole-day off */}
                    <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-sm text-gray-700">{selBlocked ? 'This whole day is off.' : 'Take the whole day off'}</span>
                        <button type="button" disabled={busy === 'block'} onClick={() => onToggleFullBlock(selected, !selBlocked)}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${selBlocked ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-gray-900 hover:bg-black'}`}>
                            {selBlocked ? 'Reopen the day' : 'Block the day'}
                        </button>
                    </div>

                    {/* Part of a day — reuses the same time inputs. Hidden when the
                        whole day is already off (nothing left to part-block). */}
                    {!selBlocked && (
                        <div className="mt-4 border-t border-gray-200 pt-3">
                            <p className="text-sm font-medium text-gray-800">Block part of the day</p>
                            <p className="mt-0.5 text-xs text-gray-500">Close a range — a lunch break, an afternoon. A range clashing with a booking is refused.</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <input type="time" value={pbStart} onChange={(e) => setPbStart(e.target.value)} aria-label="Block from" className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
                                <span className="text-sm text-gray-400">to</span>
                                <input type="time" value={pbEnd} onChange={(e) => setPbEnd(e.target.value)} aria-label="Block until" className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
                                <button type="button" disabled={!pbStart || !pbEnd || busy === 'pblock'}
                                    onClick={() => { onAddPartial(selected, pbStart, pbEnd); setPbStart(''); setPbEnd(''); }}
                                    className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Block this time</button>
                            </div>
                            {selPartials.length > 0 && (
                                <ul className="mt-2 space-y-1.5">
                                    {selPartials.map((b) => (
                                        <li key={b.id} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs text-gray-700 ring-1 ring-gray-200">
                                            {b.start}–{b.end}
                                            <button type="button" disabled={busy === b.id} onClick={() => onRemovePartial(b.id)} aria-label="Remove block" className="text-gray-400 hover:text-gray-700 disabled:opacity-50">×</button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
