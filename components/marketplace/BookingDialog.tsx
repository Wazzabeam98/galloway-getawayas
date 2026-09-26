'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X, Minus, Plus, Calendar, ChevronDown } from 'lucide-react';
import { optionAvailability, seatConfig } from '@/lib/serviceSlots';
import { unitMultiplies, MAX_ORDER_QUANTITY } from '@/lib/serviceOrders';
import { childrenAllowed } from '@/lib/guestAges';
import { itemPriceLabel, timeLabel, monthYearLabel, dayHeadingLabel } from '@/components/marketplace/present';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import MonthCalendar from '@/components/marketplace/MonthCalendar';
import TravelAddressModal from '@/components/marketplace/TravelAddressModal';
import type { AddressParts } from '@/components/address/AddressLookup';

export interface DialogItem { id: string; name: string; price: number; unit: string; fulfilment?: string | null; capacity?: number | null; minPeople?: number | null; }
export interface DialogOpenSession { date: string; time: string; row: { capacity: number; seats_taken: number; private: boolean } | null; }
export interface DialogDeclared { id: string; date: string; time: string; duration: number; capacity: number; seats_taken: number; private: boolean; title: string | null; }

export interface BookArgs { itemId: string; date: string; time: string; quantity: number; attendees?: number; adults?: number; children?: number; serviceAddress?: string; allergy?: string; }

// A merged, sortable offering — an open-hours slot or a declared session — so the
// dialog reads one chronological timetable per day.
interface Offering {
    key: string; date: string; time: string; kind: 'open' | 'declared';
    title: string | null; row: { capacity: number; seats_taken: number; private: boolean } | null;
}

