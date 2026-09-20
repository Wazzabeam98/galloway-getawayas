'use client';

import { useCallback, useMemo, useState } from 'react';
import { unitMultiplies, orderTotal, MAX_ORDER_QUANTITY } from '@/lib/serviceOrders';
import { seatConfig, generateSessions, resolvedDuration, type PartialBlock } from '@/lib/serviceSlots';
import { itemPriceLabel, dateLabel, priceParts, cancellationBadge } from '@/components/marketplace/present';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { CalendarDays } from 'lucide-react';
import BookingDialog, { type BookArgs, type DialogOpenSession } from '@/components/marketplace/BookingDialog';
import DatePreview from '@/components/marketplace/DatePreview';

interface PanelItem {
    id: string; name: string; description: string | null; price: number; unit: string; image: string | null;
    duration_minutes?: number | null;
    fulfilment?: string | null;
    capacity: number | null;
    minPeople: number | null;
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
}

const COMMON_ALLERGENS = ['Nuts', 'Peanuts', 'Gluten', 'Dairy', 'Eggs', 'Fish', 'Shellfish', 'Soya', 'Sesame'];
const dayKeyFromNow = (days: number) => shiftDayKey(londonDayKey(), days);
const lastNight = (checkOut: string) => shiftDayKey(String(checkOut).slice(0, 10), -1);
const maxKey = (a: string, b: string) => (a > b ? a : b);

// The booking box a guest sees from inside a cottage stay. A SLOT provider gets
// the Airbnb-shaped flow — a price and one "Show dates" button that opens the
// shared availability dialog (stay-bounded) and goes straight to Stripe Checkout.
// A REQUEST provider (chef/baker) instead picks a date during the stay and sends
// a request that's held, not charged, until they confirm.
export default function BookingPanel({ bookingId, checkIn, checkOut, cottageGuests, cottageAdults, cottageChildren, stay, provider }: {
    bookingId: string; checkIn: string; checkOut: string; cottageGuests: number;
    // The cottage booking's own party split, to prefill the picker.
    cottageAdults?: number | null; cottageChildren?: number | null;
    stay?: { title: string | null; town: string | null };
    provider: PanelProvider;
}) {
    const isSlot = provider.shape === 'slot';
    const [open, setOpen] = useState(false);
    const [initialDate, setInitialDate] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Request-flow state (non-slot only).
    const [itemId, setItemId] = useState<string>(provider.items.length === 1 ? provider.items[0].id : '');
    const [date, setDate] = useState<string>('');
    const [qty, setQty] = useState<number>(1);
    const [allergy, setAllergy] = useState<string>('');
    const [allergyTags, setAllergyTags] = useState<string[]>([]);

    const declaredSessions = provider.declaredSessions || [];
    const minDate = maxKey(checkIn.slice(0, 10), dayKeyFromNow(provider.shape === 'made_to_order' ? provider.leadTimeDays : 0));
    const maxDate = lastNight(checkOut);

    const cheapest = provider.items.length ? provider.items.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    const priceParts_ = cheapest ? priceParts(cheapest.price, cheapest.unit) : null;
    const showFrom = provider.items.length > 1;
    const cancel = cancellationBadge(provider.cancellationHours, provider.noRefund);

    // Per-treatment (massage): the open-hours grid depends on the chosen item's
    // own length, so the dialog is handed a generator; a fixed-grid provider gets
    // its static server grid. Both bound to the stay window.
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
    const reqPerPerson = !!reqItem && unitMultiplies(reqItem.unit);
    const reqQty = reqPerPerson ? Math.max(1, Math.min(MAX_ORDER_QUANTITY, Math.floor(qty) || 1)) : 1;
    const reqTotal = reqItem ? orderTotal(reqItem.price, reqQty) : 0;
    async function sendRequest() {
        setError(null);
        if (!reqItem) { setError('Pick one first.'); return; }
        if (!date) { setError('Pick a date during your stay.'); return; }
        setBusy(true);
        try {
            const trimmedAllergy = provider.isFood ? [allergyTags.join(', '), allergy.trim()].filter(Boolean).join(allergyTags.length && allergy.trim() ? ' — ' : '') : '';
            const res = await fetch('/api/services/order', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId: reqItem.id, bookingId, serviceDate: date, quantity: reqQty, allergy: trimmedAllergy }),
            });
            const d = await res.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start that.');
        } catch { setError('Could not start that.'); }
        setBusy(false);
    }

    const stayDays = useMemo(() => {
        const out: string[] = []; let d = minDate;
        for (let i = 0; i < 62 && d <= maxDate; i++) { out.push(d); d = shiftDayKey(d, 1); }
        return out;
    }, [minDate, maxDate]);

    // Preview cards use the cheapest option; for the per-treatment shape the grid
    // is that option's own, so generate it.
    const previewDefault = provider.items.filter((i) => i.price > 0).sort((a, b) => a.price - b.price).find((i) => unitMultiplies(i.unit)) || provider.items[0] || null;
    const previewSessions = provider.perItemDurations && previewDefault ? sessionsForItem(previewDefault.id) : provider.sessions;
    // Tapping a day in the panel opens the dialog on that day's times.
    const openOn = (d: string | null) => { setInitialDate(d); setOpen(true); };

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
                    {isSlot && <p className={`mt-0.5 text-sm font-medium ${provider.noRefund ? 'text-slate-500' : 'text-emerald-700'}`}>{cancel}</p>}
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                        <CalendarDays className="h-4 w-4 flex-none text-slate-400" aria-hidden />
                        <span>For your stay · {dateLabel(checkIn.slice(0, 10))} – {dateLabel(maxDate)}</span>
                    </p>
                </div>
                {isSlot && (
                    <button type="button" onClick={() => setOpen(true)} disabled={!hasSlotAvailability}
                        className="flex-none rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:opacity-50">
                        {hasSlotAvailability ? 'Show dates' : 'No times'}
                    </button>
                )}
            </div>

            {isSlot ? (
                <>
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
                            initialDate={initialDate}
                            prefillAdults={cottageAdults}
                            prefillChildren={cottageChildren}
                            busy={busy}
                            error={error}
                            onBook={bookSlot}
                            onClose={() => { if (!busy) { setOpen(false); setInitialDate(null); setError(null); } }}
                        />
                    )}
                </>
            ) : (
                <>
                    <span className="mt-3 inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Request — {provider.who} has 48 hours to confirm</span>

                    {provider.items.length > 1 && (
                        <fieldset className="mt-4">
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

                    <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Pick a date</div>
                    <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                        {stayDays.map((d) => (
                            <button key={d} type="button" onClick={() => setDate(d)}
                                className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium ${date === d ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                                {dateLabel(d)}
                            </button>
                        ))}
                    </div>

                    {reqItem && reqPerPerson && (
                        <label className="mt-4 block">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">How many</span>
                            <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                className="mt-1 block w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
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

                    {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}

                    <button type="button" onClick={sendRequest} disabled={busy || !reqItem || !date}
                        className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                        {busy ? 'Sending…' : (reqTotal ? `Send request · £${reqTotal.toFixed(2)}` : 'Send request')}
                    </button>
                    <p className="mt-2 text-xs text-slate-400">Your card is held, not charged, until {provider.who} confirms.</p>
                </>
            )}
        </div>
    );
}
