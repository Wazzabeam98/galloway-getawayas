'use client';

import { useMemo, useState } from 'react';
import { optionAvailability, seatConfig } from '@/lib/serviceSlots';
import { unitMultiplies } from '@/lib/serviceOrders';
import { itemPriceLabel, dateLabel, timeLabel } from '@/components/marketplace/present';

export interface TimetableSession {
    id: string; date: string; time: string; duration: number;
    capacity: number; seats_taken: number; private: boolean; title: string | null;
}
export interface TimetableItem {
    id: string; name: string; price: number; unit: string;
    capacity?: number | null; minPeople?: number | null;
}

// THE DECLARED-SESSIONS LANE — a session-first timetable, shared by both booking
// panels (against-a-stay and standalone) so the design lives in one place. A guest
// reads a named, dated session the provider announced ("Sunday sauna social ·
// 6pm · 4 of 8 left"), picks it, chooses how many places, and books. Violet to
// echo the provider's own diary; the date, time and length are the session's own
// and fixed — the guest doesn't pick them. Seats-left is read off the SAME
// optionAvailability the open-hours grid uses, with the SESSION's own capacity as
// the pool, so the display and the book route can never disagree.
//
// Each panel wires its own onBook (the standalone one adds contact, the
// against-a-stay one the bookingId), and the actual POST — this component only
// presents the timetable and the place/item choice.
export default function SessionTimetable({
    sessions, items, providerMinPeople, busy, onBook,
}: {
    sessions: TimetableSession[];
    items: TimetableItem[];
    providerMinPeople: number;
    busy: boolean;
    onBook: (args: { session: TimetableSession; itemId: string; quantity: number }) => void;
}) {
    const [selId, setSelId] = useState<string | null>(null);
    const [itemId, setItemId] = useState<string>('');
    const [qty, setQty] = useState<number>(1);

    const days = useMemo(() => {
        const by: Record<string, TimetableSession[]> = {};
        for (const s of sessions) (by[s.date] = by[s.date] || []).push(s);
        return Object.keys(by).sort().map((d) => ({ date: d, list: by[d].sort((a, b) => (a.time < b.time ? -1 : 1)) }));
    }, [sessions]);

    // The items a session is bookable with: a shared session takes per-person
    // items (seats from the pool), a private one takes the whole-session flat item.
    const itemsFor = (s: TimetableSession) => items.filter((it) => (s.private ? !unitMultiplies(it.unit) : unitMultiplies(it.unit)));
    // Availability read off the session's OWN capacity — the same as the route.
    const availFor = (s: TimetableSession, it: TimetableItem) =>
        optionAvailability(
            { capacity: s.capacity, seats_taken: s.seats_taken, private: s.private },
            it.unit,
            seatConfig(it.capacity ?? null, it.minPeople ?? null, { slot_capacity: s.capacity, slot_min_people: providerMinPeople }),
        );
    const seatsLeftOf = (s: TimetableSession) => {
        const opts = itemsFor(s).map((it) => availFor(s, it)).filter((a) => a.possible);
        return opts.length ? Math.max(...opts.map((a) => a.seatsLeft)) : 0;
    };

    const select = (s: TimetableSession) => {
        setSelId(s.id);
        const its = itemsFor(s);
        setItemId(its.length ? its[0].id : '');
        setQty(1);
    };

    const selected = sessions.find((s) => s.id === selId) || null;
    const selItems = selected ? itemsFor(selected) : [];
    const selItem = selItems.find((it) => it.id === itemId) || selItems[0] || null;
    const perPerson = !!selItem && unitMultiplies(selItem.unit);
    const selAvail = selected && selItem ? availFor(selected, selItem) : null;
    const maxQty = Math.max(1, selAvail ? selAvail.seatsLeft : 1);

    if (!sessions.length) return null;

    return (
        <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-violet-700">Upcoming sessions</div>
            <div className="mt-2 space-y-3">
                {days.map((d) => (
                    <div key={d.date}>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{dateLabel(d.date)}</div>
                        <div className="space-y-1.5">
                            {d.list.map((s) => {
                                const left = seatsLeftOf(s);
                                const on = s.id === selId;
                                const full = left <= 0;
                                return (
                                    <div key={s.id}>
                                        <button type="button" disabled={full} onClick={() => select(s)}
                                            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${on ? 'border-violet-600 bg-violet-50/70' : full ? 'cursor-not-allowed border-slate-200 opacity-60' : 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/40'}`}>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-semibold text-slate-900">{s.title || 'Session'}</span>
                                                <span className="block text-xs text-slate-500">{timeLabel(s.time + ':00')}{s.private ? ' · whole session' : ''}</span>
                                            </span>
                                            <span className={`flex-none text-xs font-semibold ${full ? 'text-slate-400' : left <= 2 ? 'text-amber-700' : 'text-violet-700'}`}>
                                                {s.private
                                                    ? (full ? 'Booked' : 'Available')
                                                    : full ? 'Full' : `${left} of ${s.capacity} left`}
                                            </span>
                                        </button>

                                        {on && selected && (
                                            <div className="mt-1.5 rounded-xl border border-violet-200 bg-white p-3">
                                                {selItems.length > 1 && (
                                                    <div className="mb-2 space-y-1">
                                                        {selItems.map((it) => (
                                                            <label key={it.id} className="flex cursor-pointer items-center gap-2 text-sm">
                                                                <input type="radio" name={`ts-${s.id}`} checked={(itemId || selItems[0].id) === it.id} onChange={() => setItemId(it.id)} className="accent-violet-600" />
                                                                <span className="min-w-0 flex-1 truncate text-slate-800">{it.name}</span>
                                                                <span className="whitespace-nowrap font-semibold text-slate-900">{itemPriceLabel(it.price, it.unit)}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}
                                                {perPerson && (
                                                    <label className="mb-2 flex items-center justify-between gap-3 text-sm">
                                                        <span className="text-slate-600">How many places</span>
                                                        <input type="number" min={1} max={maxQty} value={qty}
                                                            onChange={(e) => setQty(Math.max(1, Math.min(maxQty, parseInt(e.target.value, 10) || 1)))}
                                                            className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-violet-600" />
                                                    </label>
                                                )}
                                                <button type="button" disabled={busy || !selItem}
                                                    onClick={() => selItem && onBook({ session: selected, itemId: selItem.id, quantity: perPerson ? qty : 1 })}
                                                    className="w-full rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-50">
                                                    {busy ? 'Starting…' : `Book${selItem ? ' · ' + itemPriceLabel(selItem.price, selItem.unit) : ''}`}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
