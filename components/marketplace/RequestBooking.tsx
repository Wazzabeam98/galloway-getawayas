'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X, Minus, Plus, Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import { unitMultiplies, orderTotal, MAX_ORDER_QUANTITY } from '@/lib/serviceOrders';
import { hasExtraGuests, partyPrice, partyCeiling, extraGuestsLine } from '@/lib/extraGuests';
import { childrenAllowed } from '@/lib/guestAges';
import { prettyTime } from '@/lib/offeredTimes';
import { itemPriceLabel, dateLabel, dayHeadingLabel, monthYearLabel } from '@/components/marketplace/present';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { hasUkPostcode } from '@/lib/postcode';
import MonthCalendar from '@/components/marketplace/MonthCalendar';

export interface RequestItem {
    id: string; name: string; description: string | null; price: number; unit: string;
    minPeople?: number | null;
    includedGuests?: number | null; extraAdultFee?: number | null; extraChildFee?: number | null; maxParty?: number | null;
}

// The adults/children of an item, as the extra-guests helpers want them (snake_case).
function egOf(it: RequestItem | null) {
    return it ? {
        unit: it.unit, price: it.price,
        included_guests: it.includedGuests ?? null,
        extra_adult_fee: it.extraAdultFee ?? null,
        extra_child_fee: it.extraChildFee ?? null,
        max_party: it.maxParty ?? null,
    } : null;
}

// THE price for ONE (item, party) — the single definition the dialog, the footer
// and the submit all read, so the number shown is the number booked. Order of
// choosing (item first or count first) can't change it: it is a pure function of
// the current item and the current adults/children.
//   • extra-guests item → base for the included heads, per-head fees beyond it
//   • per-person item   → unit price × heads
//   • flat item         → the flat price (heads don't apply)
export function requestPrice(it: RequestItem | null, adults: number, children: number, minAge: number | null | undefined): number {
    if (!it) return 0;
    const eg = egOf(it);
    if (eg && hasExtraGuests(eg)) return partyPrice(eg as any, adults, childrenAllowed(minAge) ? children : 0, minAge ?? null);
    if (unitMultiplies(it.unit)) return orderTotal(it.price, Math.max(1, adults + (childrenAllowed(minAge) ? children : 0)));
    return it.price;
}

// The smallest party this item takes — the provider's per-item minimum (min_people),
// floored at one. Used to hold the stepper and to show "Minimum N guests".
export function itemMinPeople(it: RequestItem | null): number {
    return it && unitMultiplies(it.unit) ? Math.max(1, Number(it.minPeople ?? 1) || 1) : 1;
}

