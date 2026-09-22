'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Minus, Plus } from 'lucide-react';
import { unitMultiplies, orderTotal, MAX_ORDER_QUANTITY } from '@/lib/serviceOrders';
import { hasExtraGuests, partyPrice, partyCeiling, extraGuestsLine } from '@/lib/extraGuests';
import { childrenAllowed } from '@/lib/guestAges';
import { prettyTime } from '@/lib/offeredTimes';
import { itemPriceLabel, dateLabel } from '@/components/marketplace/present';
import { londonDayKey } from '@/lib/dayKey';
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
// days. Inside: the option, the guest count, the calendar, the time (from the
// provider's opening hours) and, standalone, the address; a running total; and one
// Book button. Modelled on the slot dialog so the two read as one product.
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
    const [date, setDate] = useState<string>(initialDate && calDays.has(initialDate) ? initialDate : '');
    const [time, setTime] = useState<string>('');
    const [address, setAddress] = useState('');
    const [allergy, setAllergy] = useState('');

    const kidsOk = childrenAllowed(minAge);
    useEffect(() => { if (!kidsOk) { setChildren(0); setChildrenShown(false); } }, [kidsOk]);

    const item = ordered.find((i) => i.id === itemId) || ordered[0] || null;
    const eg = egOf(item);
    const isExtra = !!eg && hasExtraGuests(eg);
    const perPerson = !!item && unitMultiplies(item.unit);
    const showGuests = isExtra || perPerson;
    const minPeople = perPerson && item ? Math.max(1, Number(item.minPeople ?? 1) || 1) : 1;
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

    const total = requestPrice(item, adults, kidsOk ? children : 0, minAge ?? null);
    const egText = eg ? extraGuestsLine(eg as any, minAge ?? null) : null;

    const timesForDate = date ? (timesByDate[date] || []) : [];
    // Keep a selected time valid as the date changes.
    useEffect(() => { if (time && !timesForDate.includes(time)) setTime(''); /* eslint-disable-next-line */ }, [date]);

    // Esc + background scroll lock.
    const bodyRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [onClose]);

    const canBook = !!item && !!date && !!time && (!needsAddress || !!address.trim());
    const submit = () => {
        if (!canBook || !item) return;
        onBook({ itemId: item.id, date, time, adults, children: kidsOk ? children : 0, address: address.trim(), allergy: allergy.trim() });
    };

    const incDisabled = Number.isFinite(partyCap) && people >= (partyCap as number);

    return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pb-8 pt-20 sm:pt-28" role="dialog" aria-modal="true" aria-label="Choose a date"
            onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div className="my-auto flex max-h-[calc(100dvh-7rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
                <div className="flex flex-none items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h2 className="text-lg font-bold text-slate-900">Choose a date</h2>
                    <button type="button" onClick={() => !busy && onClose()} aria-label="Close" className="rounded-full p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>

                <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    {ordered.length > 1 && (
                        <fieldset className="min-w-0">
                            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose</legend>
                            <div className="mt-2 space-y-1.5">
                                {ordered.map((it) => (
                                    <label key={it.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${itemId === it.id ? 'border-emerald-600 bg-emerald-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
                                        <input type="radio" name="req-item" checked={itemId === it.id} onChange={() => setItemId(it.id)} className="accent-emerald-600" />
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{it.name}</span>
                                        <span className="whitespace-nowrap text-sm font-semibold text-slate-900">{itemPriceLabel(it.price, it.unit)}</span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    )}

                    {showGuests && (
                        <div className={ordered.length > 1 ? 'mt-4' : ''}>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Guests</div>
                            <div className="mt-1">
                                <GuestRow label="Adults" sub="Age 13+" value={adults} floor={Math.max(1, minPeople - (kidsOk ? children : 0))} incDisabled={incDisabled} onChange={setAdults} />
                                {childrenShown && kidsOk && (
                                    <GuestRow label="Children" sub="Ages 4–12" value={children} floor={0} incDisabled={incDisabled} onChange={setChildren} />
                                )}
                                {!childrenShown && kidsOk && (
                                    <button type="button" onClick={() => setChildrenShown(true)}
                                        className="mt-1.5 text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900">Add children</button>
                                )}
                                {egText && <p className="mt-1 text-xs text-slate-400">{egText}</p>}
                            </div>
                        </div>
                    )}

                    <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Pick a date</div>
                    <div className="mt-1">
                        <MonthCalendar availableDays={calDays} selected={date || null} onSelect={(d) => setDate(d)} today={londonDayKey()} />
                    </div>

                    {date && (
                        timesForDate.length > 0 ? (
                            <>
                                <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Pick a time</div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {timesForDate.map((t) => (
                                        <button key={t} type="button" onClick={() => setTime(t)}
                                            className={`rounded-lg border px-3 py-2 text-sm font-medium ${time === t ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                                            {prettyTime(t)}
                                        </button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p className="mt-2 text-sm text-slate-500">No times on {dateLabel(date)} — try another date.</p>
                        )
                    )}

                    {needsAddress && (
                        <label className="mt-4 block">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where should {who} come?</span>
                            <textarea value={address} onChange={(e) => setAddress(e.target.value.slice(0, 300))} rows={2} placeholder="The address for your booking"
                                className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                        </label>
                    )}

                    {isFood && (
                        <label className="mt-4 block">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allergies or dietary needs <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></span>
                            <textarea value={allergy} onChange={(e) => setAllergy(e.target.value.slice(0, 500))} rows={2} placeholder="Anything they should cook around"
                                className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                        </label>
                    )}
                </div>

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
