'use client';

import { useState } from 'react';
import { dateLabel, timeLabel } from '@/components/marketplace/present';

// The slot diary's month calendar — the ONE place a provider shapes their dated
// availability, in the place they also see their bookings. Two things live here,
// sharing one interaction (select days, then act on the selection):
//
//   • BLOCK — close a whole day or part of one (an exception to the weekly hours).
//   • ADD A SESSION — declare a dated session (a class, a one-off, a tasting) that
//     ADDS availability the weekly template doesn't, or sits on a day with none.
//
// Selection is MULTI-SELECT: click days to toggle them (pick four Tuesdays),
// shift-click for a contiguous range, then add one session to all at once — not
// the same action four times. The weekly template lives in the listing editor;
// this calendar owns the dated layer on top of it.
//
// A booked day and a blocked day are DELIBERATELY different (green vs grey struck);
// a declared session shows as its own violet cue; selection is a heavy ring + a
// corner mark so it never hides or mimics those states.

export interface DayPartial { id: string; start: string; end: string }
export interface DeclaredSession { id: string; time: string; capacity: number; seats_taken: number; title: string | null }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
// Weekday of a calendar date, computed in UTC so it never drifts by a timezone.
const dowOf = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d)).getUTCDay();
// Inclusive list of date keys between two keys (order-independent).
function daysBetween(a: string, b: string): string[] {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const out: string[] = [];
    let d = new Date(lo + 'T00:00:00Z');
    const end = new Date(hi + 'T00:00:00Z');
    for (let guard = 0; guard < 400 && d <= end; guard++) {
        out.push(d.toISOString().slice(0, 10));
        d = new Date(d.getTime() + 86400000);
    }
    return out;
}

