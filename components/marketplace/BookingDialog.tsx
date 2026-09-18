'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X, Minus, Plus, Calendar } from 'lucide-react';
import { optionAvailability, seatConfig } from '@/lib/serviceSlots';
import { unitMultiplies, MAX_ORDER_QUANTITY } from '@/lib/serviceOrders';
import { itemPriceLabel, timeLabel, monthYearLabel, dayHeadingLabel } from '@/components/marketplace/present';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';

export interface DialogItem { id: string; name: string; price: number; unit: string; fulfilment?: string | null; capacity?: number | null; minPeople?: number | null; }
export interface DialogOpenSession { date: string; time: string; row: { capacity: number; seats_taken: number; private: boolean } | null; }
export interface DialogDeclared { id: string; date: string; time: string; duration: number; capacity: number; seats_taken: number; private: boolean; title: string | null; }

export interface BookArgs { itemId: string; date: string; time: string; quantity: number; attendees?: number; serviceAddress?: string; allergy?: string; }

// A merged, sortable offering — an open-hours slot or a declared session — so the
// dialog reads one chronological timetable per day.
interface Offering {
    key: string; date: string; time: string; kind: 'open' | 'declared';
    title: string | null; row: { capacity: number; seats_taken: number; private: boolean } | null;
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const mondayIndex = (d: Date) => (d.getUTCDay() + 6) % 7;
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const dayKey = (y: number, m0: number, d: number) => `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// THE "SHOW DATES" DIALOG — the Airbnb-shaped availability picker, shared by both
// booking panels. A guest sets how many people, then either scrolls the timetable
// (every available date, grouped by day, a card per time) or taps the calendar
// icon by the month header to jump straight to a date. A declared session is the
// same card at the same standard, marked as a named event (violet + its title).
// Selecting a slot and pressing Book goes straight to Stripe Checkout — the panel's
// onBook does the POST + redirect; no contact is collected here (Checkout does that).
export default function BookingDialog({
    who, items, sessions, sessionsForItem, declaredSessions, providerCapacity, providerMinPeople, providerFulfilment, isFood, initialDate, busy, error, onBook, onClose,
}: {
    who: string;
    items: DialogItem[];
    sessions: DialogOpenSession[];
    // A per-treatment provider (massage) generates its open-hours grid from the
    // chosen item's own duration, so the panel passes a function; when present it
    // wins over the static `sessions`. Must be stable (useCallback).
    sessionsForItem?: (itemId: string) => DialogOpenSession[];
    declaredSessions: DialogDeclared[];
    providerCapacity: number;
    providerMinPeople: number;
    providerFulfilment?: string | null;
    isFood?: boolean;
    // The day to open on — set when a guest taps a day in the panel preview. The
    // list scrolls to it on open; null means start at the top.
    initialDate?: string | null;
    busy: boolean;
    error: string | null;
    onBook: (args: BookArgs) => void;
    onClose: () => void;
}) {
    const [itemId, setItemId] = useState<string>(items.length === 1 ? items[0].id : (items[0]?.id || ''));
    const [people, setPeople] = useState<number>(1);
    const [selKey, setSelKey] = useState<string | null>(null);
    const [address, setAddress] = useState('');
    const [allergy, setAllergy] = useState('');

    // Month-jump calendar (the calendar icon by the header). `calSel` is the day a
    // guest taps in the grid; "Next" scrolls the list to it.
    const [calOpen, setCalOpen] = useState(false);
    const [calSel, setCalSel] = useState<string | null>(null);

    const listRef = useRef<HTMLDivElement | null>(null);
    const dayEls = useRef<Map<string, HTMLDivElement>>(new Map());

    const item = items.find((i) => i.id === itemId) || items[0] || null;
    const perPerson = !!item && unitMultiplies(item.unit);
    const travels = !!item && (String(item.fulfilment) === 'delivery' || (item.fulfilment == null && providerFulfilment === 'delivery'));

    const today = londonDayKey();
    const tomorrow = shiftDayKey(today, 1);

    // Esc closes; lock the background scroll while open.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (calOpen) setCalOpen(false); else onClose(); } };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [onClose, calOpen]);

    // Every offering, chronological. The parent already windows and futures the lists.
    const openSessions = useMemo(() => (sessionsForItem ? sessionsForItem(itemId) : sessions), [sessionsForItem, itemId, sessions]);
    const offerings: Offering[] = useMemo(() => {
        const open: Offering[] = openSessions.map((s) => ({ key: 'o:' + s.date + ' ' + s.time, date: s.date, time: s.time, kind: 'open', title: null, row: s.row }));
        const dec: Offering[] = declaredSessions.map((d) => ({ key: 'd:' + d.id, date: d.date, time: d.time, kind: 'declared', title: d.title, row: { capacity: d.capacity, seats_taken: d.seats_taken, private: d.private } }));
        return [...open, ...dec].sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
    }, [openSessions, declaredSessions]);

    // Availability for one offering, for the chosen item and party size — read off
    // the same optionAvailability the route enforces, with the offering's own pool.
    const availOf = (o: Offering) => {
        if (!item) return { possible: false, seatsLeft: 0, reason: 'full' as const };
        const pool = o.kind === 'declared'
            ? { slot_capacity: o.row ? o.row.capacity : 0, slot_min_people: providerMinPeople }
            : seatConfig(item.capacity ?? null, item.minPeople ?? null, { slot_capacity: providerCapacity, slot_min_people: providerMinPeople });
        return optionAvailability(o.row, item.unit, pool);
    };
    const fits = (o: Offering) => { const a = availOf(o); return a.possible && (perPerson ? people : 1) <= a.seatsLeft; };

    const days = useMemo(() => {
        const by: Record<string, Offering[]> = {};
        for (const o of offerings) (by[o.date] = by[o.date] || []).push(o);
        return Object.keys(by).sort().map((d) => ({ date: d, list: by[d] }));
    }, [offerings]);

    // Which days a guest could actually book, for the month grid — a day with no
    // fitting time is greyed and not tappable.
    const availableDays = useMemo(() => {
        const set = new Set<string>();
        for (const d of days) if (d.list.some(fits)) set.add(d.date);
        return set;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days, item, people]);

    // The months the grid spans — first available day to last.
    const months = useMemo(() => {
        const keys = Array.from(availableDays).sort();
        if (!keys.length) return [] as Array<{ y: number; m0: number }>;
        const first = new Date(keys[0] + 'T00:00:00Z');
        const last = new Date(keys[keys.length - 1] + 'T00:00:00Z');
        const out: Array<{ y: number; m0: number }> = [];
        let y = first.getUTCFullYear(), m0 = first.getUTCMonth();
        const endY = last.getUTCFullYear(), endM = last.getUTCMonth();
        while (y < endY || (y === endY && m0 <= endM)) { out.push({ y, m0 }); m0++; if (m0 > 11) { m0 = 0; y++; } }
        return out;
    }, [availableDays]);

    const selected = offerings.find((o) => o.key === selKey) || null;
    // Keep the selection valid as the party size / item changes.
    useEffect(() => { if (selected && !fits(selected)) setSelKey(null); /* eslint-disable-next-line */ }, [people, itemId]);

    const minPeople = item && perPerson ? Math.max(1, Number(item.minPeople ?? providerMinPeople) || 1) : 1;
    useEffect(() => { setPeople((p) => Math.max(minPeople, p)); }, [minPeople]);

    // The header month follows the list — the topmost day in view.
    const [headerMonth, setHeaderMonth] = useState<string>('');
    useEffect(() => { if (days.length) setHeaderMonth(monthYearLabel(days[0].date)); }, [days]);
    const onListScroll = () => {
        const el = listRef.current; if (!el) return;
        const top = el.scrollTop + 4;
        let current = days[0]?.date;
        for (const d of days) { const node = dayEls.current.get(d.date); if (node && node.offsetTop <= top) current = d.date; else break; }
        if (current) setHeaderMonth(monthYearLabel(current));
    };

    // Scroll the list to a given day (the day tapped in the panel, or picked in the
    // grid). Runs once the list is on screen.
    const scrollToDay = (date: string) => {
        const el = listRef.current; const node = dayEls.current.get(date);
        if (el && node) el.scrollTop = node.offsetTop - 4;
    };
    useLayoutEffect(() => {
        if (calOpen || !initialDate) return;
        // The day may not have a section (fully booked / past) — nearest on/after it.
        const target = days.find((d) => d.date >= initialDate)?.date;
        if (target) { scrollToDay(target); setHeaderMonth(monthYearLabel(target)); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialDate, calOpen, days.length]);

    const applyCalPick = () => {
        if (!calSel) return;
        const target = days.find((d) => d.date >= calSel)?.date || calSel;
        setCalOpen(false);
        // Wait for the list to render before scrolling to the day.
        requestAnimationFrame(() => { scrollToDay(target); setHeaderMonth(monthYearLabel(target)); });
    };

    const lineTotal = item ? (perPerson ? item.price * people : item.price) : 0;
    const priceEach = item ? itemPriceLabel(item.price, item.unit) : '';

    const submit = () => {
        if (!selected || !item) return;
        if (travels && !address.trim()) return;
        onBook({
            itemId: item.id, date: selected.date, time: selected.time,
            quantity: perPerson ? people : 1,
            attendees: perPerson ? undefined : people,
            serviceAddress: travels ? address.trim() : undefined,
            allergy: isFood ? (allergy.trim() || undefined) : undefined,
        });
    };

    const canBook = !!selected && !!item && (!travels || !!address.trim());

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Show dates" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h2 className="text-lg font-bold text-slate-900">{calOpen ? 'Choose a date' : 'Choose a time'}</h2>
                    <button type="button" onClick={() => (calOpen ? setCalOpen(false) : onClose())} aria-label="Close" className="rounded-full p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>

                {calOpen ? (
                    <>
                        {/* Weekday header */}
                        <div className="grid grid-cols-7 border-b border-slate-100 px-5 py-2 text-center text-xs font-medium text-slate-500">
                            {WEEKDAYS.map((w, i) => <div key={i}>{w}</div>)}
                        </div>
                        {/* Scrollable month grid — the full month so a guest can jump to a date */}
                        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                            {months.length === 0 ? (
                                <p className="py-8 text-center text-sm text-slate-500">No dates available just now.</p>
                            ) : months.map(({ y, m0 }) => {
                                const lead = mondayIndex(new Date(Date.UTC(y, m0, 1)));
                                const n = daysInMonth(y, m0);
                                return (
                                    <div key={y + '-' + m0} className="mb-6 last:mb-0">
                                        <div className="mb-3 text-base font-semibold text-slate-900">{monthYearLabel(dayKey(y, m0, 1))}</div>
                                        <div className="grid grid-cols-7 gap-y-1">
                                            {Array.from({ length: lead }).map((_, i) => <div key={'b' + i} />)}
                                            {Array.from({ length: n }).map((_, i) => {
                                                const day = i + 1;
                                                const key = dayKey(y, m0, day);
                                                const avail = availableDays.has(key);
                                                const isToday = key === today;
                                                const isSel = key === calSel;
                                                return (
                                                    <div key={key} className="flex justify-center py-0.5">
                                                        <button type="button" disabled={!avail} onClick={() => setCalSel(key)}
                                                            className={`flex h-11 w-11 items-center justify-center rounded-full text-sm transition ${
                                                                isSel ? 'bg-slate-900 font-bold text-white'
                                                                : !avail ? 'cursor-default text-slate-300'
                                                                : isToday ? 'font-semibold text-slate-900 ring-1 ring-slate-900 hover:bg-slate-100'
                                                                : 'font-semibold text-slate-900 hover:bg-slate-100'}`}>
                                                            {day}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {/* Footer: confirm the picked date */}
                        <div className="border-t border-slate-100 px-5 py-4">
                            <button type="button" onClick={applyCalPick} disabled={!calSel}
                                className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-black disabled:opacity-40">
                                Next
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        {/* Controls: option (if >1) + party size */}
                        <div className="border-b border-slate-100 px-5 py-4">
                            {items.length > 1 && (
                                <div className="mb-3">
                                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Option</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {items.map((it) => (
                                            <button key={it.id} type="button" onClick={() => { setItemId(it.id); setSelKey(null); }}
                                                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${itemId === it.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>
                                                {it.name} · {itemPriceLabel(it.price, it.unit)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-semibold text-slate-900">{perPerson ? 'How many places' : 'How many people'}</div>
                                    {minPeople > 1 && <div className="text-xs text-slate-400">Minimum {minPeople}</div>}
                                </div>
                                <div className="flex items-center gap-3">
                                    <button type="button" aria-label="Fewer" disabled={people <= minPeople} onClick={() => setPeople((p) => Math.max(minPeople, p - 1))} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-700 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                                    <span className="w-6 text-center text-sm font-semibold">{people}</span>
                                    <button type="button" aria-label="More" disabled={people >= MAX_ORDER_QUANTITY} onClick={() => setPeople((p) => Math.min(MAX_ORDER_QUANTITY, p + 1))} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-700 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                                </div>
                            </div>
                        </div>

                        {/* Month header + calendar-jump icon */}
                        {days.length > 0 && (
                            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                                <div className="text-base font-semibold text-slate-900">{headerMonth}</div>
                                <button type="button" onClick={() => { setCalSel(null); setCalOpen(true); }} aria-label="Jump to a date"
                                    className="rounded-full p-1.5 text-slate-700 hover:bg-slate-100"><Calendar className="h-5 w-5" /></button>
                            </div>
                        )}

                        {/* The day-grouped, scrollable list of large slot cards */}
                        <div ref={listRef} onScroll={onListScroll} className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4">
                            {days.length === 0 ? (
                                <p className="py-8 text-center text-sm text-slate-500">No times available just now — check back soon.</p>
                            ) : days.map((d) => (
                                <div key={d.date} ref={(el) => { if (el) dayEls.current.set(d.date, el); else dayEls.current.delete(d.date); }} className="mb-5 last:mb-0">
                                    <div className="mb-2 text-sm font-semibold text-slate-900">{dayHeadingLabel(d.date, today, tomorrow)}</div>
                                    <div className="space-y-2">
                                        {d.list.map((o) => {
                                            const a = availOf(o);
                                            const ok = fits(o);
                                            const on = o.key === selKey;
                                            const declared = o.kind === 'declared';
                                            const cap = o.row ? o.row.capacity : 0;
                                            const left = a.seatsLeft;
                                            const shared = !!item && perPerson;
                                            return (
                                                <button key={o.key} type="button" disabled={!ok} onClick={() => setSelKey(o.key)}
                                                    className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition ${on ? (declared ? 'border-violet-600 ring-1 ring-violet-600' : 'border-slate-900 ring-1 ring-slate-900') : declared ? 'border-violet-200 hover:border-violet-400' : 'border-slate-200 hover:border-slate-400'} ${!ok ? 'cursor-not-allowed opacity-45' : ''}`}>
                                                    <span className="min-w-0 flex-1">
                                                        {declared && o.title && <span className="block truncate text-[15px] font-semibold text-slate-900">{o.title}</span>}
                                                        <span className={`block ${declared && o.title ? 'text-sm text-slate-500' : 'text-[15px] font-semibold text-slate-900'}`}>{timeLabel(o.time + ':00')}</span>
                                                        {item && <span className="mt-0.5 block text-xs text-slate-500">{priceEach}</span>}
                                                    </span>
                                                    <span className="flex-none text-right text-xs font-semibold">
                                                        {!ok
                                                            ? <span className="text-slate-400">{a.reason === 'other-mode' ? 'Unavailable' : 'Full'}</span>
                                                            : shared
                                                                ? <span className={left <= 2 ? 'text-amber-700' : declared ? 'text-violet-700' : 'text-emerald-700'}>{declared ? `${left} of ${cap} left` : left <= 3 ? `${left} left` : 'Available'}</span>
                                                                : <span className="text-slate-400">{declared ? 'Available' : ''}</span>}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Travelling address + food allergy, shown only when they apply */}
                        {(travels || isFood) && (
                            <div className="space-y-3 border-t border-slate-100 px-5 py-4">
                                {travels && (
                                    <label className="block">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where should {who} come?</span>
                                        <textarea value={address} onChange={(e) => setAddress(e.target.value.slice(0, 300))} rows={2} placeholder="The address they travel to"
                                            className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-600" />
                                    </label>
                                )}
                                {isFood && (
                                    <label className="block">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allergies or dietary needs <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></span>
                                        <textarea value={allergy} onChange={(e) => setAllergy(e.target.value.slice(0, 500))} rows={2} placeholder="Anything they should cook around"
                                            className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-600" />
                                    </label>
                                )}
                            </div>
                        )}

                        {/* Footer: total + one CTA → Stripe Checkout */}
                        <div className="border-t border-slate-100 px-5 py-4">
                            {error && <p className="mb-2 text-sm text-rose-700">{error}</p>}
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-sm text-slate-600">
                                    {selected
                                        ? <><span className="font-semibold text-slate-900">£{lineTotal.toFixed(2)}</span> total</>
                                        : <span className="text-slate-400">Pick a time</span>}
                                </div>
                                <button type="button" onClick={submit} disabled={!canBook || busy}
                                    className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white hover:bg-black disabled:opacity-40">
                                    {busy ? 'Starting…' : 'Book'}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