// THE "SHOW DATES" DIALOG — the Airbnb-shaped availability picker, shared by both
// booking panels. A guest sets how many people, then either scrolls the timetable
// (every available date, grouped by day, a card per time) or taps the calendar
// icon by the month header to jump straight to a date. A declared session is the
// same card at the same standard, marked as a named event (violet + its title).
// Selecting a slot and pressing Book goes straight to Stripe Checkout — the panel's
// onBook does the POST + redirect; no contact is collected here (Checkout does that).
export default function BookingDialog({
    who, items, sessions, sessionsForItem, declaredSessions, providerCapacity, providerMinPeople, providerFulfilment, isFood, minAge, initialDate, prefillAdults, prefillChildren, busy, error, onBook, onClose,
}: {
    who: string;
    // The provider's minimum age (null / 12 / 16 / 18 / 21). 16+ takes no children
    // (the 4–12 band is all below it), so no Children stepper and no "Add children".
    minAge?: number | null;
    // The party to default the steppers to — from the guest's cottage booking
    // when there is one. Null = no prefill, start at one adult. Clamped to what's
    // bookable; if the party exceeds that, we prefill the maximum as ALL ADULTS
    // and let the guest split it, rather than the product deciding who comes.
    prefillAdults?: number | null;
    prefillChildren?: number | null;
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
    // Cheapest option first — the one the listing's "From" price quotes — so the
    // dialog opens on it instead of jumping to a pricier default (a whole-session
    // "private" option, say). Derived from price, not hardcoded, so it's right for
    // any provider; a stable sort keeps the provider's own order for equal prices.
    const orderedItems = useMemo(() => [...items].sort((a, b) => a.price - b.price), [items]);
    const [itemId, setItemId] = useState<string>(orderedItems[0]?.id || '');
    // The party as an adults/children SPLIT (Airbnb's Adults 13+ / Children 4-12).
    // `people` — the total — is what everything downstream reads, so the capacity
    // and pricing logic below is untouched; only how the total is entered changed.
    const [adults, setAdults] = useState<number>(1);
    const [children, setChildren] = useState<number>(0);
    const people = adults + children;
    // Most bookings are adults only, so the Children stepper hides behind an
    // "Add children" link until it's wanted (Airbnb does the same). Once revealed
    // it stays open until the picker closes — dropping back to zero mid-edit must
    // not yank the stepper away. A prefill that carries children opens it up front.
    const [childrenShown, setChildrenShown] = useState<boolean>(false);
    // 16+/18+/21+ experiences take adults only — no Children stepper, no "Add
    // children" link (not a disabled one), and any prefilled children are dropped.
    const kidsOk = childrenAllowed(minAge);
    useEffect(() => { if (!kidsOk) { setChildren(0); setChildrenShown(false); } }, [kidsOk]);
    const [selKey, setSelKey] = useState<string | null>(null);
    // The travelling address is captured through TravelAddressModal now, not a
    // free-text box. `address` stays the composed one-line string everything
    // downstream reads (validation, the serviceAddress sent to the order); the
    // parts are kept only so re-opening the modal shows what was entered.
    const [address, setAddress] = useState('');
    const [addressParts, setAddressParts] = useState<AddressParts | null>(null);
    const [addrModalOpen, setAddrModalOpen] = useState(false);
    const [allergy, setAllergy] = useState('');

    // Month-jump calendar (the calendar icon by the header). `calSel` is the day a
    // guest taps in the grid; "Next" scrolls the list to it.
    const [calOpen, setCalOpen] = useState(false);
    const [calSel, setCalSel] = useState<string | null>(null);

    // The dialog opens on a LIST OF DAYS — which day first, then its times. One day
    // expands at a time; opening another collapses the last. null = all collapsed.
    const [expandedDate, setExpandedDate] = useState<string | null>(null);

    const listRef = useRef<HTMLDivElement | null>(null);
    const dayEls = useRef<Map<string, HTMLDivElement>>(new Map());
    // A day to scroll to once it has expanded (its times change the layout, so the
    // scroll has to wait for the render that follows the expand).
    const pendingScroll = useRef<string | null>(null);

    const item = items.find((i) => i.id === itemId) || orderedItems[0] || null;
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

    const selected = offerings.find((o) => o.key === selKey) || null;
    // Keep the selection valid as the party size / item changes.
    useEffect(() => { if (selected && !fits(selected)) setSelKey(null); /* eslint-disable-next-line */ }, [people, itemId]);

    const minPeople = item && perPerson ? Math.max(1, Number(item.minPeople ?? providerMinPeople) || 1) : 1;

    // The most a session here can take — the largest bookable headcount across the
    // available offerings (seats left for per-person; the session's capacity for a
    // private booking). The steppers cap at this, so a guest can't pick more than a
    // session can hold, and we say why instead of silently allowing an un-bookable
    // number.
    const bookableMax = offerings.reduce((m, o) => { const a = availOf(o); return a.possible ? Math.max(m, a.seatsLeft) : m; }, 0);
    const cap = Math.min(MAX_ORDER_QUANTITY, bookableMax > 0 ? bookableMax : MAX_ORDER_QUANTITY);
    const capLimited = bookableMax > 0 && bookableMax < MAX_ORDER_QUANTITY;

    // Keep the total at or above the minimum by topping up ADULTS — never inventing
    // children.
    useEffect(() => { setAdults((a) => Math.max(a, minPeople - children)); /* eslint-disable-next-line */ }, [minPeople]);

    // Prefill once from the cottage party, clamped to what's bookable. Within the
    // cap we keep the cottage's own split; over the cap we prefill the maximum as
    // ALL ADULTS and let the guest adjust down — the product doesn't decide which
    // of their family comes.
    const prefilled = useRef(false);
    useEffect(() => {
        if (prefilled.current) return;
        if (prefillAdults == null && prefillChildren == null) return;
        prefilled.current = true;
        const pa = Math.max(0, Number(prefillAdults) || 0);
        const pc = kidsOk ? Math.max(0, Number(prefillChildren) || 0) : 0;
        if (pa + pc > cap) { setAdults(Math.max(1, cap)); setChildren(0); }
        else { setAdults(Math.max(1, pa)); setChildren(pc); if (pc > 0) setChildrenShown(true); }
        // eslint-disable-next-line
    }, [cap, prefillAdults, prefillChildren]);

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

    // Expand a day and line it up to scroll to (once its times have rendered).
    const focusDay = (date: string) => {
        setExpandedDate(date);
        setHeaderMonth(monthYearLabel(date));
        pendingScroll.current = date;
    };
    // The pending scroll, run after every render so it lands after the expand.
    useLayoutEffect(() => {
        const target = pendingScroll.current;
        if (!target || calOpen) return;
        const el = listRef.current; const node = dayEls.current.get(target);
        if (el && node) { el.scrollTop = node.offsetTop - 4; pendingScroll.current = null; }
    });

    // Opened from a day card in the panel: the guest already chose the day, so open
    // with it expanded. Opened via "Show all dates": all collapsed, days first.
    useLayoutEffect(() => {
        if (calOpen || !initialDate) return;
        // The day may not have a section (fully booked / past) — nearest on/after it.
        const target = days.find((d) => d.date >= initialDate)?.date;
        if (target) focusDay(target);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applyCalPick = () => {
        if (!calSel) return;
        const target = days.find((d) => d.date >= calSel)?.date || calSel;
        setCalOpen(false);
        focusDay(target);
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
            // The split rides alongside the total — the total still drives money.
            adults, children,
            serviceAddress: travels ? address.trim() : undefined,
            allergy: isFood ? (allergy.trim() || undefined) : undefined,
        });
    };

    const canBook = !!selected && !!item && (!travels || !!address.trim());

    return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pb-8 pt-28" role="dialog" aria-modal="true" aria-label="Show dates" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="my-auto flex max-h-[calc(100dvh-9rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h2 className="text-lg font-bold text-slate-900">{calOpen ? 'Choose a date' : 'Choose a time'}</h2>
                    <button type="button" onClick={() => (calOpen ? setCalOpen(false) : onClose())} aria-label="Close" className="rounded-full p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>

                {calOpen ? (
                    <>
                        {/* Scrollable month grid — the full month so a guest can jump to a
                            date. The same MonthCalendar the request shapes use inline. */}
                        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
                            <MonthCalendar availableDays={availableDays} selected={calSel} onSelect={setCalSel} today={today} />
                        </div>
                        {/* Footer: confirm the picked date */}
                        <div className="border-t border-slate-100 px-5 py-4">
                            <button type="button" onClick={applyCalPick} disabled={!calSel}
                                className="w-full rounded-xl bg-emerald-700 px-6 py-3 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-40">
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
                                        {orderedItems.map((it) => (
                                            <button key={it.id} type="button" onClick={() => { setItemId(it.id); setSelKey(null); }}
                                                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${itemId === it.id ? 'border-emerald-600 bg-emerald-700 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>
                                                {it.name} · {itemPriceLabel(it.price, it.unit)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {/* Adults / children split — a headcount for the
                                provider, not a pricing tier: every seat is the
                                same price. The total drives everything below. */}
                            <div>
                                <div className="mb-1 flex items-center justify-between">
                                    <div className="text-sm font-semibold text-slate-900">Guests</div>
                                    <div className="text-sm text-slate-500">{people} {people === 1 ? 'person' : 'people'}{perPerson ? '' : ' — the whole session is yours'}</div>
                                </div>
                                {[
                                    { key: 'adults', label: 'Adults', sub: 'Age 13+', value: adults, set: setAdults, floor: 1 },
                                    // Children is here only once revealed — and once
                                    // revealed it stays, even at zero, so an edit back
                                    // to nought doesn't snatch the stepper away.
                                    ...(childrenShown && kidsOk ? [{ key: 'children', label: 'Children', sub: 'Ages 4–12', value: children, set: setChildren, floor: 0 }] : []),
                                ].map((row) => (
                                    <div key={row.key} className="flex items-center justify-between py-1.5">
                                        <div>
                                            <div className="text-sm font-medium text-slate-800">{row.label}</div>
                                            <div className="text-xs text-slate-400">{row.sub}</div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button type="button" aria-label={'Fewer ' + row.label.toLowerCase()}
                                                disabled={row.value <= row.floor || people <= minPeople}
                                                onClick={() => row.set((v) => Math.max(row.floor, v - 1))}
                                                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-700 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                                            <span className="w-6 text-center text-sm font-semibold">{row.value}</span>
                                            <button type="button" aria-label={'More ' + row.label.toLowerCase()}
                                                disabled={people >= cap}
                                                onClick={() => row.set((v) => v + 1)}
                                                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-700 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                                        </div>
                                    </div>
                                ))}
                                {/* Adults-only by default; reveal the Children stepper on
                                    demand — but only where the provider's minimum age
                                    admits children at all (16+/18+/21+ show nothing). */}
                                {!childrenShown && kidsOk && (
                                    <button type="button" onClick={() => setChildrenShown(true)}
                                        className="mt-1.5 text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900">
                                        Add children
                                    </button>
                                )}
                                {(minPeople > 1 || capLimited) && (
                                    <div className="mt-1 text-xs text-slate-400">
                                        {minPeople > 1 ? `Minimum ${minPeople}. ` : ''}
                                        {capLimited ? `Only ${bookableMax} ${bookableMax === 1 ? 'seat' : 'seats'} left in the sessions here.` : ''}
                                    </div>
                                )}
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
                            ) : days.map((d) => {
                                const isOpen = d.date === expandedDate;
                                const fitCount = d.list.filter(fits).length;
                                return (
                                <div key={d.date} ref={(el) => { if (el) dayEls.current.set(d.date, el); else dayEls.current.delete(d.date); }} className="border-b border-slate-100 last:border-b-0">
                                    {/* The day — tap to expand its times, collapsing the last. */}
                                    <button type="button" onClick={() => setExpandedDate(isOpen ? null : d.date)}
                                        className="flex w-full items-center justify-between gap-3 py-3.5 text-left">
                                        <span className="text-[15px] font-semibold text-slate-900">{dayHeadingLabel(d.date, today, tomorrow)}</span>
                                        <span className="flex flex-none items-center gap-2 text-sm text-slate-500">
                                            <span>{fitCount > 0 ? fitCount + ' time' + (fitCount === 1 ? '' : 's') : 'Fully booked'}</span>
                                            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                                        </span>
                                    </button>
                                    {isOpen && (
                                    <div className="space-y-2 pb-4">
                                        {d.list.map((o) => {
                                            const a = availOf(o);
                                            const ok = fits(o);
                                            const on = o.key === selKey;
                                            const declared = o.kind === 'declared';
                                            // Seats left for a PER-PERSON option, resolved by the same
                                            // optionAvailability the book route claims through — never a raw
                                            // column — so the number can't drift from what the route honours.
                                            // A whole-session (private) hire is one unit, where a seat count is
                                            // meaningless; it just reads free-or-gone below.
                                            const left = a.seatsLeft;
                                            return (
                                                <button key={o.key} type="button" disabled={!ok} onClick={() => setSelKey(o.key)}
                                                    className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition ${on ? (declared ? 'border-violet-600 ring-1 ring-violet-600' : 'border-emerald-600 ring-1 ring-emerald-600') : declared ? 'border-violet-200 hover:border-violet-400' : 'border-slate-200 hover:border-slate-400'} ${!ok ? 'cursor-not-allowed opacity-45' : ''}`}>
                                                    <span className="min-w-0 flex-1">
                                                        {/* The TIME leads every row — it is what a
                                                            guest picks a session by — with the
                                                            session's title after it when a declared
                                                            session carries one. Title first read as a
                                                            heading and pushed the time into small grey
                                                            secondary text. */}
                                                        <span className="flex min-w-0 items-baseline gap-2">
                                                            <span className="flex-none text-[15px] font-semibold text-slate-900">{timeLabel(o.time + ':00')}</span>
                                                            {declared && o.title && <span className="truncate text-sm text-slate-500">{o.title}</span>}
                                                        </span>
                                                        {item && <span className="mt-0.5 block text-xs text-slate-500">{priceEach}</span>}
                                                    </span>
                                                    <span className="flex-none text-right text-xs font-semibold">
                                                        {perPerson
                                                            ? <span className={left === 0 ? 'text-slate-400' : left <= 2 ? 'text-amber-700' : declared ? 'text-violet-700' : 'text-emerald-700'}>{left} spot{left === 1 ? '' : 's'} available</span>
                                                            : ok
                                                                ? <span className="text-emerald-700">Available</span>
                                                                : <span className="text-slate-400">Booked</span>}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    )}
                                </div>
                                );
                            })}
                        </div>

                        {/* Travelling address + food allergy, shown only when they apply */}
                        {(travels || isFood) && (
                            <div className="space-y-3 border-t border-slate-100 px-5 py-4">
                                {travels && (
                                    <div>
                                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where should {who} come?</span>
                                        {address ? (
                                            <div className="mt-1 flex items-start justify-between gap-3 rounded-lg border border-slate-300 px-3 py-2">
                                                <span className="text-sm text-slate-700">{address}</span>
                                                <button type="button" onClick={() => setAddrModalOpen(true)} className="shrink-0 text-sm font-semibold text-emerald-700 hover:text-emerald-800">Edit</button>
                                            </div>
                                        ) : (
                                            <button type="button" onClick={() => setAddrModalOpen(true)}
                                                className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400">
                                                <Plus className="h-4 w-4 flex-none" aria-hidden /> Add address
                                            </button>
                                        )}
                                    </div>
                                )}
                                {isFood && (
                                    <label className="block">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allergies or dietary needs <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></span>
                                        <textarea value={allergy} onChange={(e) => setAllergy(e.target.value.slice(0, 500))} rows={2}
                                            className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-600" />
                                    </label>
                                )}
                            </div>
                        )}

                        {travels && addrModalOpen && (
                            <TravelAddressModal
                                who={who}
                                initial={addressParts}
                                onSave={({ parts, line }) => { setAddressParts(parts); setAddress(line); setAddrModalOpen(false); }}
                                onClose={() => setAddrModalOpen(false)}
                            />
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
                                    className="rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-40">
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