export default function SlotCalendar({
    openWeekdays, blockedDates, partialByDate, bookedByDate, declaredByDate, addDefaults, todayIso, busy,
    onToggleFullBlock, onAddPartial, onRemovePartial, onAddSessions, onRemoveDeclared, onBlockDays,
}: {
    openWeekdays: Set<number>;
    blockedDates: Set<string>;
    partialByDate: Record<string, DayPartial[]>;
    bookedByDate: Record<string, number>;
    declaredByDate: Record<string, DeclaredSession[]>;
    addDefaults: { duration: number; capacity: number };
    todayIso: string;
    busy: string | null;
    onToggleFullBlock: (date: string, on: boolean) => void;
    onAddPartial: (date: string, start: string, end: string) => void;
    onRemovePartial: (id: string) => void;
    onAddSessions: (dates: string[], time: string, duration: number, capacity: number, title: string) => void;
    onRemoveDeclared: (id: string) => void;
    onBlockDays: (dates: string[], on: boolean) => void;
}) {
    const [ty, tm] = [Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)) - 1];
    const [view, setView] = useState({ y: ty, m: tm });      // the month on screen
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [anchor, setAnchor] = useState<string | null>(null);
    const [pbStart, setPbStart] = useState('');
    const [pbEnd, setPbEnd] = useState('');
    // The add-a-session form. Duration/capacity seed from the provider's defaults.
    const [addTime, setAddTime] = useState('');
    const [addDur, setAddDur] = useState(String(addDefaults.duration || 60));
    const [addCap, setAddCap] = useState(String(addDefaults.capacity || 1));
    const [addTitle, setAddTitle] = useState('');

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

    // Click a day: shift-click extends a range from the anchor; a plain click
    // toggles the day and re-anchors. Past days can't be selected.
    const clickDay = (date: string, shift: boolean) => {
        if (date < todayIso) return;
        setSelected((prev) => {
            const next = new Set(prev);
            if (shift && anchor) {
                for (const d of daysBetween(anchor, date)) if (d >= todayIso) next.add(d);
            } else if (next.has(date)) {
                next.delete(date);
            } else {
                next.add(date);
            }
            return next;
        });
        if (!shift) setAnchor(date);
    };
    const clearSelection = () => { setSelected(new Set()); setAnchor(null); setPbStart(''); setPbEnd(''); };

    const selArr = Array.from(selected).sort();
    const one = selArr.length === 1 ? selArr[0] : null;
    const selPartials = one ? (partialByDate[one] || []) : [];
    const selBooked = one ? (bookedByDate[one] || 0) : 0;
    const selDeclared = one ? (declaredByDate[one] || []) : [];
    const selBlocked = one ? blockedDates.has(one) : false;

    const addToSelection = () => {
        if (!addTime || !selArr.length) return;
        onAddSessions(selArr, addTime, Math.max(1, Number(addDur) || 60), Math.max(1, Number(addCap) || 1), addTitle.trim());
        setAddTitle('');
    };

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
            <p className="mt-0.5 text-sm text-gray-500">Click days to select them — shift-click for a run of days — then add a session or block them. A day off stops new bookings; it never cancels one you’ve already taken.</p>

            {/* Legend */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-100 ring-1 ring-emerald-300" /> Booked</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-violet-100 ring-1 ring-violet-300" /> Session added</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-gray-200 ring-1 ring-gray-300" /> Day off</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-white ring-1 ring-amber-300" /> Part blocked</span>
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
                    const declaredN = (declaredByDate[date] || []).length;
                    const isToday = date === todayIso;
                    const isSel = selected.has(date);

                    // Base state: booked (green) → day off (grey struck) → part-blocked
                    // (amber ring) → plain open/closed. Declared sessions add a violet
                    // cue on top rather than replacing the base.
                    let cls = 'bg-white text-gray-700 ring-1 ring-gray-200';
                    let tag: string | null = null;
                    if (past) { cls = 'bg-gray-50 text-gray-300'; }
                    else if (booked > 0) { cls = 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300'; tag = booked + ' booked'; }
                    else if (blocked) { cls = 'bg-gray-200 text-gray-400 line-through ring-1 ring-gray-300'; tag = 'Day off'; }
                    else if (!open && declaredN === 0) { cls = 'bg-gray-50 text-gray-300 ring-1 ring-gray-100'; }
                    else if (partial) { cls = 'bg-white text-gray-700 ring-1 ring-amber-300'; }

                    return (
                        <button key={date} type="button" disabled={past}
                            onClick={(e) => clickDay(date, e.shiftKey)}
                            className={`relative flex min-h-[52px] flex-col items-center justify-start rounded-lg p-1 text-sm transition ${cls} ${isSel ? 'ring-2 ring-gray-900 shadow-md' : ''} ${!past ? 'hover:ring-gray-400' : 'cursor-default'}`}>
                            {/* Selected mark — a solid corner dot, unmistakable on any base. */}
                            {isSel && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-gray-900" />}
                            <span className={`mt-0.5 ${isToday ? 'flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white' : 'font-medium'}`}>{Number(date.slice(8, 10))}</span>
                            {tag && <span className="mt-0.5 text-[9px] font-semibold leading-tight">{tag}</span>}
                            {declaredN > 0 && !past && <span className="mt-0.5 text-[9px] font-semibold leading-tight text-violet-600">{declaredN} session{declaredN === 1 ? '' : 's'}</span>}
                            {booked === 0 && !blocked && partial && !past ? <span className="mt-0.5 text-[9px] font-semibold leading-tight text-amber-600">part</span> : null}
                        </button>
                    );
                })}
            </div>

            {/* Panel — acts on the whole selection. */}
            {selArr.length > 0 && (
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-900">
                            {one ? dateLabel(one) : `${selArr.length} days selected`}
                        </p>
                        <button type="button" onClick={clearSelection} className="text-xs text-gray-400 hover:text-gray-700">Clear</button>
                    </div>
                    {!one && (
                        <p className="mt-1 text-xs text-gray-500">{selArr.map((d) => dateLabel(d)).join(' · ')}</p>
                    )}

                    {/* ADD A SESSION — works for one day or many at once. */}
                    <div className="mt-3 rounded-lg border border-violet-200 bg-white p-3">
                        <p className="text-sm font-medium text-gray-800">Add a session{one ? '' : ` to all ${selArr.length} days`}</p>
                        <p className="mt-0.5 text-xs text-gray-500">A dated session guests can book — on top of your weekly hours. Any day that clashes with a booking is skipped, the rest go ahead.</p>
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                            <label className="text-xs font-medium text-gray-600">Time
                                <input type="time" value={addTime} onChange={(e) => setAddTime(e.target.value)} className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-sm" />
                            </label>
                            <label className="text-xs font-medium text-gray-600">Length (min)
                                <input type="number" min={1} step={15} value={addDur} onChange={(e) => setAddDur(e.target.value)} className="mt-1 block w-20 rounded-md border border-gray-300 px-2 py-1 text-sm" />
                            </label>
                            <label className="text-xs font-medium text-gray-600">Capacity
                                <input type="number" min={1} value={addCap} onChange={(e) => setAddCap(e.target.value)} className="mt-1 block w-20 rounded-md border border-gray-300 px-2 py-1 text-sm" />
                            </label>
                            <label className="text-xs font-medium text-gray-600">Name (optional)
                                <input type="text" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="e.g. Sunset session" className="mt-1 block w-44 rounded-md border border-gray-300 px-2 py-1 text-sm" />
                            </label>
                            <button type="button" disabled={!addTime || busy === 'declare'} onClick={addToSelection}
                                className="rounded-md bg-violet-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50">
                                {busy === 'declare' ? 'Adding…' : (one ? 'Add session' : `Add to ${selArr.length} days`)}
                            </button>
                        </div>
                    </div>

                    {/* Sessions already added on this day (single-day only). */}
                    {one && selDeclared.length > 0 && (
                        <div className="mt-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sessions you’ve added</p>
                            <ul className="mt-1.5 space-y-1.5">
                                {selDeclared.map((s) => (
                                    <li key={s.id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-violet-200">
                                        <span className="font-semibold text-gray-900">{timeLabel(s.time)}</span>
                                        {s.title ? <span className="text-gray-600">{s.title}</span> : null}
                                        <span className="text-xs text-gray-500">· up to {s.capacity}</span>
                                        {s.seats_taken > 0
                                            ? <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">{s.seats_taken} booked</span>
                                            : <button type="button" disabled={busy === s.id} onClick={() => onRemoveDeclared(s.id)} className="ml-auto text-xs text-gray-400 hover:text-red-600 disabled:opacity-50">Remove</button>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* BLOCK — single day keeps whole-day + part-of-day; a multi-day
                        selection gets a whole-day bulk block. */}
                    {one ? (
                        <>
                            {selBooked > 0 && (
                                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
                                    {selBooked} booking{selBooked === 1 ? '' : 's'} on this day. Taking the day off stops <span className="font-semibold">new</span> bookings — it does not cancel these. To cancel one, use “Cancel &amp; refund” on the booking above.
                                </div>
                            )}
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <span className="text-sm text-gray-700">{selBlocked ? 'This whole day is off.' : 'Take the whole day off'}</span>
                                <button type="button" disabled={busy === 'block'} onClick={() => onToggleFullBlock(one, !selBlocked)}
                                    className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${selBlocked ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-gray-900 hover:bg-black'}`}>
                                    {selBlocked ? 'Reopen the day' : 'Block the day'}
                                </button>
                            </div>
                            {!selBlocked && (
                                <div className="mt-4 border-t border-gray-200 pt-3">
                                    <p className="text-sm font-medium text-gray-800">Block part of the day</p>
                                    <p className="mt-0.5 text-xs text-gray-500">Close a range — a lunch break, an afternoon. A range clashing with a booking is refused.</p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <input type="time" value={pbStart} onChange={(e) => setPbStart(e.target.value)} aria-label="Block from" className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
                                        <span className="text-sm text-gray-400">to</span>
                                        <input type="time" value={pbEnd} onChange={(e) => setPbEnd(e.target.value)} aria-label="Block until" className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
                                        <button type="button" disabled={!pbStart || !pbEnd || busy === 'pblock'}
                                            onClick={() => { onAddPartial(one, pbStart, pbEnd); setPbStart(''); setPbEnd(''); }}
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
                        </>
                    ) : (
                        <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-3">
                            <span className="text-sm text-gray-700">Take all {selArr.length} days off</span>
                            <button type="button" disabled={busy === 'block'} onClick={() => onBlockDays(selArr, true)}
                                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-50">Block these days</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
