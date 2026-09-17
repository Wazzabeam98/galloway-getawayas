'use client';

import { useState } from 'react';
import { timeLabel } from '@/components/marketplace/present';

// The slot calendar's month GRID — nothing else. The workspace around it (the
// upcoming list, the add-sessions builder, a booking's details) is the parent's;
// this draws the month and reports which days are selected. It carries its own
// meaning: each cell shows what is on that day — booked times in emerald, the
// provider's own declared sessions in violet — so there is no legend to read and
// no instructions above the grid. Past days read as past.

export interface DayChip { time: string; kind: 'booked' | 'declared' }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const dowOf = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d)).getUTCDay();

export default function SlotCalendar({
    openWeekdays, blockedDates, partialByDate, chipsByDate, todayIso, selected, onToggleDay,
}: {
    openWeekdays: Set<number>;
    blockedDates: Set<string>;
    partialByDate: Record<string, unknown[]>;
    chipsByDate: Record<string, DayChip[]>;
    todayIso: string;
    selected: Set<string>;
    onToggleDay: (date: string, shift: boolean) => void;
}) {
    const [ty, tm] = [Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)) - 1];
    const [view, setView] = useState({ y: ty, m: tm });

    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const leading = dowOf(view.y, view.m, 1);
    const atFirstMonth = view.y === ty && view.m === tm;

    const cells: (string | null)[] = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(keyOf(view.y, view.m, d));

    const move = (delta: number) => { const m = view.m + delta; setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }); };
    const goToday = () => setView({ y: ty, m: tm });

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
            <div className="mb-2 flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-slate-900">{MONTHS[view.m]}</span>
                    <span className="text-lg font-semibold text-slate-400">{view.y}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    {!atFirstMonth && (
                        <button type="button" onClick={goToday}
                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-slate-400">Today</button>
                    )}
                    <button type="button" onClick={() => move(-1)} disabled={atFirstMonth}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:border-slate-400 disabled:opacity-40" aria-label="Previous month">‹</button>
                    <button type="button" onClick={() => move(1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:border-slate-400" aria-label="Next month">›</button>
                </div>
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {WEEKDAYS.map((w) => <div key={w} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">{w}</div>)}
                {cells.map((date, i) => {
                    if (!date) return <div key={`b${i}`} />;
                    const past = date < todayIso;
                    const dow = dowOf(view.y, view.m, Number(date.slice(8, 10)));
                    const open = openWeekdays.has(dow);
                    const blocked = blockedDates.has(date);
                    const partial = (partialByDate[date] || []).length > 0;
                    const chips = chipsByDate[date] || [];
                    const isToday = date === todayIso;
                    const isSel = selected.has(date);
                    const dayNum = Number(date.slice(8, 10));

                    // The cell frame. Selection is a strong slate ring; state is
                    // carried by the chips inside and a light wash, never by a key
                    // above the grid.
                    let frame = 'bg-white ring-1 ring-slate-200 hover:ring-slate-300';
                    if (past) frame = 'bg-slate-50 ring-1 ring-transparent';
                    else if (blocked) frame = 'bg-slate-100 ring-1 ring-slate-200';
                    else if (!open && chips.length === 0) frame = 'bg-slate-50/70 ring-1 ring-slate-100 hover:ring-slate-300';
                    else if (partial) frame = 'bg-white ring-1 ring-amber-300 hover:ring-amber-400';

                    return (
                        <button key={date} type="button" disabled={past}
                            onClick={(e) => onToggleDay(date, e.shiftKey)}
                            aria-pressed={isSel}
                            className={`relative flex min-h-[64px] flex-col items-stretch gap-1 rounded-xl p-1.5 text-left transition sm:min-h-[92px] ${frame} ${isSel ? 'ring-2 ring-slate-900 shadow-sm' : ''} ${past ? 'cursor-default' : ''}`}>
                            <div className="flex items-center justify-between">
                                <span className={
                                    isToday ? 'flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white'
                                        : past ? 'px-1 text-xs font-medium text-slate-300 line-through'
                                            : blocked ? 'px-1 text-xs font-medium text-slate-400 line-through'
                                                : 'px-1 text-xs font-semibold text-slate-700'
                                }>{dayNum}</span>
                                {isSel && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900"><span className="h-1.5 w-1.5 rounded-full bg-white" /></span>}
                            </div>
                            {blocked ? (
                                <span className="px-1 text-[10px] font-semibold text-slate-400">Day off</span>
                            ) : (
                                <div className="flex flex-col gap-0.5">
                                    {chips.slice(0, 2).map((c, j) => (
                                        <span key={j} className={`hidden truncate rounded px-1 py-0.5 text-[10px] font-semibold leading-none sm:block ${c.kind === 'booked' ? 'bg-emerald-100 text-emerald-800' : 'bg-violet-100 text-violet-700'}`}>
                                            {timeLabel(c.time + ':00')}
                                        </span>
                                    ))}
                                    {chips.length > 2 && <span className="hidden px-1 text-[10px] font-medium text-slate-400 sm:block">+{chips.length - 2} more</span>}
                                    {/* Phones can't fit chips: a compact dot row instead. */}
                                    {chips.length > 0 && (
                                        <span className="flex gap-0.5 px-1 sm:hidden">
                                            {chips.slice(0, 4).map((c, j) => <span key={j} className={`h-1.5 w-1.5 rounded-full ${c.kind === 'booked' ? 'bg-emerald-500' : 'bg-violet-500'}`} />)}
                                        </span>
                                    )}
                                    {partial && !past && <span className="px-1 text-[9px] font-semibold text-amber-600">part blocked</span>}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
