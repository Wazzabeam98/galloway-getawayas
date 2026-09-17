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

export default function SlotDayView({
    date, data, todayIso, nowMin, activeTime, onOpenRow, onAddAt, onRemoveBand,
}: {
    date: string;
    data: DayData;
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
                <p className="mt-1 text-sm text-slate-500">Guests can’t book any time on it. Reopen it from the panel.</p>
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

                {/* Slots. */}
                {rows.map((r) => {
                    const isActive = r.time === activeTime;
                    const h = Math.max(38, (r.endMin - r.startMin) * PX_PER_MIN - 3);
                    if (r.kind === 'free') {
                        return (
                            <button key={r.time} type="button" onClick={() => onAddAt(r.time)}
                                className={`group absolute inset-x-1 rounded-lg border border-dashed text-left transition ${isActive ? 'border-slate-900 bg-slate-50' : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50'}`}
                                style={{ top: top(r.startMin) + 1, height: h }}>
                                <span className="flex items-center gap-1.5 px-2 pt-1 text-[11px] text-slate-400">
                                    <span className="font-semibold text-slate-500">{timeLabel(r.time + ':00')}</span>
                                    <span className="opacity-0 transition group-hover:opacity-100">· add or block</span>
                                </span>
                            </button>
                        );
                    }
                    const violet = r.kind === 'declared';
                    const priv = r.kind === 'private';
                    const cap = r.capacity || 0, taken = r.seatsTaken || 0;
                    const pct = cap > 0 ? Math.min(100, Math.round((taken / cap) * 100)) : (taken > 0 ? 100 : 0);
                    const low = violet && cap > 0 && taken > 0 && taken / cap < 0.5;
                    return (
                        <button key={r.time} type="button" onClick={() => onOpenRow(r)}
                            className={`absolute inset-x-1 overflow-hidden rounded-lg border px-2 py-1 text-left transition ${isActive ? 'ring-2 ring-offset-1' : ''} ${violet ? 'border-violet-300 bg-violet-50 ring-violet-500' : 'border-emerald-300 bg-emerald-50 ring-emerald-600'}`}
                            style={{ top: top(r.startMin) + 1, height: h }}>
                            <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-bold ${violet ? 'text-violet-900' : 'text-emerald-900'}`}>{timeLabel(r.time + ':00')}</span>
                                {priv && <Lock className="h-3 w-3 text-emerald-700" aria-hidden />}
                                <span className={`truncate text-xs ${violet ? 'text-violet-800' : 'text-emerald-800'}`}>
                                    {priv ? 'Private hire' : (r.title || (violet ? 'Class' : 'Session'))}
                                </span>
                                <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                                    {priv ? 'whole session' : (<><Users className="h-3 w-3" aria-hidden />{taken} / {cap}</>)}
                                </span>
                            </div>
                            {!priv && (
                                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/70">
                                    <div className={`h-full ${violet ? 'bg-violet-500' : 'bg-emerald-500'}`} style={{ width: pct + '%' }} />
                                </div>
                            )}
                            {low && h > 46 && <span className="mt-0.5 block text-[10px] font-semibold text-violet-600">filling slowly</span>}
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
