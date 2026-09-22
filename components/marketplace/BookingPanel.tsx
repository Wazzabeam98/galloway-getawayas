'use client';

import { useCallback, useMemo, useState } from 'react';
import { unitMultiplies, orderTotal, MAX_ORDER_QUANTITY } from '@/lib/serviceOrders';
import { generateSessions, resolvedDuration, type PartialBlock } from '@/lib/serviceSlots';
import { itemPriceLabel, dateLabel, priceParts, cancellationBadge } from '@/components/marketplace/present';
import { hasExtraGuests, partyPrice, partyCeiling } from '@/lib/extraGuests';
import { childrenAllowed } from '@/lib/guestAges';
import { prettyTime } from '@/lib/offeredTimes';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { CalendarDays, Minus, Plus } from 'lucide-react';
import BookingDialog, { type BookArgs, type DialogOpenSession } from '@/components/marketplace/BookingDialog';
import DatePreview from '@/components/marketplace/DatePreview';
import MonthCalendar from '@/components/marketplace/MonthCalendar';
import { extraGuestsLine } from '@/lib/extraGuests';

// The one +/- stepper, at module scope so it keeps its identity across the
// panel's renders. It used to be declared inside BookingPanel, which made React
// remount it on every keystroke/click — the reason a guest count could look like
// it wasn't changing. Same look as the slot dialog's stepper.
function Stepper({ value, set, min, max }: { value: number; set: (n: number) => void; min: number; max: number }) {
    return (
        <span className="inline-flex items-center gap-3">
            <button type="button" aria-label="Fewer" onClick={() => set(Math.max(min, value - 1))} disabled={value <= min}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-700 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
            <span className="w-6 text-center text-sm font-semibold text-slate-900">{value}</span>
            <button type="button" aria-label="More" onClick={() => set(Math.min(max, value + 1))} disabled={value >= max}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-700 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
        </span>
    );
}

interface PanelItem {
    id: string; name: string; description: string | null; price: number; unit: string; image: string | null;
    duration_minutes?: number | null;
    fulfilment?: string | null;
    capacity: number | null;
    minPeople: number | null;
    includedGuests?: number | null;
    extraAdultFee?: number | null;
    extraChildFee?: number | null;
    maxParty?: number | null;
    isCustom?: boolean;
}
interface PanelSession {
    date: string; time: string;
    row: { capacity: number; seats_taken: number; private: boolean } | null;
}
interface PanelBookedBlock {
    date: string; time: string; duration_minutes: number | null; turnaround_minutes: number | null;
    capacity: number; seats_taken: number; private: boolean;
}
interface PanelDeclared { id: string; date: string; time: string; duration: number; capacity: number; seats_taken: number; private: boolean; title: string | null; }
interface PanelProvider {
    id: string; business_name: string; who: string; shape: string; isFood: boolean;
    fulfilment?: string | null;
    items: PanelItem[]; sessions: PanelSession[]; declaredSessions?: PanelDeclared[]; leadTimeDays: number;
    minPeople: number;
    slotCapacity: number;
    perItemDurations?: boolean;
    turnaround?: number;
    slotLength?: number;
    slotAvailability?: Array<{ day_of_week: number; open_time: string; close_time: string }>;
    slotBlocks?: string[];
    partialBlocks?: PartialBlock[];
    bookedBlocks?: PanelBookedBlock[];
    cancellationHours?: number | null;
    noRefund?: boolean | null;
    minAge?: number | null;
    // Request shapes: the times the provider offers, and how far ahead a
    // standalone booking may reach. Empty / unset when not applicable.
    offeredTimes?: string[];
    horizonDays?: number;
    maxGuests?: number | null;
}

