'use client';

import { useMemo, useState } from 'react';
import { Calendar } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import { unitMultiplies, orderTotal, MAX_ORDER_QUANTITY } from '@/lib/serviceOrders';
import {
    optionAvailability, bookingIsPrivate, type OptionAvailability,
    generateSessions, resolvedDuration, overlapsBooked, minutesOfDay, type PartialBlock,
} from '@/lib/serviceSlots';
import { itemPriceLabel, unitPhrase, dateLabel, timeLabel } from '@/components/marketplace/present';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';

interface PanelItem {
    id: string; name: string; description: string | null; price: number; unit: string; image: string | null;
    // The treatment's own length; null for a single-length category. Present ⇒ the
    // grid the guest sees is generated from THIS, not the provider number.
    duration_minutes?: number | null;
    // Per-item location for a 'both' provider; 'delivery' ⇒ travelled, so it's
    // private and capped only by the cottage, not the provider's studio size.
    fulfilment?: string | null;
}
interface PanelSession {
    date: string; time: string;
    // The pinned seat row for this time, or null if nobody has booked it yet.
    row: { capacity: number; seats_taken: number; private: boolean } | null;
}
interface PanelBookedBlock {
    date: string; time: string; duration_minutes: number | null; turnaround_minutes: number | null;
    capacity: number; seats_taken: number; private: boolean;
}
interface PanelProvider {
    id: string; business_name: string; who: string; shape: string; isFood: boolean;
    // 'delivery' = the provider travels to the guest (a travelling session, which
    // needs a destination — the guest's stay); 'collection'/null = come-to-me.
    fulfilment?: string | null;
    items: PanelItem[]; sessions: PanelSession[]; leadTimeDays: number;
    // Per-person slots only: the smallest group a single booking may be. 1 = no
    // minimum. Floors the quantity picker; the booking route is the real gate.
    minPeople: number;
    // The whole-table size, so a per-person option can be sized on a fresh time.
    slotCapacity: number;
    // The per-treatment shape (massage): the grid depends on the chosen item's
    // duration, so the panel generates it here rather than reading one server grid.
    perItemDurations?: boolean;
    turnaround?: number;
    // The provider's single session length — the fallback for an UNTIMED item (a
    // shared class), so it uses the host's real length rather than a hard default.
    slotLength?: number;
    slotAvailability?: Array<{ day_of_week: number; open_time: string; close_time: string }>;
    slotBlocks?: string[];
    // Partial blocks — ranges the provider closed off; the grid skips them.
    partialBlocks?: PartialBlock[];
    // Every booked session's interval, to grey any start that would overlap one.
    bookedBlocks?: PanelBookedBlock[];
}

// A word for why an option can't be booked on a time, from the shared helper's
// reason. Kept human: the guest sees "why not", never a silent dead button.
// Worded by the BOOKING, not the product ("Shared table"/"Private hire" was the
// same noun-leak as the host wizard — wrong on a sauna or a walk): a whole-thing
// option is blocked because others are already joining that time; a place is
// blocked because the time is booked privately.
function unavailableLabel(a: OptionAvailability, unit: string): string {
    if (a.reason === 'other-mode') return bookingIsPrivate(unit) ? 'Others joining' : 'Booked privately';
    if (a.reason === 'too-small') return 'Almost full';
    return 'Full';
}

// Between a yyyy-mm-dd key and a local Date at midnight. Constructing from the
// parts (not new Date(key), which parses as UTC) keeps the calendar day the guest
// clicks and the key we send to the server the same, in any timezone.
// The common ones as one-tap chips, so a guest names an allergy even when they
// wouldn't type it out. Free text below still catches anything not listed.
const COMMON_ALLERGENS = ['Nuts', 'Peanuts', 'Gluten', 'Dairy', 'Eggs', 'Fish', 'Shellfish', 'Soya', 'Sesame'];

