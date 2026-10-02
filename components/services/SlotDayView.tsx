'use client';

import { timeLabel } from '@/components/marketplace/present';
import type { DayData, DaySlotRow } from '@/lib/slotDay';
import { Users, Lock } from 'lucide-react';

// One day as a time-axis: the hours down the side, each slot a block sitting at
// its time and sized to its length. A free slot is a light block you click to add
// or block; a booking / class shows its fill; a private hire is one slot taken
// whole; a partial block is a hatched band over its hours. This is where a
// provider sees the day and manages it.

const PX_PER_MIN = 1.1;
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const daysUntil = (a: string, b: string) => Math.round((new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / 86400000);

export default function SlotDayView({
    date, data, freeShared, todayIso, nowMin, activeTime, onOpenRow, onAddAt, onRemoveBand,
}: {
    date: string;
    data: DayData;
    freeShared: boolean;
    todayIso: string;
    nowMin: number;
    activeTime: string | null;
    onOpenRow: (row: DaySlotRow) => void;
    onAddAt: (time: string) => void;
    onRemoveBand: (id: string) => void;
}) {
    const { windowStart, windowEnd, rows, bands, dayOff } = data;
    const height = Math.max(120, (windowEnd - windowStart) * PX_PER_MIN);
    const top = (min: number) => (min - windowStart) * PX_PER_MIN;

    const hours: number[] = [];
    for (let m = windowStart; m <= windowEnd; m += 60) hours.push(m);

    if (dayOff) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center">
                <p className="text-sm font-semibold text-slate-700">This day is off</p>
                <p className="mt-1 text-sm text-slate-500">Guests can’t book any time on it. Use “Reopen day” above to open it again.</p>
            </div>
        );
    }
    // No open hours this weekday and nothing declared — a genuinely empty day,
    // said plainly so it isn't mistaken for a bug.
    if (rows.length === 0 && bands.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <p className="text-sm font-semibold text-slate-700">Nothing bookable on this day</p>
                <p className="mt-1 text-sm text-slate-500">You’re not open this weekday. Add a one-off session, or set weekly hours in your listing.</p>
            </div>
        );
    }

    return (
        <div className="relative flex" style={{ height }}>
            {/* Hour ruler */}
            <div className="relative w-12 flex-none">
                {hours.map((m) => (
                    <div key={m} className="absolute right-1 -translate-y-1/2 text-[11px] font-medium text-slate-400" style={{ top: top(m) }}>{timeLabel(hhmm(m) + ':00')}</div>
                ))}
            </div>
            {/* Track */}
            <div className="relative flex-1 border-l border-slate-200">
                {hours.map((m) => (
                    <div key={m} className="absolute inset-x-0 border-t border-slate-100" style={{ top: top(m) }} />
                ))}

                {/* Blocks (hatched bands) sit behind the slots. */}
                {bands.map((b) => (
                    <button key={b.id} type="button" onClick={() => onRemoveBand(b.id)}
                        title="Remove this block"
                        className="absolute inset-x-1 overflow-hidden rounded-lg border border-slate-300 text-left"
                        style={{ top: top(b.startMin) + 1, height: Math.max(22, (b.endMin - b.startMin) * PX_PER_MIN - 2), backgroundImage: 'repeating-linear-gradient(45deg, #e2e8f0 0, #e2e8f0 6px, #f1f5f9 6px, #f1f5f9 12px)' }}>
                        <span className="px-2 text-[11px] font-semibold text-slate-500">{timeLabel(hhmm(b.startMin) + ':00')}–{timeLabel(hhmm(b.endMin) + ':00')} · blocked</span>
                    </button>
                ))}

                {/* Slots. Colour carries STATE (free = light, booking = emerald,
                    class = violet), the bar + numbers carry how-full, and a full
                    slot reads as complete — the provider's win — not an alarm. */}
                {rows.map((r) => {
                    const isActive = r.time === activeTime;
                    const h = Math.max(40, (r.endMin - r.startMin) * PX_PER_MIN - 3);
                    const tall = h > 50;
                    const priv = r.kind === 'private';
                    const violet = r.kind === 'declared';
                    const cap = r.capacity ?? 0;
                    const taken = r.seatsTaken ?? 0;
                    const left = r.seatsLeft ?? Math.max(0, cap - taken);
                    const full = priv || (cap > 0 && left <= 0);
                    const pct = priv ? 100 : (cap > 0 ? Math.min(100, Math.round((taken / cap) * 100)) : 0);
                    const soon = daysUntil(date, todayIso) <= 7;
                    const low = violet && cap > 0 && taken > 0 && taken / cap < 0.5 && soon;

                    if (r.kind === 'free') {
                        // An open slot is LIVE — a guest can book it now. It reads as
                        // a defined, ready row (bold time, its capacity, an empty
                        // fill track = 0 booked), not a faint "Free", so an open day
                        // never looks like nothing's set up.
                        const openLabel = cap <= 0 ? 'Open' : freeShared ? `${cap} free` : `Open · up to ${cap}`;
                        return (
                            <button key={r.time} type="button" onClick={() => onAddAt(r.time)}
                                className={`group absolute inset-x-1 overflow-hidden rounded-lg border pl-3 pr-2 py-1 text-left transition hover:border-slate-400 hover:shadow-sm ${isActive ? 'border-slate-900 bg-white' : 'border-slate-300 bg-white'}`}
                                style={{ top: top(r.startMin) + 1, height: h }}>
                                {/* A faint left accent — a slot that's live and ready,
                                    without the fill of a booking. */}
                                <span className="absolute inset-y-0 left-0 w-1 bg-emerald-300" />
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold text-slate-800">{timeLabel(r.time + ':00')}</span>
                                    <span className="truncate text-xs text-slate-400 opacity-0 transition group-hover:opacity-100">Add a class or block</span>
                                    <span className="ml-auto flex-none rounded-full border border-slate-300 px-1.5 text-[11px] font-semibold text-slate-600">{openLabel}</span>
                                </div>
                                <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100" />
                            </button>
                        );
                    }
                    const tone = violet
                        ? (full ? 'border-violet-400 bg-violet-100 ring-violet-500' : 'border-violet-300 bg-violet-50 ring-violet-500 hover:border-violet-400')
                        : (full ? 'border-emerald-400 bg-emerald-100 ring-emerald-600' : 'border-emerald-300 bg-emerald-50 ring-emerald-600 hover:border-emerald-400');
                    const rightLabel = priv ? 'whole session'
                        : (violet && taken === 0) ? `${cap} space${cap === 1 ? '' : 's'}`
                            : full ? 'Full' : `${left} of ${cap} left`;
                    return (
                        <button key={r.time} type="button" onClick={() => onOpenRow(r)}
                            className={`absolute inset-x-1 overflow-hidden rounded-lg border px-2 py-1 text-left transition hover:shadow-sm ${tone} ${isActive ? 'ring-2 ring-offset-1' : ''}`}
                            style={{ top: top(r.startMin) + 1, height: h }}>
                            <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-bold ${violet ? 'text-violet-900' : 'text-emerald-900'}`}>{timeLabel(r.time + ':00')}</span>
                                {priv && <Lock className="h-3 w-3 flex-none text-emerald-700" aria-hidden />}
                                <span className={`truncate text-xs ${violet ? 'text-violet-800' : 'text-emerald-800'}`}>{priv ? 'Private hire' : (r.title || (violet ? 'Class' : 'Session'))}</span>
                                <span className={`ml-auto flex flex-none items-center gap-1 rounded-full px-1.5 text-[11px] font-bold ${full ? (violet ? 'bg-violet-600 text-white' : 'bg-emerald-600 text-white') : 'text-slate-600'}`}>
                                    {!full && !priv && <Users className="h-3 w-3" aria-hidden />}{rightLabel}
                                </span>
                            </div>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/80">
                                <div className={`h-full rounded-full ${violet ? 'bg-violet-500' : 'bg-emerald-500'}`} style={{ width: pct + '%' }} />
                            </div>
                            {low && tall && <span className="mt-0.5 block text-[10px] font-semibold text-amber-600">filling slowly</span>}
                        </button>
                    );
                })}

                {/* The "now" line, on today only. */}
                {date === todayIso && nowMin >= windowStart && nowMin <= windowEnd && (
                    <div className="absolute inset-x-0 z-10 flex items-center" style={{ top: top(nowMin) }}>
                        <span className="h-1.5 w-1.5 flex-none rounded-full bg-rose-500" />
                        <span className="h-px flex-1 bg-rose-400" />
                    </div>
                )}
            </div>
        </div>
    );
}