const COMMON_ALLERGENS = ['Nuts', 'Peanuts', 'Gluten', 'Dairy', 'Eggs', 'Fish', 'Shellfish', 'Soya', 'Sesame'];
const dayKeyFromNow = (days: number) => shiftDayKey(londonDayKey(), days);
const lastNight = (checkOut: string) => shiftDayKey(String(checkOut).slice(0, 10), -1);
const maxKey = (a: string, b: string) => (a > b ? a : b);

// The booking box a guest sees. Two ways in:
//   • Against a cottage stay (bookingId + checkIn/checkOut given): the date is
//     bounded by the stay and the party capped by who's staying.
//   • Standalone (no booking): bookable by anyone; the date runs to the
//     provider's horizon, the party is capped by the item's own maximum, and a
//     travelling shape (a comes-to-you chef, a delivery order) asks for an
//     address.
// A SLOT provider gets the Airbnb-shaped availability dialog; a REQUEST provider
// (chef/baker) picks a date and time and sends a request that is held, not
// charged, until they confirm.
export default function BookingPanel({ bookingId, checkIn, checkOut, cottageGuests, cottageAdults, cottageChildren, stay, standalone: standaloneProp, provider }: {
    bookingId?: string; checkIn?: string; checkOut?: string; cottageGuests?: number;
    cottageAdults?: number | null; cottageChildren?: number | null;
    stay?: { title: string | null; town: string | null };
    standalone?: boolean;
    provider: PanelProvider;
}) {
    const isSlot = provider.shape === 'slot';
    const isMadeToOrder = provider.shape === 'made_to_order';
    const standalone = standaloneProp ?? !bookingId;
    const [open, setOpen] = useState(false);
    const [initialDate, setInitialDate] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Request-flow state (non-slot only).
    const [itemId, setItemId] = useState<string>(provider.items.length === 1 ? provider.items[0].id : '');
    const [date, setDate] = useState<string>('');
    const [time, setTime] = useState<string>('');
    const [qty, setQty] = useState<number>(1);
    const [adults, setAdults] = useState<number>(cottageAdults && cottageAdults > 0 ? cottageAdults : 1);
    const [children, setChildren] = useState<number>(cottageChildren && cottageChildren > 0 ? cottageChildren : 0);
    const [address, setAddress] = useState<string>('');
    const [allergy, setAllergy] = useState<string>('');
    const [allergyTags, setAllergyTags] = useState<string[]>([]);
    // Made-to-order cart: itemId → quantity. No time — the collection/delivery
    // time is arranged by message after the order is placed.
    const [cart, setCart] = useState<Record<string, number>>({});
    const setCartQty = (id: string, n: number) => setCart((c) => { const next = { ...c }; if (n <= 0) delete next[id]; else next[id] = Math.min(MAX_ORDER_QUANTITY, n); return next; });

    const declaredSessions = provider.declaredSessions || [];
    const reqLead = provider.shape === 'made_to_order' ? Math.max(1, provider.leadTimeDays || 1) : 1;
    const minDate = standalone
        ? dayKeyFromNow(reqLead)
        : maxKey(String(checkIn).slice(0, 10), dayKeyFromNow(provider.shape === 'made_to_order' ? provider.leadTimeDays : 0));
    const maxDate = standalone
        ? dayKeyFromNow(Math.max(1, provider.horizonDays || 90))
        : lastNight(String(checkOut));

    const cheapest = provider.items.length ? provider.items.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    const priceParts_ = cheapest ? priceParts(cheapest.price, cheapest.unit) : null;
    const showFrom = provider.items.length > 1;
    const cancel = cancellationBadge(provider.cancellationHours, provider.noRefund);

    const bookedRowByKey = useMemo(() => {
        const m = new Map<string, PanelSession['row']>();
        for (const b of provider.bookedBlocks || []) m.set(b.date + ' ' + b.time, { capacity: b.capacity, seats_taken: b.seats_taken, private: b.private });
        return m;
    }, [provider.bookedBlocks]);
    const sessionsForItem = useCallback((selItemId: string): DialogOpenSession[] => {
        if (!provider.perItemDurations) return provider.sessions;
        const item = provider.items.find((i) => i.id === selItemId);
        if (!item) return [];
        const dur = resolvedDuration(item, { slot_length_minutes: provider.slotLength });
        const turn = Math.max(0, provider.turnaround || 0);
        const nowMs = Date.now();
        return generateSessions(provider.slotAvailability || [], provider.slotBlocks || [], dur + turn, minDate, maxDate, dur, provider.partialBlocks || [])
            .filter((s) => new Date(s.date + 'T' + s.time + ':00Z').getTime() > nowMs)
            .map((s) => ({ date: s.date, time: s.time, row: bookedRowByKey.get(s.date + ' ' + s.time) || null }));
    }, [provider, minDate, maxDate, bookedRowByKey]);

    const hasSlotAvailability = isSlot && (provider.sessions.length > 0 || declaredSessions.length > 0 || !!provider.perItemDurations);

    async function bookSlot(args: BookArgs) {
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/services/slots/book', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerId: provider.id, itemId: args.itemId, bookingId, sessionDate: args.date, sessionTime: args.time,
                    quantity: args.quantity, attendees: args.attendees,
                    adults: args.adults, children: args.children, allergy: args.allergy,
                }),
            });
            const d = await res.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start that.'); setBusy(false);
        } catch { setError('Could not start that.'); setBusy(false); }
    }

    // Non-slot request flow.
    const reqItem = provider.items.find((i) => i.id === itemId) || null;
    // The extra-guests helpers read snake_case (they run against DB rows too), so
    // adapt the camelCase panel item.
    const egItem = reqItem ? {
        unit: reqItem.unit, price: reqItem.price,
        included_guests: reqItem.includedGuests ?? null,
        extra_adult_fee: reqItem.extraAdultFee ?? null,
        extra_child_fee: reqItem.extraChildFee ?? null,
        max_party: reqItem.maxParty ?? null,
    } : null;
    const reqPerPerson = !!reqItem && unitMultiplies(reqItem.unit);
    const reqExtraGuests = !!egItem && hasExtraGuests(egItem);
    const kidsOk = childrenAllowed(provider.minAge ?? null);
    const reqQty = reqPerPerson ? Math.max(1, Math.min(MAX_ORDER_QUANTITY, Math.floor(qty) || 1)) : 1;
    // The party cap: the item's own ceiling, and — against a stay — never more
    // than are staying.
    const stayCap = standalone ? Infinity : (Number(cottageGuests) || Infinity);
    const partyCap = reqExtraGuests
        ? Math.min(partyCeiling(egItem!), stayCap)
        : Math.min(stayCap, provider.maxGuests && provider.maxGuests > 0 ? provider.maxGuests : Infinity);
    const reqTotal = reqItem
        ? (reqExtraGuests ? partyPrice(egItem!, adults, kidsOk ? children : 0, provider.minAge ?? null) : orderTotal(reqItem.price, reqQty))
        : 0;
    // Travelling shapes (a comes-to-you chef, a delivery item) need somewhere to
    // go; standalone the guest types it, against a stay it's the cottage.
    const travels = provider.shape === 'comes_to_you' || (reqItem && String(reqItem.fulfilment) === 'delivery');
    const needsAddress = standalone && !!travels;
    const offered = provider.offeredTimes || [];

    // Made-to-order cart derived values.
    const cartLines = provider.items.map((it) => ({ it, qty: cart[it.id] || 0 })).filter((l) => l.qty > 0);
    const cartTotal = cartLines.reduce((s, l) => s + l.it.price * l.qty, 0);
    const cartHasCustom = cartLines.some((l) => !!l.it.isCustom);
    const cartDelivers = provider.fulfilment === 'delivery' || (provider.fulfilment === 'both' && cartLines.some((l) => String(l.it.fulfilment) === 'delivery'));
    const cartNeedsAddress = standalone && cartDelivers;
    const deliverWord = cartDelivers ? 'delivery' : 'collection';

    async function sendCart() {
        setError(null);
        if (!cartLines.length) { setError('Add at least one item.'); return; }
        if (!date) { setError('Pick a date.'); return; }
        if (cartNeedsAddress && !address.trim()) { setError('Add the delivery address.'); return; }
        setBusy(true);
        try {
            const trimmedAllergy = [allergyTags.join(', '), allergy.trim()].filter(Boolean).join(allergyTags.length && allergy.trim() ? ' — ' : '');
            const res = await fetch('/api/services/order', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: cartLines.map((l) => ({ itemId: l.it.id, qty: l.qty })),
                    bookingId, serviceDate: date,
                    serviceAddress: cartNeedsAddress ? address.trim() : undefined,
                    allergy: trimmedAllergy,
                }),
            });
            const d = await res.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start that.');
        } catch { setError('Could not start that.'); }
        setBusy(false);
    }

    async function sendRequest() {
        setError(null);
        if (!reqItem) { setError('Pick one first.'); return; }
        if (!date) { setError('Pick a date.'); return; }
        // comes-to-you always picks a time (from opening hours); a legacy
        // offered-times provider still must too.
        if ((provider.shape === 'comes_to_you' || offered.length) && !time) { setError('Pick a time.'); return; }
        if (needsAddress && !address.trim()) { setError('Add the address they should come to.'); return; }
        const party = reqExtraGuests ? adults + (kidsOk ? children : 0) : reqQty;
        if (Number.isFinite(partyCap) && party > partyCap) { setError('That’s more than this experience takes (up to ' + partyCap + ').'); return; }
        setBusy(true);
        try {
            const trimmedAllergy = provider.isFood ? [allergyTags.join(', '), allergy.trim()].filter(Boolean).join(allergyTags.length && allergy.trim() ? ' — ' : '') : '';
            const res = await fetch('/api/services/order', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    itemId: reqItem.id, bookingId, serviceDate: date, serviceTime: time || undefined,
                    quantity: reqQty,
                    adults: reqExtraGuests ? adults : undefined,
                    children: reqExtraGuests ? (kidsOk ? children : 0) : undefined,
                    serviceAddress: needsAddress ? address.trim() : undefined,
                    allergy: trimmedAllergy,
                }),
            });
            const d = await res.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start that.');
        } catch { setError('Could not start that.'); }
        setBusy(false);
    }

    const bookableDays = useMemo(() => {
        const out: string[] = []; let d = minDate;
        for (let i = 0; i < 92 && d <= maxDate; i++) { out.push(d); d = shiftDayKey(d, 1); }
        return out;
    }, [minDate, maxDate]);

    const previewDefault = provider.items.filter((i) => i.price > 0).sort((a, b) => a.price - b.price).find((i) => unitMultiplies(i.unit)) || provider.items[0] || null;
    const previewSessions = provider.perItemDurations && previewDefault ? sessionsForItem(previewDefault.id) : provider.sessions;
    const openOn = (d: string | null) => { setInitialDate(d); setOpen(true); };

    // ---- Request-shape calendar + times -------------------------------------
    // The full MonthCalendar for both request shapes, replacing the old row of
    // three date chips. comes-to-you generates its start times from the
    // provider's weekly opening hours (the single place hours are set) via the
    // same generateSessions the slot grid uses; made-to-order is a DATE ONLY —
    // the collection time is arranged by message afterwards.
    const isComesToYou = provider.shape === 'comes_to_you';
    const reqTimes = useMemo(() => {
        const byDate: Record<string, string[]> = {};
        const days = new Set<string>();
        if (!isComesToYou) return { days, byDate };
        for (const s of generateSessions(provider.slotAvailability || [], provider.slotBlocks || [], 30, minDate, maxDate, 30, provider.partialBlocks || [])) {
            (byDate[s.date] = byDate[s.date] || []).push(s.time);
            days.add(s.date);
        }
        return { days, byDate };
    }, [isComesToYou, provider.slotAvailability, provider.slotBlocks, provider.partialBlocks, minDate, maxDate]);
    // A comes-to-you provider with weekly opening hours drives the calendar and
    // the times off them. If a legacy provider set none, fall back to every day
    // in the window plus any offered_times they'd named (backwards-compatible).
    // Made-to-order: every day in the window is bookable (a date only).
    const useHours = isComesToYou && reqTimes.days.size > 0;
    const calDays = useMemo(
        () => (useHours ? reqTimes.days : new Set(bookableDays)),
        [useHours, reqTimes.days, bookableDays],
    );
    const timesForDate = useHours && date ? (reqTimes.byDate[date] || []) : [];
    const timeOptions = isComesToYou ? (useHours ? timesForDate : offered) : [];
    const today = londonDayKey();
    const pickDate = (d: string) => { setDate(d); setTime(''); };
    const egLine = egItem ? extraGuestsLine(egItem, provider.minAge ?? null) : null;

    // Slot keeps its short, padded card (the heavy picking is in the dialog). A
    // request shape becomes a flex column capped to the viewport: a fixed header,
    // a scrolling middle, and a pinned footer — so a long form scrolls INSIDE the
    // box and the Book button always stays on screen, the way the slot dialog does.
    if (isSlot) {
        return (
            <div id="booking-panel" className="rounded-2xl bg-white p-5 border border-slate-200 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        {priceParts_ && (
                            <div className="text-slate-900">
                                <span className="text-xl font-semibold">{(showFrom ? 'From ' : '') + priceParts_.money}</span>
                                {priceParts_.per && <span className="ml-1 text-sm font-normal text-slate-500">{priceParts_.per}</span>}
                            </div>
                        )}
                        <p className={`mt-0.5 text-sm font-medium ${provider.noRefund ? 'text-slate-500' : 'text-emerald-700'}`}>{cancel}</p>
                        {!standalone && checkIn && (
                            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                                <CalendarDays className="h-4 w-4 flex-none text-slate-400" aria-hidden />
                                <span>For your stay · {dateLabel(String(checkIn).slice(0, 10))} – {dateLabel(maxDate)}</span>
                            </p>
                        )}
                    </div>
                    <button type="button" onClick={() => setOpen(true)} disabled={!hasSlotAvailability}
                        className="flex-none rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:opacity-50">
                        {hasSlotAvailability ? 'Show dates' : 'No times'}
                    </button>
                </div>
                <DatePreview
                    items={provider.items}
                    sessions={previewSessions}
                    declaredSessions={declaredSessions}
                    providerCapacity={provider.slotCapacity}
                    providerMinPeople={provider.minPeople}
                    slotLength={provider.slotLength}
                    busy={busy}
                    onPickDay={(d) => openOn(d)}
                    onShowAll={() => openOn(null)}
                />
                {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
                {open && (
                    <BookingDialog
                        who={provider.who}
                        items={provider.items}
                        sessions={provider.sessions}
                        sessionsForItem={provider.perItemDurations ? sessionsForItem : undefined}
                        declaredSessions={declaredSessions}
                        providerCapacity={provider.slotCapacity}
                        providerMinPeople={provider.minPeople}
                        providerFulfilment={provider.fulfilment}
                        isFood={provider.isFood}
                        minAge={provider.minAge}
                        initialDate={initialDate}
                        prefillAdults={cottageAdults}
                        prefillChildren={cottageChildren}
                        busy={busy}
                        error={error}
                        onBook={bookSlot}
                        onClose={() => { if (!busy) { setOpen(false); setInitialDate(null); setError(null); } }}
                    />
                )}
            </div>
        );
    }

    const footerTotal = isMadeToOrder ? cartTotal : reqTotal;
    const footerBusyLabel = 'Sending…';
    const canSubmit = isMadeToOrder
        ? (!busy && cartLines.length > 0 && !!date)
        : (!busy && !!reqItem && !!date && !((provider.shape === 'comes_to_you' || offered.length > 0) && !time));

    return (
        <div id="booking-panel" className="flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
            {/* Header — price + what happens next */}
            <div className="flex-none border-b border-slate-100 px-5 pt-5 pb-4">
                {priceParts_ && (
                    <div className="text-slate-900">
                        <span className="text-xl font-semibold">{(showFrom ? 'From ' : '') + priceParts_.money}</span>
                        {priceParts_.per && <span className="ml-1 text-sm font-normal text-slate-500">{priceParts_.per}</span>}
                    </div>
                )}
                {!standalone && checkIn && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                        <CalendarDays className="h-4 w-4 flex-none text-slate-400" aria-hidden />
                        <span>For your stay · {dateLabel(String(checkIn).slice(0, 10))} – {dateLabel(maxDate)}</span>
                    </p>
                )}
                <span className={`mt-3 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${isMadeToOrder
                    ? (cartHasCustom ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900')
                    : 'bg-amber-100 text-amber-900'}`}>
                    {isMadeToOrder
                        ? (cartHasCustom ? `Request — ${provider.who} has 48 hours to confirm` : 'Books instantly')
                        : `Request — ${provider.who} has 48 hours to confirm`}
                </span>
            </div>

            {/* Scrolling middle */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {isMadeToOrder ? (
                    <>
                        {/* The menu as a cart — pick as many as you like, each with its
                            own quantity, with a running total. */}
                        <div className="space-y-2">
                            {provider.items.map((it) => {
                                const q = cart[it.id] || 0;
                                return (
                                    <div key={it.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-2.5">
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium text-slate-800">{it.name}{it.isCustom ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Made to order</span> : null}</div>
                                            <div className="text-[13px] text-slate-500">£{it.price.toFixed(2)}{it.description ? ' · ' + it.description : ''}</div>
                                        </div>
                                        <Stepper value={q} set={(n) => setCartQty(it.id, n)} min={0} max={MAX_ORDER_QUANTITY} />
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Pick a {deliverWord} date</div>
                        <div className="mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 px-3">
                            <MonthCalendar availableDays={calDays} selected={date || null} onSelect={pickDate} today={today} />
                        </div>
                        <p className="mt-1.5 text-xs text-slate-400">The {deliverWord} time is arranged by message once your order is placed.</p>

                        {cartNeedsAddress && (
                            <label className="mt-4 block">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery address</span>
                                <textarea value={address} onChange={(e) => setAddress(e.target.value.slice(0, 300))} rows={2}
                                    className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                            </label>
                        )}

                        {provider.isFood && (
                            <div className="mt-4">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allergies or dietary needs <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></span>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {COMMON_ALLERGENS.map((a) => (
                                        <button key={a} type="button" onClick={() => setAllergyTags((t) => (t.includes(a) ? t.filter((x) => x !== a) : [...t, a]))}
                                            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${allergyTags.includes(a) ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>{a}</button>
                                    ))}
                                </div>
                                <textarea value={allergy} onChange={(e) => setAllergy(e.target.value.slice(0, 500))} rows={2}
                                    className="mt-2 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        {provider.items.length > 1 && (
                            <fieldset>
                                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose</legend>
                                <div className="mt-2 space-y-1.5">
                                    {provider.items.map((it) => (
                                        <label key={it.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${itemId === it.id ? 'border-emerald-600 bg-emerald-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
                                            <input type="radio" name="item" checked={itemId === it.id} onChange={() => setItemId(it.id)} className="accent-emerald-600" />
                                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{it.name}</span>
                                            <span className="whitespace-nowrap text-sm font-semibold text-slate-900">{itemPriceLabel(it.price, it.unit)}</span>
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                        )}

                        <div className={`${provider.items.length > 1 ? 'mt-4 ' : ''}text-xs font-semibold uppercase tracking-wide text-slate-500`}>Pick a date</div>
                        <div className="mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 px-3">
                            <MonthCalendar availableDays={calDays} selected={date || null} onSelect={pickDate} today={today}
                                emptyLabel={useHours ? 'No dates available just now.' : 'Pick a date.'} />
                        </div>

                        {date && timeOptions.length > 0 && (
                            <>
                                <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Pick a time</div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {timeOptions.map((t) => (
                                        <button key={t} type="button" onClick={() => setTime(t)}
                                            className={`rounded-lg border px-3 py-2 text-sm font-medium ${time === t ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                                            {prettyTime(t)}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                        {date && useHours && timeOptions.length === 0 && (
                            <p className="mt-2 text-sm text-slate-500">No times on that day — try another date.</p>
                        )}

                        {reqItem && reqExtraGuests ? (
                            <div className="mt-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-700">Adults</span>
                                    <Stepper value={adults} set={setAdults} min={1} max={Number.isFinite(partyCap) ? partyCap - (kidsOk ? children : 0) : 30} />
                                </div>
                                {kidsOk && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-slate-700">Children</span>
                                        <Stepper value={children} set={setChildren} min={0} max={Number.isFinite(partyCap) ? partyCap - adults : 30} />
                                    </div>
                                )}
                                {egLine && <p className="text-xs text-slate-400">{egLine}</p>}
                            </div>
                        ) : (reqItem && reqPerPerson && (
                            <div className="mt-4 flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-700">Guests</span>
                                <Stepper value={reqQty} set={setQty}
                                    min={Math.max(1, Number(reqItem.minPeople) || 1)}
                                    max={Number.isFinite(partyCap) ? (partyCap as number) : 30} />
                            </div>
                        ))}

                        {needsAddress && (
                            <label className="mt-4 block">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where should {provider.who} come?</span>
                                <textarea value={address} onChange={(e) => setAddress(e.target.value.slice(0, 300))} rows={2} placeholder="The address for your booking"
                                    className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                            </label>
                        )}

                        {provider.isFood && (
                            <div className="mt-4">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allergies or dietary needs <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></span>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {COMMON_ALLERGENS.map((a) => (
                                        <button key={a} type="button" onClick={() => setAllergyTags((t) => (t.includes(a) ? t.filter((x) => x !== a) : [...t, a]))}
                                            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${allergyTags.includes(a) ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>{a}</button>
                                    ))}
                                </div>
                                <textarea value={allergy} onChange={(e) => setAllergy(e.target.value.slice(0, 500))} rows={2} placeholder="Anything else they should cook around"
                                    className="mt-2 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Pinned footer — total + the one action, always on screen */}
            <div className="flex-none border-t border-slate-100 px-5 py-4">
                {error && <p className="mb-2 text-sm text-rose-700">{error}</p>}
                <div className="mb-3 flex items-baseline justify-between">
                    <span className="text-sm font-medium text-slate-600">Total</span>
                    <span className="text-lg font-semibold text-slate-900">£{footerTotal.toFixed(2)}</span>
                </div>
                <button type="button" onClick={isMadeToOrder ? sendCart : sendRequest} disabled={!canSubmit}
                    className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                    {busy ? footerBusyLabel : (isMadeToOrder
                        ? (cartHasCustom ? 'Send request' : 'Book & pay')
                        : 'Send request')}
                </button>
                <p className="mt-2 text-xs text-slate-400">{isMadeToOrder
                    ? (cartHasCustom
                        ? `Your card is held, not charged, until ${provider.who} accepts your made-to-order items.`
                        : 'You pay now and your order is confirmed straight away.')
                    : `Your card is held, not charged, until ${provider.who} confirms.`}</p>
            </div>
        </div>
    );
}