// A guest stepper row, at module scope so it keeps its identity across the
// dialog's renders (an inline component remounts on every click, which loses
// focus and makes a count look like it isn't changing).
function GuestRow({ label, sub, value, floor, incDisabled, onChange }: {
    label: string; sub: string; value: number; floor: number; incDisabled: boolean; onChange: (n: number) => void;
}) {
    return (
        <div className="flex items-center justify-between py-1.5">
            <div>
                <div className="text-sm font-medium text-slate-800">{label}</div>
                <div className="text-xs text-slate-400">{sub}</div>
            </div>
            <div className="flex items-center gap-3">
                <button type="button" aria-label={'Fewer ' + label.toLowerCase()} disabled={value <= floor}
                    onClick={() => onChange(Math.max(floor, value - 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-700 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                <span className="w-6 text-center text-sm font-semibold">{value}</span>
                <button type="button" aria-label={'More ' + label.toLowerCase()} disabled={incDisabled}
                    onClick={() => onChange(value + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-700 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
            </div>
        </div>
    );
}

export interface RequestBookArgs {
    itemId: string; date: string; time: string;
    // The party as a split; the caller derives the money fields it sends from the
    // item's own kind so the request matches the total shown.
    adults: number; children: number;
    address: string; allergy: string;
}

// The FULL picker for a comes-to-you request, in a dialog — the compact box only
// shows a price, a cancellation line, a "Show dates" button and a few suggested
// days. Built to the SAME shape as the slot dialog: the option and guest count on
// top, then a scrolling LIST of the next available days (a calendar icon by the
// month heading opens the full month grid), each day expanding to its times.
export function RequestBookingDialog({
    who, items, minAge, isFood, needsAddress, calDays, timesByDate, cottageGuests, providerMax, prefillAdults, prefillChildren,
    initialDate, busy, error, onBook, onClose,
}: {
    who: string;
    items: RequestItem[];
    minAge?: number | null;
    isFood?: boolean;
    needsAddress?: boolean;
    calDays: Set<string>;
    timesByDate: Record<string, string[]>;
    cottageGuests?: number;
    providerMax?: number | null;
    prefillAdults?: number | null;
    prefillChildren?: number | null;
    initialDate?: string | null;
    busy: boolean;
    error: string | null;
    onBook: (args: RequestBookArgs) => void;
    onClose: () => void;
}) {
    const ordered = useMemo(() => [...items].sort((a, b) => a.price - b.price), [items]);
    const [itemId, setItemId] = useState<string>(ordered[0]?.id || '');
    const [adults, setAdults] = useState<number>(Math.max(1, Number(prefillAdults) || 1));
    const [children, setChildren] = useState<number>(Math.max(0, Number(prefillChildren) || 0));
    const [childrenShown, setChildrenShown] = useState<boolean>(!!(prefillChildren && prefillChildren > 0));
    const [date, setDate] = useState<string>('');
    const [time, setTime] = useState<string>('');
    const [address, setAddress] = useState('');
    const [allergy, setAllergy] = useState('');

    // The month-jump calendar behind the calendar icon, and the one day expanded
    // in the list at a time — exactly as the slot dialog does it.
    const [calOpen, setCalOpen] = useState(false);
    const [calSel, setCalSel] = useState<string | null>(null);
    const [expandedDate, setExpandedDate] = useState<string | null>(null);
    const [headerMonth, setHeaderMonth] = useState('');

    const kidsOk = childrenAllowed(minAge);
    useEffect(() => { if (!kidsOk) { setChildren(0); setChildrenShown(false); } }, [kidsOk]);

    const item = ordered.find((i) => i.id === itemId) || ordered[0] || null;
    const eg = egOf(item);
    const isExtra = !!eg && hasExtraGuests(eg);
    const perPerson = !!item && unitMultiplies(item.unit);
    const showGuests = isExtra || perPerson;
    const minPeople = itemMinPeople(item);
    const people = adults + (kidsOk ? children : 0);

    // Keep the party at or above the per-person minimum by topping up adults — the
    // count carries across an item switch (the whole point of one shared count).
    useEffect(() => { setAdults((a) => Math.max(a, minPeople - (kidsOk ? children : 0))); /* eslint-disable-next-line */ }, [minPeople]);

    const stayCap = cottageGuests && cottageGuests > 0 ? cottageGuests : Infinity;
    const partyCap = isExtra
        ? Math.min(partyCeiling(eg as any), stayCap)
        : perPerson
            ? Math.min(stayCap, providerMax && providerMax > 0 ? providerMax : MAX_ORDER_QUANTITY)
            : Infinity;
    const incDisabled = Number.isFinite(partyCap) && people >= (partyCap as number);

    const total = requestPrice(item, adults, kidsOk ? children : 0, minAge ?? null);
    const egText = eg ? extraGuestsLine(eg as any, minAge ?? null) : null;
    const priceEach = item ? itemPriceLabel(item.price, item.unit) : '';

    const today = londonDayKey();
    const tomorrow = shiftDayKey(today, 1);
    // The available days, each with its start times, oldest first.
    const days = useMemo(() => Array.from(calDays)
        .filter((d) => (timesByDate[d] || []).length > 0)
        .sort()
        .map((d) => ({ date: d, times: timesByDate[d] })), [calDays, timesByDate]);
    // Only the next few are listed; the calendar icon (or "More dates") opens the
    // full month for anything further out — exactly the slot dialog's shape. If a
    // date further out is picked from the calendar, the list grows to reach it so
    // the picked day (and its times) is shown.
    const listDays = useMemo(() => {
        const idx = date ? days.findIndex((d) => d.date === date) : -1;
        return days.slice(0, Math.max(10, idx + 1));
    }, [days, date]);

    // Keep a selected time valid as the item (and so its cap) changes; a day with
    // no times can't stay selected.
    const timesForSelected = date ? (timesByDate[date] || []) : [];
    useEffect(() => { if (time && !timesForSelected.includes(time)) setTime(''); /* eslint-disable-next-line */ }, [date]);

    // ---- the day-list scroll machinery, mirrored from the slot dialog ----------
    const listRef = useRef<HTMLDivElement | null>(null);
    const dayEls = useRef<Map<string, HTMLDivElement>>(new Map());
    const pendingScroll = useRef<string | null>(null);

    useEffect(() => { if (days.length) setHeaderMonth(monthYearLabel(days[0].date)); }, [days]);
    const onListScroll = () => {
        const el = listRef.current; if (!el) return;
        const top = el.scrollTop + 4;
        let current = listDays[0]?.date;
        for (const d of listDays) { const node = dayEls.current.get(d.date); if (node && node.offsetTop <= top) current = d.date; else break; }
        if (current) setHeaderMonth(monthYearLabel(current));
    };
    const focusDay = (d: string) => { setExpandedDate(d); setDate(d); setHeaderMonth(monthYearLabel(d)); pendingScroll.current = d; };
    useLayoutEffect(() => {
        const target = pendingScroll.current;
        if (!target || calOpen) return;
        const el = listRef.current; const node = dayEls.current.get(target);
        if (el && node) { el.scrollTop = node.offsetTop - 4; pendingScroll.current = null; }
    });
    // Opened from a suggested day in the panel: open with it expanded.
    useLayoutEffect(() => {
        if (calOpen || !initialDate) return;
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

    // Esc + background scroll lock.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (calOpen) setCalOpen(false); else onClose(); } };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [onClose, calOpen]);

    const addressOk = !needsAddress || hasUkPostcode(address);
    const canBook = !!item && !!date && !!time && addressOk;
    const submit = () => {
        if (!canBook || !item) return;
        onBook({ itemId: item.id, date, time, adults, children: kidsOk ? children : 0, address: address.trim(), allergy: allergy.trim() });
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pb-8 pt-20 sm:pt-28" role="dialog" aria-modal="true" aria-label="Choose a time"
            onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div className="my-auto flex max-h-[calc(100dvh-7rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
                <div className="flex flex-none items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h2 className="text-lg font-bold text-slate-900">{calOpen ? 'Choose a date' : 'Choose a time'}</h2>
                    <button type="button" onClick={() => (calOpen ? setCalOpen(false) : (!busy && onClose()))} aria-label="Close" className="rounded-full p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>

                {calOpen ? (
                    <>
                        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
                            <MonthCalendar availableDays={calDays} selected={calSel} onSelect={setCalSel} today={today} />
                        </div>
                        <div className="border-t border-slate-100 px-5 py-4">
                            <button type="button" onClick={applyCalPick} disabled={!calSel}
                                className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-black disabled:opacity-40">
                                Next
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        {/* One scrolling body — option, guests, the day list (with a
                            sticky month header + calendar-jump icon) and, when they
                            apply, the address and allergy — so the list has room and
                            the month heading stays in view as it scrolls. */}
                        <div ref={listRef} onScroll={onListScroll} className="min-h-0 flex-1 overflow-y-auto">
                            <div className="border-b border-slate-100 px-5 py-4">
                                {ordered.length > 1 && (
                                    <div className="mb-3">
                                        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Option</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {ordered.map((it) => (
                                                <button key={it.id} type="button" onClick={() => setItemId(it.id)}
                                                    className={`rounded-full border px-3 py-1.5 text-sm font-medium ${itemId === it.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>
                                                    {it.name} · {itemPriceLabel(it.price, it.unit)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {showGuests && (
                                    <div>
                                        <div className="mb-1 flex items-center justify-between">
                                            <div className="text-sm font-semibold text-slate-900">Guests</div>
                                            <div className="text-sm text-slate-500">{people} {people === 1 ? 'person' : 'people'}{perPerson ? '' : ' — the whole session is yours'}</div>
                                        </div>
                                        <GuestRow label="Adults" sub="Age 13+" value={adults} floor={Math.max(1, minPeople - (kidsOk ? children : 0))} incDisabled={incDisabled} onChange={setAdults} />
                                        {childrenShown && kidsOk && (
                                            <GuestRow label="Children" sub="Ages 4–12" value={children} floor={0} incDisabled={incDisabled} onChange={setChildren} />
                                        )}
                                        {!childrenShown && kidsOk && (
                                            <button type="button" onClick={() => setChildrenShown(true)}
                                                className="mt-1.5 text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900">Add children</button>
                                        )}
                                        {minPeople > 1 && (
                                            <div className="mt-1 text-xs text-slate-400">Minimum {minPeople} guests.</div>
                                        )}
                                        {egText && <p className="mt-1 text-xs text-slate-400">{egText}</p>}
                                    </div>
                                )}
                            </div>

                            {/* Sticky month header + calendar-jump icon */}
                            {days.length > 0 && (
                                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
                                    <div className="text-base font-semibold text-slate-900">{headerMonth}</div>
                                    <button type="button" onClick={() => { setCalSel(null); setCalOpen(true); }} aria-label="Jump to a date"
                                        className="rounded-full p-1.5 text-slate-700 hover:bg-slate-100"><Calendar className="h-5 w-5" /></button>
                                </div>
                            )}

                            {/* The day-grouped list */}
                            <div className="px-5 pb-2">
                                {listDays.length === 0 ? (
                                    <p className="py-8 text-center text-sm text-slate-500">No dates available just now — check back soon.</p>
                                ) : listDays.map((d) => {
                                    const isOpen = d.date === expandedDate;
                                    const n = d.times.length;
                                    return (
                                        <div key={d.date} ref={(el) => { if (el) dayEls.current.set(d.date, el); else dayEls.current.delete(d.date); }} className="border-b border-slate-100 last:border-b-0">
                                            <button type="button" onClick={() => { setExpandedDate(isOpen ? null : d.date); if (!isOpen) setDate(d.date); }}
                                                className="flex w-full items-center justify-between gap-3 py-3.5 text-left">
                                                <span className="text-[15px] font-semibold text-slate-900">{dayHeadingLabel(d.date, today, tomorrow)}</span>
                                                <span className="flex flex-none items-center gap-2 text-sm text-slate-500">
                                                    <span>{n} time{n === 1 ? '' : 's'}</span>
                                                    <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                                                </span>
                                            </button>
                                            {isOpen && (
                                                <div className="space-y-2 pb-4">
                                                    {d.times.map((t) => {
                                                        const on = date === d.date && time === t;
                                                        return (
                                                            <button key={t} type="button" onClick={() => { setDate(d.date); setTime(t); }}
                                                                className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-400'}`}>
                                                                <span className="min-w-0 flex-1">
                                                                    <span className="block text-[15px] font-semibold text-slate-900">{prettyTime(t)}</span>
                                                                    {item && <span className="mt-0.5 block text-xs text-slate-500">{priceEach}</span>}
                                                                </span>
                                                                <span className="flex-none text-right text-xs font-semibold text-emerald-700">Available</span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {days.length > listDays.length && (
                                    <button type="button" onClick={() => { setCalSel(null); setCalOpen(true); }}
                                        className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400">
                                        More dates
                                    </button>
                                )}
                            </div>

                            {/* Address + allergy, shown only when they apply */}
                            {(needsAddress || isFood) && (
                                <div className="space-y-3 border-t border-slate-100 px-5 py-4">
                                    {needsAddress && (
                                        <label className="block">
                                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where should {who} come?</span>
                                            <textarea value={address} onChange={(e) => setAddress(e.target.value.slice(0, 300))} rows={2} placeholder="Full address, including postcode"
                                                className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                                            {address.trim() && !hasUkPostcode(address) && (
                                                <span className="mt-1 block text-xs text-rose-600">Please give a full address, including a postcode.</span>
                                            )}
                                        </label>
                                    )}
                                    {isFood && (
                                        <label className="block">
                                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allergies or dietary needs <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></span>
                                            <textarea value={allergy} onChange={(e) => setAllergy(e.target.value.slice(0, 500))} rows={2}
                                                className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                                        </label>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer: total + Send request */}
                        <div className="flex-none border-t border-slate-100 px-5 py-4">
                            {error && <p className="mb-2 text-sm text-rose-700">{error}</p>}
                            <div className="mb-3 flex items-baseline justify-between">
                                <span className="text-sm font-medium text-slate-600">Total</span>
                                <span className="text-lg font-semibold text-slate-900">£{total.toFixed(2)}</span>
                            </div>
                            <button type="button" onClick={submit} disabled={busy || !canBook}
                                className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                                {busy ? 'Sending…' : 'Send request'}
                            </button>
                            <p className="mt-2 text-xs text-slate-400">Your card is held, not charged, until {who} confirms.</p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// A DATE-ONLY picker dialog (made-to-order), the same shape as the slot dialog:
// the next few available days listed, a calendar icon by the month heading that
// opens the full month grid. Picking a day (in the list or the grid) sets it and
// closes.
export function DateOnlyDialog({ title, availableDays, selected, onSelect, onClose, listLimit = 14 }: {
    title: string;
    availableDays: Set<string>;
    selected: string | null;
    onSelect: (dateKey: string) => void;
    onClose: () => void;
    listLimit?: number;
}) {
    const [calOpen, setCalOpen] = useState(false);
    const [calSel, setCalSel] = useState<string | null>(null);
    const [headerMonth, setHeaderMonth] = useState('');
    const today = londonDayKey();
    const tomorrow = shiftDayKey(today, 1);
    const allDays = useMemo(() => Array.from(availableDays).sort(), [availableDays]);
    const listDays = useMemo(() => allDays.slice(0, listLimit), [allDays, listLimit]);

    const listRef = useRef<HTMLDivElement | null>(null);
    const dayEls = useRef<Map<string, HTMLDivElement>>(new Map());
    useEffect(() => { if (listDays.length) setHeaderMonth(monthYearLabel(listDays[0])); }, [listDays]);
    const onListScroll = () => {
        const el = listRef.current; if (!el) return;
        const top = el.scrollTop + 4;
        let current = listDays[0];
        for (const d of listDays) { const node = dayEls.current.get(d); if (node && node.offsetTop <= top) current = d; else break; }
        if (current) setHeaderMonth(monthYearLabel(current));
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (calOpen) setCalOpen(false); else onClose(); } };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [onClose, calOpen]);

    return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pb-8 pt-20 sm:pt-28" role="dialog" aria-modal="true" aria-label={title}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="my-auto flex max-h-[calc(100dvh-7rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
                <div className="flex flex-none items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h2 className="text-lg font-bold text-slate-900">{calOpen ? 'Choose a date' : title}</h2>
                    <button type="button" onClick={() => (calOpen ? setCalOpen(false) : onClose())} aria-label="Close" className="rounded-full p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>
                {calOpen ? (
                    <>
                        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
                            <MonthCalendar availableDays={availableDays} selected={calSel} onSelect={setCalSel} today={today} />
                        </div>
                        <div className="border-t border-slate-100 px-5 py-4">
                            <button type="button" onClick={() => { if (calSel) { onSelect(calSel); } }} disabled={!calSel}
                                className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-black disabled:opacity-40">
                                Next
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        {listDays.length > 0 && (
                            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                                <div className="text-base font-semibold text-slate-900">{headerMonth}</div>
                                <button type="button" onClick={() => { setCalSel(null); setCalOpen(true); }} aria-label="Jump to a date"
                                    className="rounded-full p-1.5 text-slate-700 hover:bg-slate-100"><Calendar className="h-5 w-5" /></button>
                            </div>
                        )}
                        <div ref={listRef} onScroll={onListScroll} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                            {listDays.length === 0 ? (
                                <p className="py-8 text-center text-sm text-slate-500">No dates available just now.</p>
                            ) : listDays.map((d) => (
                                <div key={d} ref={(el) => { if (el) dayEls.current.set(d, el); else dayEls.current.delete(d); }} className="border-b border-slate-100 last:border-b-0">
                                    <button type="button" onClick={() => onSelect(d)}
                                        className={`flex w-full items-center justify-between gap-3 py-3.5 text-left ${selected === d ? 'text-slate-900' : ''}`}>
                                        <span className="text-[15px] font-semibold text-slate-900">{dayHeadingLabel(d, today, tomorrow)}</span>
                                        <ChevronRight className="h-4 w-4 flex-none text-slate-400" aria-hidden />
                                    </button>
                                </div>
                            ))}
                            {allDays.length > listDays.length && (
                                <button type="button" onClick={() => { setCalSel(null); setCalOpen(true); }}
                                    className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400">
                                    More dates
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// The next few available DATES, shown in the compact box — the request-shape twin
// of the slot DatePreview. Each opens the dialog on that day.
export function RequestDatePreview({ calDays, timesByDate, limit = 4, busy, onPickDay }: {
    calDays: Set<string>; timesByDate: Record<string, string[]>; limit?: number; busy: boolean; onPickDay: (date: string) => void;
}) {
    const days = useMemo(() => Array.from(calDays).filter((d) => (timesByDate[d] || []).length > 0).sort().slice(0, limit), [calDays, timesByDate, limit]);
    if (!days.length) return null;
    return (
        <div className="mt-4 space-y-2">
            {days.map((d) => {
                const times = timesByDate[d] || [];
                const hint = times.length === 1 ? prettyTime(times[0]) : 'from ' + prettyTime(times[0]);
                return (
                    <button key={d} type="button" disabled={busy} onClick={() => onPickDay(d)}
                        className="flex w-full items-end justify-between gap-3 rounded-2xl border border-slate-200 p-4 text-left transition hover:border-slate-400 disabled:opacity-60">
                        <span className="min-w-0">
                            <span className="block whitespace-nowrap text-[15px] font-semibold text-slate-900">{dateLabel(d)}</span>
                            <span className="mt-0.5 block truncate text-sm text-slate-500">{hint}</span>
                        </span>
                        <span className="flex-none whitespace-nowrap text-right text-sm text-slate-500">{times.length} time{times.length === 1 ? '' : 's'}</span>
                    </button>
                );
            })}
        </div>
    );
}
