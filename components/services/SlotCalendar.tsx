'use client';

import { useState } from 'react';
import { dateLabel, timeLabel } from '@/components/marketplace/present';
import { OptionPills, Stepper, SESSION_LENGTH_OPTIONS, minutesLabel } from './editorControls';
import { CalendarPlus, Clock, Users, Trash2, X } from 'lucide-react';

// The slot diary's month calendar — the ONE place a provider shapes their dated
// availability, in the place they also see their bookings. Two things live here,
// sharing one interaction (select days, then act on the selection):
//
//   • ADD SESSIONS — declare dated sessions (a class, a one-off, a tasting) that
//     ADD availability the weekly template doesn't. A provider builds a LIST of
//     sessions for the selection (a morning and an afternoon; a shared and a
//     private), each with its own time, length and capacity, then commits them
//     to every selected day at once.
//   • BLOCK — close a whole day or part of one (an exception to the weekly hours).
//
// Selection is MULTI-SELECT: click days to toggle (pick four Tuesdays),
// shift-click for a run. The controls are the editor's own pills and steppers, so
// the diary and the listing editor read as one product.

export interface DayPartial { id: string; start: string; end: string }
export interface DeclaredSession { id: string; time: string; capacity: number; seats_taken: number; title: string | null }
export interface DraftSession { time: string; duration: number; capacity: number; title: string }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const dowOf = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d)).getUTCDay();
const isTime = (t: string) => /^\d{2}:\d{2}$/.test(t);
function daysBetween(a: string, b: string): string[] {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const out: string[] = [];
    let d = new Date(lo + 'T00:00:00Z');
    const end = new Date(hi + 'T00:00:00Z');
    for (let guard = 0; guard < 400 && d <= end; guard++) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
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
    onAddSessions: (dates: string[], sessions: DraftSession[]) => void;
    onRemoveDeclared: (id: string) => void;
    onBlockDays: (dates: string[], on: boolean) => void;
}) {
    const [ty, tm] = [Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)) - 1];
    const [view, setView] = useState({ y: ty, m: tm });
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [anchor, setAnchor] = useState<string | null>(null);
    const [pbStart, setPbStart] = useState('');
    const [pbEnd, setPbEnd] = useState('');
    // The draft being defined, and the list built up before committing.
    const [dTime, setDTime] = useState('');
    const [dDur, setDDur] = useState(addDefaults.duration || 60);
    const [dCap, setDCap] = useState(addDefaults.capacity || 1);
    const [dTitle, setDTitle] = useState('');
    const [pending, setPending] = useState<DraftSession[]>([]);

    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const leading = dowOf(view.y, view.m, 1);
    const atFirstMonth = view.y === ty && view.m === tm;

    const cells: (string | null)[] = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(keyOf(view.y, view.m, d));

    const move = (delta: number) => { const m = view.m + delta; setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }); };

    const clickDay = (date: string, shift: boolean) => {
        if (date < todayIso) return;
        setSelected((prev) => {
            const next = new Set(prev);
            if (shift && anchor) { for (const d of daysBetween(anchor, date)) if (d >= todayIso) next.add(d); }
            else if (next.has(date)) next.delete(date);
            else next.add(date);
            return next;
        });
        if (!shift) setAnchor(date);
    };
    const clearSelection = () => { setSelected(new Set()); setAnchor(null); setPbStart(''); setPbEnd(''); setPending([]); setDTime(''); setDTitle(''); };

    const selArr = Array.from(selected).sort();
    const one = selArr.length === 1 ? selArr[0] : null;
    const selPartials = one ? (partialByDate[one] || []) : [];
    const selBooked = one ? (bookedByDate[one] || 0) : 0;
    const selDeclared = one ? (declaredByDate[one] || []) : [];
    const selBlocked = one ? blockedDates.has(one) : false;

    // Length options include the provider's own default, so a non-standard length
    // is still a pill rather than forcing a retype.
    const lengthOpts = Array.from(new Set([...SESSION_LENGTH_OPTIONS, addDefaults.duration || 60])).sort((a, b) => a - b);

    const draftValid = isTime(dTime);
    const addDraftToList = () => {
        if (!draftValid) return;
        setPending((prev) => [...prev, { time: dTime, duration: dDur, capacity: dCap, title: dTitle.trim() }]);
        setDTime(''); setDTitle('');
    };
    // Committing includes a valid draft that hasn't been added to the list, so a
    // single session is fill-and-add without the extra "add to list" step.
    const toCommit: DraftSession[] = [...pending, ...(draftValid ? [{ time: dTime, duration: dDur, capacity: dCap, title: dTitle.trim() }] : [])];
    const commit = () => {
        if (!toCommit.length || !selArr.length) return;
        onAddSessions(selArr, toCommit);
        setPending([]); setDTime(''); setDTitle('');
    };

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between">
                <p className="text-base font-bold text-slate-900">Your calendar</p>
                <div className="flex items-center gap-1">
                    <button type="button" onClick={() => move(-1)} disabled={atFirstMonth}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:border-slate-400 disabled:opacity-40" aria-label="Previous month">‹</button>
                    <span className="w-36 text-center text-sm font-semibold text-slate-800">{MONTHS[view.m]} {view.y}</span>
                    <button type="button" onClick={() => move(1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:border-slate-400" aria-label="Next month">›</button>
                </div>
            </div>
            <p className="mt-1 text-sm text-slate-500">Click days to select them — shift-click for a run — then add sessions or block them. A day off stops new bookings; it never cancels one you’ve already taken.</p>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-100 ring-1 ring-emerald-300" /> Booked</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-violet-100 ring-1 ring-violet-300" /> Session added</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-slate-200 ring-1 ring-slate-300" /> Day off</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-white ring-1 ring-amber-300" /> Part blocked</span>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-1 text-center sm:gap-1.5">
                {WEEKDAYS.map((w) => <div key={w} className="py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{w}</div>)}
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

                    let cls = 'bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-slate-400';
                    let tag: string | null = null;
                    if (past) { cls = 'bg-slate-50 text-slate-300'; }
                    else if (booked > 0) { cls = 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300 hover:ring-emerald-400'; tag = booked + ' booked'; }
                    else if (blocked) { cls = 'bg-slate-200 text-slate-400 line-through ring-1 ring-slate-300'; tag = 'Day off'; }
                    else if (!open && declaredN === 0) { cls = 'bg-slate-50 text-slate-400 ring-1 ring-slate-100 hover:ring-slate-300'; }
                    else if (partial) { cls = 'bg-white text-slate-700 ring-1 ring-amber-300 hover:ring-amber-400'; }

                    return (
                        <button key={date} type="button" disabled={past}
                            onClick={(e) => clickDay(date, e.shiftKey)}
                            className={`relative flex min-h-[58px] flex-col items-center justify-start rounded-xl p-1 text-sm transition ${cls} ${isSel ? 'ring-2 ring-slate-900 shadow-sm' : ''} ${past ? 'cursor-default' : ''}`}>
                            {isSel && <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900"><span className="h-1.5 w-1.5 rounded-full bg-white" /></span>}
                            <span className={`mt-0.5 ${isToday ? 'flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white' : 'font-medium'}`}>{Number(date.slice(8, 10))}</span>
                            {tag && <span className="mt-0.5 text-[9px] font-semibold leading-tight">{tag}</span>}
                            {declaredN > 0 && !past && (
                                <span className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-violet-700">
                                    {declaredN}<Clock className="h-2.5 w-2.5" aria-hidden />
                                </span>
                            )}
                            {booked === 0 && !blocked && partial && !past ? <span className="mt-0.5 text-[9px] font-semibold leading-tight text-amber-600">part</span> : null}
                        </button>
                    );
                })}
            </div>

            {selArr.length === 0 && (
                <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Pick one or more days to add sessions or block time. Shift-click to select a run of days.</p>
            )}

            {selArr.length > 0 && (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-slate-900">{one ? dateLabel(one) : `${selArr.length} days selected`}</p>
                        <button type="button" onClick={clearSelection} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" />Clear</button>
                    </div>
                    {!one && <p className="mt-1 text-xs text-slate-500">{selArr.map((d) => dateLabel(d)).join(' · ')}</p>}

                    {/* ADD SESSIONS — a builder: define one, add it to the list, repeat,
                        then commit the list to every selected day at once. */}
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center gap-2">
                            <CalendarPlus className="h-4 w-4 text-violet-700" aria-hidden />
                            <p className="text-sm font-semibold text-slate-900">Add sessions{one ? '' : ` to all ${selArr.length} days`}</p>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">Dated sessions guests can book, on top of your weekly hours. Add as many as you like — a morning and an afternoon, a shared and a private. A day that clashes is skipped; the rest go ahead.</p>

                        {/* The draft */}
                        <div className="mt-3 space-y-3">
                            <div>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Time</span>
                                <input type="time" value={dTime} onChange={(e) => setDTime(e.target.value)}
                                    className="mt-1 rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                            </div>
                            <div>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Length</span>
                                <div className="mt-1"><OptionPills options={lengthOpts.map((m) => ({ value: String(m), label: minutesLabel(m) }))} value={String(dDur)} onChange={(v) => setDDur(Number(v))} /></div>
                            </div>
                            <div>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Capacity</span>
                                <div className="mt-1"><Stepper value={dCap} onChange={setDCap} min={1} max={60} /></div>
                            </div>
                            <div>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Name (optional)</span>
                                <input type="text" value={dTitle} onChange={(e) => setDTitle(e.target.value)} placeholder="e.g. Sunset session"
                                    className="mt-1 w-full max-w-xs rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                            </div>
                            <button type="button" onClick={addDraftToList} disabled={!draftValid}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500 disabled:opacity-40">
                                + Add another session
                            </button>
                        </div>

                        {/* The list built up so far (plus the current valid draft). */}
                        {toCommit.length > 0 && (
                            <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                                {toCommit.map((s, i) => (
                                    <li key={i} className="flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-1.5 text-sm ring-1 ring-violet-200">
                                        <Clock className="h-3.5 w-3.5 flex-none text-violet-700" aria-hidden />
                                        <span className="font-semibold text-slate-900">{timeLabel(s.time + ':00')}</span>
                                        <span className="text-xs text-slate-500">· {minutesLabel(s.duration)} · <Users className="inline h-3 w-3" aria-hidden /> up to {s.capacity}{s.title ? ` · ${s.title}` : ''}</span>
                                        {i < pending.length ? (
                                            <button type="button" onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))} className="ml-auto text-slate-400 hover:text-red-600" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                                        ) : <span className="ml-auto text-[10px] font-semibold uppercase text-slate-400">draft</span>}
                                    </li>
                                ))}
                            </ul>
                        )}

                        <button type="button" onClick={commit} disabled={!toCommit.length || busy === 'declare'}
                            className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                            {busy === 'declare' ? 'Adding…'
                                : `Add ${toCommit.length || ''} session${toCommit.length === 1 ? '' : 's'}${one ? '' : ` to ${selArr.length} days`}`.replace('  ', ' ')}
                        </button>
                    </div>

                    {/* Already-declared sessions on this day (single-day only). */}
                    {one && selDeclared.length > 0 && (
                        <div className="mt-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">On this day</p>
                            <ul className="mt-1.5 space-y-1.5">
                                {selDeclared.map((s) => (
                                    <li key={s.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-1.5 text-sm ring-1 ring-violet-200">
                                        <span className="font-semibold text-slate-900">{timeLabel(s.time + ':00')}</span>
                                        {s.title ? <span className="text-slate-600">{s.title}</span> : null}
                                        <span className="text-xs text-slate-500">· up to {s.capacity}</span>
                                        {s.seats_taken > 0
                                            ? <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">{s.seats_taken} booked</span>
                                            : <button type="button" disabled={busy === s.id} onClick={() => onRemoveDeclared(s.id)} className="ml-auto text-xs text-slate-400 hover:text-red-600 disabled:opacity-50">Remove</button>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* BLOCK */}
                    {one ? (
                        <div className="mt-3 border-t border-slate-200 pt-3">
                            {selBooked > 0 && (
                                <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
                                    {selBooked} booking{selBooked === 1 ? '' : 's'} on this day. Taking the day off stops <span className="font-semibold">new</span> bookings — it does not cancel these. To cancel one, use “Cancel &amp; refund” on the booking above.
                                </div>
                            )}
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm text-slate-700">{selBlocked ? 'This whole day is off.' : 'Take the whole day off'}</span>
                                <button type="button" disabled={busy === 'block'} onClick={() => onToggleFullBlock(one, !selBlocked)}
                                    className={`rounded-xl px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50 ${selBlocked ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-slate-900 hover:bg-black'}`}>
                                    {selBlocked ? 'Reopen the day' : 'Block the day'}
                                </button>
                            </div>
                            {!selBlocked && (
                                <div className="mt-4 border-t border-slate-100 pt-3">
                                    <p className="text-sm font-medium text-slate-800">Block part of the day</p>
                                    <p className="mt-0.5 text-xs text-slate-500">Close a range — a lunch break, an afternoon. A range clashing with a booking is refused.</p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <input type="time" value={pbStart} onChange={(e) => setPbStart(e.target.value)} aria-label="Block from" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                                        <span className="text-sm text-slate-400">to</span>
                                        <input type="time" value={pbEnd} onChange={(e) => setPbEnd(e.target.value)} aria-label="Block until" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                                        <button type="button" disabled={!pbStart || !pbEnd || busy === 'pblock'}
                                            onClick={() => { onAddPartial(one, pbStart, pbEnd); setPbStart(''); setPbEnd(''); }}
                                            className="rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">Block this time</button>
                                    </div>
                                    {selPartials.length > 0 && (
                                        <ul className="mt-2 flex flex-wrap gap-1.5">
                                            {selPartials.map((b) => (
                                                <li key={b.id} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200">
                                                    {b.start}–{b.end}
                                                    <button type="button" disabled={busy === b.id} onClick={() => onRemovePartial(b.id)} aria-label="Remove block" className="text-slate-400 hover:text-slate-700 disabled:opacity-50">×</button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                            <span className="text-sm text-slate-700">Take all {selArr.length} days off</span>
                            <button type="button" disabled={busy === 'block'} onClick={() => onBlockDays(selArr, true)}
                                className="rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">Block these days</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