function keyToDate(key: string): Date {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}
function dateToKey(dt: Date): string {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// yyyy-mm-dd for (today + days), on the London calendar via the shared helper.
function dayKeyFromNow(days: number): string {
    return shiftDayKey(londonDayKey(), days);
}
function lastNight(checkOut: string): string {
    return shiftDayKey(String(checkOut).slice(0, 10), -1);
}
function maxKey(a: string, b: string): string { return a > b ? a : b; }

export default function BookingPanel({ bookingId, checkIn, checkOut, cottageGuests, stay, provider }: {
    bookingId: string; checkIn: string; checkOut: string; cottageGuests: number;
    // The guest's stay — the cottage this booking is for. Shown as the destination
    // a travelling session comes to (the pick-your-stay path).
    stay?: { title: string | null; town: string | null };
    provider: PanelProvider;
}) {
    const isSlot = provider.shape === 'slot';
    // A travelling session (the provider comes to the guest) needs a destination.
    // For the pick-your-stay path the destination is the guest's stay — shown here
    // and frozen onto the order server-side from the booking's listing.
    const travels = isSlot && provider.fulfilment === 'delivery';
    // Just the town for the sub-line — the cottage name is already in the line
    // above it, so repeating it there reads as a stutter.
    const stayTown = stay?.town || '';
    const [itemId, setItemId] = useState<string>(provider.items.length === 1 ? provider.items[0].id : '');
    const [qty, setQty] = useState<number>(1);
    // How many people at a PRIVATE session — asked for a flat item, never priced.
    const [attendees, setAttendees] = useState<number>(1);
    const [date, setDate] = useState<string>('');
    const [session, setSession] = useState<PanelSession | null>(null);
    const [dayIdx, setDayIdx] = useState<number>(0);
    const [allergy, setAllergy] = useState<string>('');
    const [allergyTags, setAllergyTags] = useState<string[]>([]);
    const [note, setNote] = useState<string>('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // The guest's chosen product, for every shape. A single-item provider
    // auto-selects it (itemId defaults to the one id above); a provider offering
    // two — a private hire and a shared table — is picked below.
    const item = provider.items.find((i) => i.id === itemId) || null;
    const multiplies = !!item && unitMultiplies(item.unit);
    // A private (flat) slot session takes a HEAD COUNT — how many are coming — that
    // does not change the price. The honest cap is the provider's declared capacity
    // where it has one (a room/table size), else the cottage's guest count (a
    // traveller declares none). Only asked when that cap leaves a real choice (>1).
    const isPrivateSlot = isSlot && !!item && !multiplies;
    // A travelling item (the provider comes to the cottage) ignores the studio
    // capacity — its only cap is the cottage's guest count, so its head count is
    // free up to that. A studio item uses the declared studio size.
    const itemTravels = !!item && String(item.fulfilment) === 'delivery';
    const declaredCap = itemTravels ? null : (provider.slotCapacity && provider.slotCapacity > 0 ? provider.slotCapacity : null);
    const attendeesCap = Math.max(1, declaredCap != null ? Math.min(declaredCap, cottageGuests) : cottageGuests);
    const chosenAttendees = Math.min(Math.max(1, Math.floor(attendees) || 1), attendeesCap);
    // The per-treatment shape (massage): the grid depends on the chosen treatment.
    const perItem = isSlot && !!provider.perItemDurations;
    const turnaround = Math.max(0, provider.turnaround || 0);
    // The chosen item's length: its own duration if it has one (a timed 1:1), else
    // the PROVIDER'S session length (an untimed shared class) — NOT a hard 60
    // default, which would silently mis-grid a mixed provider's classes.
    const chosenDuration = item ? resolvedDuration(item, { slot_length_minutes: provider.slotLength }) : 0;

    const minDate = maxKey(checkIn.slice(0, 10), dayKeyFromNow(provider.shape === 'made_to_order' ? provider.leadTimeDays : 0));
    const maxDate = lastNight(checkOut);

    // The provider config the shared helper reads — the SAME optionAvailability
    // the booking route checks and the host diary renders, so what the guest is
    // shown as bookable is exactly what the claim will accept. A time impossible
    // for the chosen option is greyed here, not discovered at the claim.
    const cfg = { slot_capacity: provider.slotCapacity, slot_min_people: provider.minPeople };
    const availOf = (s: PanelSession, unit: string): OptionAvailability => optionAvailability(s.row, unit, cfg);
    // The chosen option's availability on the chosen time.
    const sel = isSlot && session && item ? availOf(session, item.unit) : null;

    // The bookable times. For a fixed-grid provider (sauna, class) this is the
    // server-generated grid, unchanged. For the per-treatment shape it is
    // generated HERE from the chosen treatment's own length — the times a guest
    // sees genuinely depend on the treatment picked — with each time carrying its
    // booked row (so a taken time greys) and overlapping starts dropped below.
    const panelSessions = useMemo<PanelSession[]>(() => {
        if (!isSlot) return [];
        if (!perItem) return provider.sessions;
        if (!item) return [];   // per-item: the guest picks a treatment first
        // The real seat row per booked time, so a shared class shows its true
        // seats-left (a 1:1 is capacity 1 and reads full once taken, as before).
        const rowByKey = new Map<string, PanelSession['row']>();
        for (const b of provider.bookedBlocks || []) rowByKey.set(b.date + ' ' + b.time, { capacity: b.capacity, seats_taken: b.seats_taken, private: b.private });
        const nowMs = Date.now();
        return generateSessions(provider.slotAvailability || [], provider.slotBlocks || [], chosenDuration + turnaround, minDate, maxDate, chosenDuration, provider.partialBlocks || [])
            .filter((s) => new Date(s.date + 'T' + s.time + ':00Z').getTime() > nowMs)
            .map((s) => ({ date: s.date, time: s.time, row: rowByKey.get(s.date + ' ' + s.time) || null }));
    }, [isSlot, perItem, item, chosenDuration, turnaround, minDate, maxDate, provider.sessions, provider.slotAvailability, provider.slotBlocks, provider.partialBlocks, provider.bookedBlocks]);

    // A candidate time is unbookable for the per-treatment shape when its interval
    // [start, start + duration + turnaround) overlaps a DIFFERENT booked session —
    // the same rule the claim and the database exclusion enforce, so the guest is
    // never shown a start the claim would refuse.
    const overlapsABooking = (s: PanelSession): boolean => {
        if (!perItem || !item) return false;
        const others = (provider.bookedBlocks || []).filter((b) => b.date === s.date && minutesOfDay(b.time) !== minutesOfDay(s.time));
        return overlapsBooked(s.time, chosenDuration, turnaround, others.map((b) => ({ session_time: b.time, duration_minutes: b.duration_minutes, turnaround_minutes: b.turnaround_minutes })));
    };

    // Sessions grouped by day, for the slot picker.
    const days = useMemo(() => {
        const m: Record<string, PanelSession[]> = {};
        for (const s of panelSessions) (m[s.date] = m[s.date] || []).push(s);
        return Object.keys(m).sort().map((d) => ({ date: d, times: m[d].sort((a, b) => a.time.localeCompare(b.time)) }));
    }, [panelSessions]);

    const seatCap = sel ? Math.min(MAX_ORDER_QUANTITY, sel.seatsLeft) : MAX_ORDER_QUANTITY;
    // The per-person floor: the smallest group this session runs for. A
    // convenience only — the booking route is the real gate. Applies only when
    // the unit multiplies; 1 (no minimum) otherwise.
    const minPeople = isSlot && multiplies ? Math.max(1, provider.minPeople || 1) : 1;
    const quantity = multiplies ? Math.min(Math.max(minPeople, Math.floor(qty) || minPeople), seatCap) : 1;
    const total = item ? orderTotal(item.price, quantity) : 0;

    // Enough picked to book. Drives the mobile bottom bar: when it isn't ready,
    // the bar scrolls up to the form rather than firing a hidden error.
    const ready = !!item && (isSlot ? (!!session && (!sel || sel.possible)) : !!date);
    const ctaLabel = busy
        ? (isSlot ? 'Booking…' : 'Sending…')
        : isSlot ? (total ? `Book · £${total.toFixed(2)}` : 'Book') : 'Send request';
    const scrollToForm = () => {
        if (typeof document !== 'undefined') {
            document.getElementById('booking-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    async function go() {
        setError(null);
        if (!item) { setError('Pick one first.'); return; }
        if (isSlot && !session) { setError('Pick a time first.'); return; }
        if (!isSlot && !date) { setError('Pick a date first.'); return; }
        setBusy(true);
        try {
            const url = isSlot ? '/api/services/slots/book' : '/api/services/order';
            const trimmedNote = note.trim();
            // Ticked chips first, then anything typed — one string the provider
            // reads on its own line / badge.
            const trimmedAllergy = provider.isFood
                ? [allergyTags.join(', '), allergy.trim()].filter(Boolean).join(allergyTags.length && allergy.trim() ? ' — ' : '')
                : '';
            const body = isSlot
                ? { providerId: provider.id, itemId: item.id, bookingId, sessionDate: session!.date, sessionTime: session!.time, quantity, attendees: chosenAttendees, note: trimmedNote, allergy: trimmedAllergy }
                : { itemId: item.id, bookingId, serviceDate: date, quantity, note: trimmedNote, allergy: trimmedAllergy };
            const res = await fetch(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            const d = await res.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start that.');
        } catch { setError('Could not start that.'); }
        setBusy(false);
    }

    return (
        <div id="booking-panel" className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
            <div className="flex items-baseline justify-between gap-3">
                <div className="text-2xl font-semibold text-slate-900">
                    {item ? itemPriceLabel(item.price, item.unit) : (provider.items.length ? itemPriceLabel(Math.min(...provider.items.map((i) => i.price)), provider.items[0].unit) : '')}
                </div>
                {provider.items.length > 1 && !item ? (
                    <span className="text-sm text-slate-400">choose below</span>
                ) : null}
            </div>

            {/* How it books — a badge, so instant and 48-hour-hold don't rely on
                one line of small print above the button to tell them apart. */}
            <div className="mt-2">
                {isSlot ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                        Instant book — confirmed straight away
                    </span>
                ) : (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                        Request — {provider.who} has 48 hours to confirm
                    </span>
                )}
            </div>

            {/* Menu pick — any provider offering more than one product, slots
                included (a private hire vs a shared table are two items). */}
            {provider.items.length > 1 && (
                <fieldset className="mt-4">
                    <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose</legend>
                    <div className="mt-2 space-y-1.5">
                        {provider.items.map((it) => {
                            const on = itemId === it.id;
                            return (
                                <label key={it.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${on ? 'border-emerald-600 bg-emerald-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
                                    <input type="radio" name="item" checked={on} onChange={() => {
                                        setItemId(it.id);
                                        // A time picked for the old option may be
                                        // impossible for this one — a private hire on a
                                        // shared table, or a treatment whose grid no
                                        // longer offers that start — so drop it rather
                                        // than let the guest book what would be refused.
                                        if (session && (perItem || !availOf(session, it.unit).possible)) setSession(null);
                                    }} className="accent-emerald-600" />
                                    {it.image ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={it.image} alt="" className="h-9 w-9 rounded-md object-cover" />
                                    ) : null}
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{it.name}</span>
                                    <span className="whitespace-nowrap text-sm font-semibold text-slate-900">{itemPriceLabel(it.price, it.unit)}</span>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>
            )}

            {/* Slot picker — pick a DAY first (a row of day pills), then the
                times for that day, so it's never a wall of every day's slots at
                once. "N left" shows only when a SHARED session is genuinely low;
                a whole-hire session (capacity 1) never shows "1 left", which read
                as false scarcity on every slot. */}
            {isSlot && (
                <div className="mt-4">
                    {perItem && !item ? (
                        <p className="mt-2 text-sm text-slate-500">Pick a treatment to see its times.</p>
                    ) : days.length === 0 ? (
                        <p className="mt-2 text-sm text-slate-500">No times left during your stay.</p>
                    ) : (() => {
                        const active = Math.min(dayIdx, days.length - 1);
                        const day = days[active];
                        return (
                            <>
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pick a day</div>
                                <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                                    {days.map((d, i) => {
                                        const on = i === active;
                                        return (
                                            <button key={d.date} type="button" onClick={() => setDayIdx(i)}
                                                className={`flex-none rounded-lg border px-3 py-1.5 text-sm transition ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>
                                                {dateLabel(d.date)}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Pick a time</div>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {day.times.map((s) => {
                                        const on = session && session.date === s.date && session.time === s.time;
                                        // Per the CHOSEN option: impossible times are
                                        // greyed with the reason, not hidden and not
                                        // left to fail at the claim. Only per-person
                                        // shows "N left"; a whole-hire time never reads
                                        // "1 left" (false scarcity on every slot).
                                        const a = item ? availOf(s, item.unit) : null;
                                        // Overlap with a DIFFERENT booking greys a
                                        // per-treatment time even when its own seat is
                                        // free — the masseuse is busy across it.
                                        const overlap = overlapsABooking(s);
                                        const disabled = (!!a && !a.possible) || overlap;
                                        const label = overlap && (!a || a.possible) ? 'Unavailable' : (a && item ? unavailableLabel(a, item.unit) : '');
                                        const low = !overlap && !!item && !bookingIsPrivate(item.unit) && !!a && a.possible && a.seatsLeft >= 1 && a.seatsLeft <= 2;
                                        return (
                                            <button key={s.time} type="button" disabled={disabled} aria-disabled={disabled}
                                                onClick={() => { if (disabled) return; setSession(s); setQty(minPeople); }}
                                                title={disabled ? label : undefined}
                                                className={`rounded-lg border px-2.5 py-1.5 text-sm transition ${
                                                    disabled ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                                                        : on ? 'border-emerald-600 bg-emerald-600 text-white'
                                                            : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>
                                                {timeLabel(s.time)}
                                                {disabled && label ? <span className="ml-1 text-[10px] font-medium text-slate-400">{label}</span> : null}
                                                {low && a ? <span className={`ml-1 text-[10px] ${on ? 'text-emerald-100' : 'text-amber-600'}`}>{a.seatsLeft} left</span> : null}
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        );
                    })()}
                </div>
            )}

            {/* Quantity — only when the price multiplies */}
            {item && multiplies && (isSlot ? !!session : true) && (
                <label className="mt-4 block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {unitPhrase(item.unit) === 'per person' ? 'How many people?' : 'How many?'}
                    </span>
                    <input type="number" min={minPeople} max={seatCap} inputMode="numeric" value={qty}
                        onChange={(e) => setQty(Math.min(Math.max(minPeople, Math.floor(Number(e.target.value) || minPeople)), seatCap))}
                        className="mt-1 block w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                    {isSlot && sel ? <span className="ml-2 text-xs text-slate-400">{sel.seatsLeft} place{sel.seatsLeft === 1 ? '' : 's'} left</span> : null}
                    {minPeople > 1 ? <p className="mt-1 text-xs text-slate-500">This session is for {minPeople} people or more.</p> : null}
                </label>
            )}

            {/* Head count on a PRIVATE session — the whole session is theirs, so
                this doesn't change the price; it tells the provider how many to
                set up for. Only shown when the cap leaves a choice. */}
            {isPrivateSlot && !!session && attendeesCap > 1 && (
                <label className="mt-4 block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">How many people are coming?</span>
                    <input type="number" min={1} max={attendeesCap} inputMode="numeric" value={attendees}
                        onChange={(e) => setAttendees(Math.min(Math.max(1, Math.floor(Number(e.target.value) || 1)), attendeesCap))}
                        className="mt-1 block w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                    <p className="mt-1 text-xs text-slate-500">The price is for the whole session, however many come (up to {attendeesCap}).</p>
                </label>
            )}

            {/* Date — request shapes. A real calendar, matching the cottage
                booking: the dates inside the stay are live, everything else is
                greyed. minDate/maxDate do the greying; the same yyyy-mm-dd the
                server re-validates is what a click produces. */}
            {!isSlot && (
                <div className="mt-4">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date during your stay</span>
                    <div className="airbnb-compact-calendar mt-1.5 overflow-hidden rounded-xl border border-slate-200">
                        <Calendar
                            date={date ? keyToDate(date) : undefined}
                            onChange={(d: Date) => setDate(dateToKey(d))}
                            minDate={keyToDate(minDate)}
                            maxDate={keyToDate(maxDate)}
                            shownDate={keyToDate(minDate)}
                            color="#047857"
                            months={1}
                            showMonthAndYearPickers={false}
                            weekdayDisplayFormat="EEEEE"
                        />
                    </div>
                    {provider.shape === 'made_to_order' && provider.leadTimeDays > 0 ? (
                        <span className="mt-1 block text-xs text-slate-400">{provider.who} needs {provider.leadTimeDays} day{provider.leadTimeDays === 1 ? '' : 's'} notice.</span>
                    ) : null}
                </div>
            )}

            {/* For a food business, allergies get their own field — safety
                information a cook must not skim past, kept separate so it routes
                on its own (its own line in the email, its own badge). */}
            {provider.isFood && (
                <label className="mt-4 block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                        Allergies &amp; dietary needs
                        <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">(optional)</span>
                    </span>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {COMMON_ALLERGENS.map((a) => {
                            const on = allergyTags.includes(a);
                            return (
                                <button key={a} type="button"
                                    aria-pressed={on}
                                    onClick={() => setAllergyTags((prev) => on ? prev.filter((x) => x !== a) : [...prev, a])}
                                    className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? 'border-rose-500 bg-rose-500 text-white' : 'border-rose-300 text-rose-700 hover:border-rose-400'}`}>
                                    {a}
                                </button>
                            );
                        })}
                    </div>
                    <textarea
                        value={allergy}
                        onChange={(e) => setAllergy(e.target.value.slice(0, 500))}
                        rows={2}
                        maxLength={500}
                        placeholder="e.g. one coeliac, one severe nut allergy"
                        className="mt-1 block w-full resize-y rounded-lg border border-rose-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                    <span className="mt-1 block text-xs text-slate-400">
                        {provider.who} sees this {isSlot ? 'with your booking' : 'before they confirm'}. Name any allergy — they’ll be in touch if they can’t safely cater for it.
                    </span>
                </label>
            )}

            {/* The general note, on every shape — access, timing, a request. */}
            <label className="mt-4 block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Anything {provider.who} should know?
                    <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">(optional)</span>
                </span>
                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 500))}
                    rows={2}
                    maxLength={500}
                    placeholder={provider.shape === 'made_to_order'
                        // A made-to-order thing isn't a party: it has a size, a
                        // message, and collection or delivery — not a headcount.
                        ? 'e.g. collection Saturday morning, or drop-off at the cottage; and a message to write on it.'
                        : provider.isFood
                            ? 'Anything else — e.g. “it’s mum’s 60th, could you pipe a message”.'
                            : 'e.g. “we’re on the top floor, the buzzer doesn’t work” — or a special request.'}
                    className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
            </label>

            {/* Where a TRAVELLING session comes — the guest picks their stay. One
                option today (the cottage this booking is for), shown selected; a
                guest with no booking types an address instead (not built here).
                The address is frozen onto the order server-side; the provider only
                sees it once the booking is paid. */}
            {travels && (
                <div className="mt-4 rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where {provider.who} comes</p>
                    <div className="mt-2 flex items-start gap-2.5">
                        <span aria-hidden className="mt-1 inline-block h-3.5 w-3.5 shrink-0 rounded-full border-[4px] border-emerald-600" />
                        <div className="text-sm">
                            <div className="font-medium text-slate-900">Your stay{stay?.title ? ' — ' + stay.title : ''}</div>
                            <div className="text-slate-500">{stayTown || 'The cottage you booked'}</div>
                        </div>
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-slate-400">
                        {provider.who} gets the address once you’ve paid — not before.
                    </p>
                </div>
            )}

            {/* Total, spelled out when it multiplies */}
            {item && multiplies && (
                <div className="mt-4 text-sm text-slate-700">
                    {itemPriceLabel(item.price, item.unit)} × {quantity}
                    <span className="mx-1">=</span>
                    <span className="font-semibold text-slate-900">£{total.toFixed(2)}</span>
                </div>
            )}

            {/* The reassurance, per shape */}
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                {isSlot ? (
                    <><span className="font-semibold text-slate-900">Paid now, confirmed straight away.</span> Your place is held while you pay.</>
                ) : (
                    <><span className="font-semibold text-slate-900">Your card isn’t charged yet.</span> {provider.who} has 48 hours to confirm; if they decline or don’t reply, nothing is taken.</>
                )}
            </p>

            {/* Desktop keeps the button inline at the foot of the panel; on a
                phone the fixed bar below is the primary action, so it isn't
                doubled up. */}
            <button type="button" onClick={go} disabled={busy}
                className="mt-3 hidden w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60 lg:block">
                {ctaLabel}
            </button>

            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

            <p className="mt-3 text-[11px] leading-snug text-slate-400">
                You’re booking {provider.business_name}. Galloway Getaways takes the payment on their
                behalf and is not the provider.
            </p>

            {/* The fixed "Book · £X" bar — the mobile standard, always within
                thumb reach however far down the form the guest has scrolled. When
                nothing is picked yet it scrolls up to the form instead of firing a
                hidden error. Desktop hides it (the inline button is right there). */}
            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur lg:hidden">
                <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-base font-semibold text-slate-900">
                            {item ? itemPriceLabel(item.price, item.unit) : (provider.items.length ? itemPriceLabel(Math.min(...provider.items.map((i) => i.price)), provider.items[0].unit) : '')}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                            {ready
                                ? (multiplies && total ? `Total £${total.toFixed(2)}` : (isSlot ? 'Paid now' : 'Card not charged yet'))
                                : (isSlot ? 'Pick a time' : 'Pick a date')}
                        </div>
                    </div>
                    <button type="button" onClick={ready ? go : scrollToForm} disabled={busy}
                        className="flex-none rounded-xl bg-emerald-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60">
                        {ctaLabel}
                    </button>
                </div>
            </div>
            {/* Keeps the fixed bar from covering the foot of the form on a phone. */}
            <div className="h-16 lg:hidden" aria-hidden />
        </div>
    );
}
