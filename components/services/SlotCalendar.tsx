'use client';

import { useState } from 'react';
import type { Tick } from '@/lib/slotDay';

// The month OVERVIEW. Each cell paints the day's shape — a tick per slot in time
// order — so you read "full / one gap / empty / blocked" at a glance, never a
// single truncated time. Click a day to open it; shift-click several to add
// sessions to them all. No legend: the ticks and counts carry it.

export interface DayShape { ticks: Tick[]; booked: number; added: number; free: number; dayOff: boolean }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const dowOf = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d)).getUTCDay();

const TICK: Record<Tick, string> = {
    free: 'bg-slate-200',
    session: 'bg-emerald-400',
    private: 'bg-emerald-600',
    declared: 'bg-violet-500',
    'declared-empty': 'bg-violet-300',
    block: 'bg-slate-300',
};

export default function SlotCalendar({
    shapeByDate, todayIso, selected, onDayClick,
}: {
    shapeByDate: Record<string, DayShape>;
    todayIso: string;
    selected: Set<string>;
    onDayClick: (date: string, shift: boolean) => void;
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

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-slate-900">{MONTHS[view.m]}</span>
                    <span className="text-lg font-semibold text-slate-400">{view.y}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    {!atFirstMonth && <button type="button" onClick={() => setView({ y: ty, m: tm })} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-slate-400">Today</button>}
                    <button type="button" onClick={() => move(-1)} disabled={atFirstMonth} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:border-slate-400 disabled:opacity-40" aria-label="Previous month">‹</button>
                    <button type="button" onClick={() => move(1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:border-slate-400" aria-label="Next month">›</button>
                </div>
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {WEEKDAYS.map((w) => <div key={w} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">{w}</div>)}
                {cells.map((date, i) => {
                    if (!date) return <div key={`b${i}`} />;
                    const past = date < todayIso;
                    const isToday = date === todayIso;
                    const isSel = selected.has(date);
                    const shape = shapeByDate[date];
                    const dayNum = Number(date.slice(8, 10));
                    const dayOff = shape?.dayOff;

                    const ticks = shape?.ticks || [];
                    const count = dayOff ? 'Day off'
                        : shape && (shape.booked || shape.added)
                            ? [shape.booked ? `${shape.booked} booked` : '', shape.added ? `${shape.added} to fill` : '', (!shape.booked && !shape.added && shape.free) ? `${shape.free} free` : ''].filter(Boolean).join(' · ')
                            : '';

                    let frame = 'bg-white ring-1 ring-slate-200 hover:ring-slate-300';
                    if (past) frame = 'bg-slate-50 ring-1 ring-transparent';
                    else if (dayOff) frame = 'ring-1 ring-slate-200';

                    return (
                        <button key={date} type="button" disabled={past} onClick={(e) => onDayClick(date, e.shiftKey)} aria-pressed={isSel}
                            className={`relative flex min-h-[62px] flex-col rounded-xl p-1.5 text-left transition sm:min-h-[86px] ${frame} ${isSel ? 'ring-2 ring-slate-900 shadow-sm' : ''} ${past ? 'cursor-default' : ''}`}
                            style={dayOff && !past ? { backgroundImage: 'repeating-linear-gradient(45deg, #f1f5f9 0, #f1f5f9 5px, #fff 5px, #fff 10px)' } : undefined}>
                            <div className="flex items-center justify-between">
                                <span className={isToday ? 'flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white' : past ? 'px-1 text-xs font-medium text-slate-300 line-through' : 'px-1 text-xs font-semibold text-slate-700'}>{dayNum}</span>
                                {isSel && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900"><span className="h-1.5 w-1.5 rounded-full bg-white" /></span>}
                            </div>
                            {!past && !dayOff && ticks.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-0.5">
                                    {ticks.slice(0, 12).map((t, j) => <span key={j} className={`h-3 w-1 rounded-sm ${TICK[t]}`} />)}
                                    {ticks.length > 12 && <span className="text-[9px] font-medium text-slate-400">+{ticks.length - 12}</span>}
                                </div>
                            )}
                            {count && <span className="mt-auto hidden pt-1 text-[10px] font-medium text-slate-500 sm:block">{count}</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
