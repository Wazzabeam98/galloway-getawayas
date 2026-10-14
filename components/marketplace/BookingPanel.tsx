'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { unitMultiplies } from '@/lib/serviceOrders';
import { hasExtraGuests } from '@/lib/extraGuests';
import { generateSessions, resolvedDuration, type PartialBlock } from '@/lib/serviceSlots';
import { dateLabel, priceParts, cancellationBadge, bookingOptions, optionTarget } from '@/components/marketplace/present';
import { childrenAllowed } from '@/lib/guestAges';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { CalendarDays } from 'lucide-react';
import BookingDialog, { type BookArgs, type DialogOpenSession } from '@/components/marketplace/BookingDialog';
import DatePreview from '@/components/marketplace/DatePreview';
import { RequestBookingDialog, RequestDatePreview, type RequestBookArgs } from '@/components/marketplace/RequestBooking';
import { useRequestBooking } from '@/components/marketplace/RequestBookingContext';
import { fetchAgreementStatus, recordAgreement } from '@/components/legal/AgreementTick';
import { AGREEMENTS } from '@/lib/agreements';

interface PanelItem {
    id: string; name: string; description: string | null; price: number; unit: string; image: string | null;
    groupPrice?: number | null;
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
    // Comes-to-you: the dates the provider is already booked on — greyed and
    // unpickable in the dialog (one booking a day blocks the whole day).
    bookedDates?: string[];
    cancellationHours?: number | null;
    noRefund?: boolean | null;
    minAge?: number | null;
    // Request shapes: the times the provider offers, and how far ahead a
    // standalone booking may reach. Empty / unset when not applicable.
    offeredTimes?: string[];
    horizonDays?: number;
    maxGuests?: number | null;
}

const dayKeyFromNow = (days: number) => shiftDayKey(londonDayKey(), days);
const lastNight = (checkOut: string) => shiftDayKey(String(checkOut).slice(0, 10), -1);
const maxKey = (a: string, b: string) => (a > b ? a : b);

// The booking box a guest sees for a SLOT or a COMES-TO-YOU experience. (A
// made-to-order listing is served by the food-ordering layout — FoodMenu +
// FoodBasket — not this component.) Two ways in:
//   • Against a cottage stay (bookingId + checkIn/checkOut given): the date is
//     bounded by the stay and the party capped by who's staying.
//   • Standalone (no booking): bookable by anyone; the date runs to the
//     provider's horizon, the party is capped by the item's own maximum, and a
//     comes-to-you chef asks for an address.
// Both shapes are compact — price, cancellation, a "Show dates" button and a few
// suggested days — with the picking (guest count, calendar, time) in the dialog.
export default function BookingPanel({ bookingId, checkIn, checkOut, cottageAdults, cottageChildren, standalone: standaloneProp, signedIn, provider }: {
    bookingId?: string; checkIn?: string; checkOut?: string; cottageGuests?: number;
    cottageAdults?: number | null; cottageChildren?: number | null;
    stay?: { title: string | null; town: string | null };
    standalone?: boolean;
    // False on the public browse page when nobody is signed in — an anonymous
    // standalone checkout. Omitted (against a stay), the booker is always signed
    // in, so it defaults to signed-in.
    signedIn?: boolean;
    provider: PanelProvider;
}) {
    const isSlot = provider.shape === 'slot';
    const isComesToYou = provider.shape === 'comes_to_you';
    const standalone = standaloneProp ?? !bookingId;
    // An anonymous standalone checkout: no account yet — it is minted from the
    // Stripe payer email after payment. Against a stay is always signed in.
    const anonymous = standalone && signedIn === false;
    const [open, setOpen] = useState(false);
    // The phone bottom bar is portalled to <body>, which the server can't do —
    // so it draws after mount, or the server and first client render disagree
    // (a hydration error on every experience page).
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    const [initialDate, setInitialDate] = useState<string | null>(null);
    // The option chosen on the listing (via ChooseMenu) — locks the dialog to it
    // and removes the option list. Null on a plain "Show dates" open, which then
    // defaults to the cheapest option below.
    const [lockedItemId, setLockedItemId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Does this guest still owe the Guest Terms? Booking an experience is a
    // checkout too, so — like a stay — they accept them here, in the dialog above
    // the Book button, rather than through a sign-in pop-up. A signed-in guest who
    // owes them records here before the order; an anonymous booker has no account
    // to record against yet, so they always tick and the version rides on the
    // order to be recorded when the account is minted.
    const [needsGuestTerms, setNeedsGuestTerms] = useState(anonymous);
    useEffect(() => {
        if (anonymous) { setNeedsGuestTerms(true); return; }
        let cancelled = false;
        fetchAgreementStatus().then((st) => {
            // Fail CLOSED: keep the tick unless we have POSITIVELY confirmed the
            // guest has agreed. A null (lookup error / unreachable table) must
            // not drop the tick and let them book without a recorded agreement.
            if (!cancelled) setNeedsGuestTerms(!(st && st.documents && st.documents.guest && st.documents.guest.agreed));
        });
        return () => { cancelled = true; };
    }, [anonymous]);

    // The Guest Terms step before an order is created. A signed-in guest who owes
    // them records them now (against their account); an anonymous one carries the
    // ticked version on the order, so this returns the fields to add to the POST
    // body. Returns null to STOP the booking when a signed-in record fails.
    async function guestTermsForOrder(): Promise<{ guestTermsVersion?: string } | null> {
        if (!needsGuestTerms) return {};
        if (anonymous) return { guestTermsVersion: AGREEMENTS.guest.version };
        const failed = await recordAgreement('guest', 'experience_checkout');
        if (failed) { setError(failed); setBusy(false); return null; }
        setNeedsGuestTerms(false);
        return {};
    }

    const declaredSessions = provider.declaredSessions || [];
    // The provider's notice period is the earliest a date can be picked — for a
    // comes-to-you chef as much as a made-to-order baker. A two-day notice on the
    // 22nd first offers the 24th; a stay still can't be booked inside the notice.
    const reqLead = Math.max(0, provider.leadTimeDays || 0);
    const minDate = standalone
        ? dayKeyFromNow(reqLead)
        : maxKey(String(checkIn).slice(0, 10), dayKeyFromNow(reqLead));
    const maxDate = standalone
        ? dayKeyFromNow(Math.max(1, provider.horizonDays || 90))
        : lastNight(String(checkOut));

    // The cheapest option, with the unit the provider chose ("From £15 / guest",
    // "£475 / event"); a timed treatment reads plainly.
    const pricedItems = provider.items.filter((i) => i.price > 0);
    const cheapest = pricedItems.length ? pricedItems.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    const priceParts_ = cheapest ? priceParts(cheapest.price, cheapest.unit, (cheapest.duration_minutes ?? 0) > 0) : null;
    const showFrom = pricedItems.length > 1;
    const cancel = cancellationBadge(provider.cancellationHours, provider.noRefund);

    // ---- SLOT ---------------------------------------------------------------
    const bookedRowByKey = useMemo(() => {
        const m = new Map<string, PanelSession['row']>();
        for (const b of provider.bookedBlocks || []) m.set(b.date + ' ' + b.time, { capacity: b.capacity, seats_taken: b.seats_taken, private: b.private });
        return m;
    }, [provider.bookedBlocks]);
    // What the booking dialogs choose between: each offering, plus a whole-group
    // option for a per-person offering that has a group price.
    const options = useMemo(() => bookingOptions(provider.items), [provider.items]);
    const sessionsForItem = useCallback((selItemId: string): DialogOpenSession[] => {
        if (!provider.perItemDurations) return provider.sessions;
        const item = provider.items.find((i) => i.id === optionTarget(selItemId).itemId);
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
        const gt = await guestTermsForOrder();
        if (!gt) return;
        try {
            const res = await fetch('/api/services/slots/book', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerId: provider.id, ...optionTarget(args.itemId), bookingId, sessionDate: args.date, sessionTime: args.time,
                    quantity: args.quantity, attendees: args.attendees,
                    adults: args.adults, children: args.children, allergy: args.allergy,
                    ...gt,
                }),
            });
            const d = await res.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start that.'); setBusy(false);
        } catch { setError('Could not start that.'); setBusy(false); }
    }

    const previewDefault = provider.items.filter((i) => i.price > 0).sort((a, b) => a.price - b.price).find((i) => unitMultiplies(i.unit)) || provider.items[0] || null;
    const previewSessions = provider.perItemDurations && previewDefault ? sessionsForItem(previewDefault.id) : provider.sessions;
    const openOn = (d: string | null) => { setInitialDate(d); setOpen(true); };

    // Open the comes-to-you dialog on a specific OPTION (chosen on the listing)
    // and optionally a date. A null option falls back to the cheapest — that's
    // what a plain "Show dates" or a suggested day does.
    const requestBooking = useRequestBooking();
    const openRequest = useCallback((itemId: string | null, d: string | null) => {
        setLockedItemId(itemId || cheapest?.id || null);
        setInitialDate(d);
        setOpen(true);
    }, [cheapest]);
    // A Choose press on the listing menu (ChooseMenu) parks a request in the
    // context; open the dialog on that option.
    useEffect(() => {
        const p = requestBooking?.pending;
        if (!p) return;
        openRequest(p.itemId, p.date);
        requestBooking?.consume();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestBooking?.pending?.nonce]);

    // ---- COMES-TO-YOU -------------------------------------------------------
    // A comes-to-you chef only travels, so standalone it asks for an address.
    const needsAddress = standalone && isComesToYou;
    const offered = provider.offeredTimes || [];

    const bookableDays = useMemo(() => {
        const out: string[] = []; let d = minDate;
        for (let i = 0; i < 92 && d <= maxDate; i++) { out.push(d); d = shiftDayKey(d, 1); }
        return out;
    }, [minDate, maxDate]);

    // The available days and their start times, generated from the provider's
    // weekly opening hours (the single place hours are set). A legacy provider
    // with no hours but named offered_times falls back to those on every bookable
    // day.
    const reqTimes = useMemo(() => {
        const byDate: Record<string, string[]> = {};
        const days = new Set<string>();
        if (!isComesToYou) return { days, byDate };
        // A date the provider is already booked on is dropped entirely — one
        // booking a day blocks the whole day, so it never enters the day list and
        // (being absent from calDays) shows greyed and disabled in the calendar.
        const booked = new Set(provider.bookedDates || []);
        for (const s of generateSessions(provider.slotAvailability || [], provider.slotBlocks || [], 30, minDate, maxDate, 30, provider.partialBlocks || [])) {
            if (booked.has(s.date)) continue;
            (byDate[s.date] = byDate[s.date] || []).push(s.time);
            days.add(s.date);
        }
        return { days, byDate };
    }, [isComesToYou, provider.slotAvailability, provider.slotBlocks, provider.partialBlocks, provider.bookedDates, minDate, maxDate]);
    const useHours = isComesToYou && reqTimes.days.size > 0;
    const calDays = useMemo(
        () => (useHours ? reqTimes.days : new Set(bookableDays)),
        [useHours, reqTimes.days, bookableDays],
    );
    const reqDialogTimes = useMemo<Record<string, string[]>>(() => {
        if (useHours) return reqTimes.byDate;
        const m: Record<string, string[]> = {};
        if (isComesToYou && offered.length) for (const d of bookableDays) m[d] = offered;
        return m;
    }, [useHours, reqTimes.byDate, isComesToYou, offered, bookableDays]);

    // Submit a comes-to-you request from the DIALOG's own state. The money fields
    // are derived from the chosen item's kind so the request matches the total the
    // dialog showed: extra-guests → adults/children; per-person → a head count as
    // quantity; flat → one.
    async function bookRequest(args: RequestBookArgs) {
        // The chosen OPTION — a whole-group option reads as one flat booking.
        const it = options.find((i) => i.id === args.itemId);
        if (!it) { setError('Pick one first.'); return; }
        const target = optionTarget(it.id);
        const eg = { unit: it.unit, price: it.price, included_guests: it.includedGuests ?? null, extra_adult_fee: it.extraAdultFee ?? null, extra_child_fee: it.extraChildFee ?? null, max_party: it.maxParty ?? null };
        const isExtra = hasExtraGuests(eg);
        const perPerson = unitMultiplies(it.unit);
        const kids = childrenAllowed(provider.minAge ?? null) ? args.children : 0;
        setBusy(true); setError(null);
        const gt = await guestTermsForOrder();
        if (!gt) return;
        try {
            const res = await fetch('/api/services/order', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    itemId: target.itemId, bookAs: target.bookAs, bookingId, serviceDate: args.date, serviceTime: args.time,
                    ...(isExtra
                        ? { adults: Math.max(1, args.adults), children: kids }
                        : { quantity: perPerson ? Math.max(1, args.adults + kids) : 1 }),
                    serviceAddress: needsAddress ? args.address : undefined,
                    allergy: provider.isFood ? args.allergy : '',
                    ...gt,
                }),
            });
            const d = await res.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start that.');
        } catch { setError('Could not start that.'); }
        setBusy(false);
    }

    if (isSlot) {
        return (
            <>
                {/* Standalone (the public page) hides the inline card on a phone and
                    uses the bottom bar below; against a stay it keeps the inline
                    card on every size. */}
                <div id="booking-panel" className={(standalone ? 'hidden lg:block ' : '') + 'rounded-2xl bg-white p-5 border border-slate-200 shadow-[0_6px_16px_rgba(0,0,0,0.12)]'}>
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
                            className="flex-none rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
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
                </div>

                {/* Phone bottom bar (public only) — price + "Check availability",
                    opening the same dialog. The cottage's bottom-bar mechanism. */}
                {standalone && mounted && !open && createPortal(
                    <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
                        <div className="mb-2.5">
                            {priceParts_ ? (
                                <p className="text-base font-bold text-slate-900 leading-tight">
                                    {(showFrom ? 'From ' : '') + priceParts_.money}
                                    {priceParts_.per && <span className="text-sm font-normal text-slate-500"> {priceParts_.per}</span>}
                                </p>
                            ) : null}
                            <p className={`text-xs font-medium ${provider.noRefund ? 'text-slate-500' : 'text-emerald-700'}`}>{cancel}</p>
                        </div>
                        <button type="button" onClick={() => setOpen(true)} disabled={!hasSlotAvailability}
                            className="w-full rounded-lg bg-emerald-700 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                            {hasSlotAvailability ? 'Check availability' : 'No times'}
                        </button>
                    </div>, document.body,
                )}

                {open && (
                    <BookingDialog
                        slotLength={provider.slotLength}
                        who={provider.who}
                        items={options}
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
                        hasStay={!standalone}
                        needsGuestTerms={needsGuestTerms}
                        busy={busy}
                        error={error}
                        onBook={bookSlot}
                        onClose={() => { if (!busy) { setOpen(false); setInitialDate(null); setError(null); } }}
                    />
                )}
            </>
        );
    }

    // ---- comes-to-you: the compact box + dialog, like the slot experiences ----
    // Price, the free-cancellation line, a "Show dates" button and a few suggested
    // days; the option, guest count, calendar and time all live in the dialog.
    return (
        <>
            <div id="booking-panel" className={(standalone ? 'hidden lg:block ' : '') + 'rounded-2xl bg-white p-5 border border-slate-200 shadow-[0_6px_16px_rgba(0,0,0,0.12)]'}>
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
                    <button type="button" onClick={() => openRequest(null, null)} disabled={calDays.size === 0}
                        className="flex-none rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                        {calDays.size ? 'Show dates' : 'No dates'}
                    </button>
                </div>

                <RequestDatePreview calDays={calDays} timesByDate={reqDialogTimes} busy={busy} onPickDay={(d) => openRequest(null, d)} />

                {error && !open && <p className="mt-3 text-sm text-rose-700">{error}</p>}
            </div>

            {/* Phone bottom bar (public only) — price + "Check availability",
                opening the same request dialog. The cottage's bottom-bar mechanism. */}
            {standalone && mounted && !open && createPortal(
                <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
                    <div className="mb-2.5">
                        {priceParts_ ? (
                            <p className="text-base font-bold text-slate-900 leading-tight">
                                {(showFrom ? 'From ' : '') + priceParts_.money}
                                {priceParts_.per && <span className="text-sm font-normal text-slate-500"> {priceParts_.per}</span>}
                            </p>
                        ) : null}
                        <p className={`text-xs font-medium ${provider.noRefund ? 'text-slate-500' : 'text-emerald-700'}`}>{cancel}</p>
                    </div>
                    <button type="button" onClick={() => openRequest(null, null)} disabled={calDays.size === 0}
                        className="w-full rounded-lg bg-emerald-700 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                        {calDays.size ? 'Check availability' : 'No dates'}
                    </button>
                </div>, document.body,
            )}

            {open && (
                <RequestBookingDialog
                    who={provider.who}
                    items={options}
                    minAge={provider.minAge}
                    isFood={provider.isFood}
                    needsAddress={needsAddress}
                    calDays={calDays}
                    timesByDate={reqDialogTimes}
                    providerMax={provider.maxGuests}
                    prefillAdults={cottageAdults}
                    prefillChildren={cottageChildren}
                    initialDate={initialDate}
                    lockedItemId={lockedItemId}
                    hasStay={!standalone}
                    needsGuestTerms={needsGuestTerms}
                    busy={busy}
                    error={error}
                    onBook={bookRequest}
                    onClose={() => { if (!busy) { setOpen(false); setInitialDate(null); setLockedItemId(null); setError(null); } }}
                />
            )}
        </>
    );
}
