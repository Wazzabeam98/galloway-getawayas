'use client';

import { useMemo, useState } from 'react';
import { Calendar } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import { unitMultiplies, orderTotal, MAX_ORDER_QUANTITY } from '@/lib/serviceOrders';
import { itemPriceLabel, unitPhrase, dateLabel, timeLabel } from '@/components/marketplace/present';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';

interface PanelItem { id: string; name: string; description: string | null; price: number; unit: string; image: string | null; }
interface PanelSession { date: string; time: string; capacity: number; seatsLeft: number; }
interface PanelProvider {
    id: string; business_name: string; who: string; shape: string; isFood: boolean;
    items: PanelItem[]; sessions: PanelSession[]; leadTimeDays: number;
}

// Between a yyyy-mm-dd key and a local Date at midnight. Constructing from the
// parts (not new Date(key), which parses as UTC) keeps the calendar day the guest
// clicks and the key we send to the server the same, in any timezone.
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

export default function BookingPanel({ bookingId, checkIn, checkOut, provider }: {
    bookingId: string; checkIn: string; checkOut: string; provider: PanelProvider;
}) {
    const isSlot = provider.shape === 'slot';
    const [itemId, setItemId] = useState<string>(provider.items.length === 1 ? provider.items[0].id : '');
    const [qty, setQty] = useState<number>(1);
    const [date, setDate] = useState<string>('');
    const [session, setSession] = useState<PanelSession | null>(null);
    const [allergy, setAllergy] = useState<string>('');
    const [note, setNote] = useState<string>('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const item = isSlot ? provider.items[0] : (provider.items.find((i) => i.id === itemId) || null);
    const multiplies = !!item && unitMultiplies(item.unit);

    // Sessions grouped by day, for the slot picker.
    const days = useMemo(() => {
        const m: Record<string, PanelSession[]> = {};
        for (const s of provider.sessions) (m[s.date] = m[s.date] || []).push(s);
        return Object.keys(m).sort().map((d) => ({ date: d, times: m[d].sort((a, b) => a.time.localeCompare(b.time)) }));
    }, [provider.sessions]);

    const seatCap = isSlot && session ? Math.min(MAX_ORDER_QUANTITY, session.seatsLeft) : MAX_ORDER_QUANTITY;
    const quantity = multiplies ? Math.min(Math.max(1, Math.floor(qty) || 1), seatCap) : 1;
    const total = item ? orderTotal(item.price, quantity) : 0;

    const minDate = maxKey(checkIn.slice(0, 10), dayKeyFromNow(provider.shape === 'made_to_order' ? provider.leadTimeDays : 0));
    const maxDate = lastNight(checkOut);

    async function go() {
        setError(null);
        if (!item) { setError('Pick one first.'); return; }
        if (isSlot && !session) { setError('Pick a time first.'); return; }
        if (!isSlot && !date) { setError('Pick a date first.'); return; }
        setBusy(true);
        try {
            const url = isSlot ? '/api/services/slots/book' : '/api/services/order';
            const trimmedNote = note.trim();
            const trimmedAllergy = provider.isFood ? allergy.trim() : '';
            const body = isSlot
                ? { providerId: provider.id, bookingId, sessionDate: session!.date, sessionTime: session!.time, quantity, note: trimmedNote, allergy: trimmedAllergy }
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
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200/80">
            <div className="flex items-baseline justify-between gap-3">
                <div className="text-2xl font-semibold text-stone-900">
                    {item ? itemPriceLabel(item.price, item.unit) : (provider.items.length ? itemPriceLabel(Math.min(...provider.items.map((i) => i.price)), provider.items[0].unit) : '')}
                </div>
                {!isSlot && provider.items.length > 1 && !item ? (
                    <span className="text-sm text-stone-400">choose below</span>
                ) : null}
            </div>

            {/* Menu pick — request shapes with more than one item */}
            {!isSlot && provider.items.length > 1 && (
                <fieldset className="mt-4">
                    <legend className="text-xs font-semibold uppercase tracking-wide text-stone-500">Choose</legend>
                    <div className="mt-2 space-y-1.5">
                        {provider.items.map((it) => {
                            const on = itemId === it.id;
                            return (
                                <label key={it.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${on ? 'border-emerald-600 bg-emerald-50/60' : 'border-stone-200 hover:border-stone-300'}`}>
                                    <input type="radio" name="item" checked={on} onChange={() => setItemId(it.id)} className="accent-emerald-600" />
                                    {it.image ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={it.image} alt="" className="h-9 w-9 rounded-md object-cover" />
                                    ) : null}
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">{it.name}</span>
                                    <span className="whitespace-nowrap text-sm font-semibold text-stone-900">{itemPriceLabel(it.price, it.unit)}</span>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>
            )}

            {/* Slot picker — days and times, with seats left */}
            {isSlot && (
                <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Pick a time</div>
                    {days.length === 0 ? (
                        <p className="mt-2 text-sm text-stone-500">No times left during your stay.</p>
                    ) : (
                        <div className="mt-2 max-h-64 space-y-3 overflow-y-auto pr-1">
                            {days.map((d) => (
                                <div key={d.date}>
                                    <div className="text-xs font-medium text-stone-500">{dateLabel(d.date)}</div>
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                        {d.times.map((s) => {
                                            const on = session && session.date === s.date && session.time === s.time;
                                            const low = s.seatsLeft <= 2;
                                            return (
                                                <button key={s.time} type="button"
                                                    onClick={() => { setSession(s); setQty(1); }}
                                                    className={`rounded-lg border px-2.5 py-1.5 text-sm transition ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300 text-stone-700 hover:border-stone-400'}`}>
                                                    {timeLabel(s.time)}
                                                    {low ? <span className={`ml-1 text-[10px] ${on ? 'text-emerald-100' : 'text-amber-600'}`}>{s.seatsLeft} left</span> : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Quantity — only when the price multiplies */}
            {item && multiplies && (isSlot ? !!session : true) && (
                <label className="mt-4 block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                        {unitPhrase(item.unit) === 'per person' ? 'How many people?' : 'How many?'}
                    </span>
                    <input type="number" min={1} max={seatCap} inputMode="numeric" value={qty}
                        onChange={(e) => setQty(Math.min(Math.max(1, Math.floor(Number(e.target.value) || 1)), seatCap))}
                        className="mt-1 block w-24 rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                    {isSlot && session ? <span className="ml-2 text-xs text-stone-400">{session.seatsLeft} place{session.seatsLeft === 1 ? '' : 's'} left</span> : null}
                </label>
            )}

            {/* Date — request shapes. A real calendar, matching the cottage
                booking: the dates inside the stay are live, everything else is
                greyed. minDate/maxDate do the greying; the same yyyy-mm-dd the
                server re-validates is what a click produces. */}
            {!isSlot && (
                <div className="mt-4">
                    <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Date during your stay</span>
                    <div className="airbnb-compact-calendar mt-1.5 overflow-hidden rounded-xl border border-stone-200">
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
                        <span className="mt-1 block text-xs text-stone-400">{provider.who} needs {provider.leadTimeDays} day{provider.leadTimeDays === 1 ? '' : 's'} notice.</span>
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
                        <span className="ml-1 font-normal normal-case tracking-normal text-stone-400">(optional)</span>
                    </span>
                    <textarea
                        value={allergy}
                        onChange={(e) => setAllergy(e.target.value.slice(0, 500))}
                        rows={2}
                        maxLength={500}
                        placeholder="e.g. one coeliac, one severe nut allergy"
                        className="mt-1 block w-full resize-y rounded-lg border border-rose-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                    <span className="mt-1 block text-xs text-stone-400">
                        {provider.who} sees this {isSlot ? 'with your booking' : 'before they confirm'}. Name any allergy — they’ll be in touch if they can’t safely cater for it.
                    </span>
                </label>
            )}

            {/* The general note, on every shape — access, timing, a request. */}
            <label className="mt-4 block">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Anything {provider.who} should know?
                    <span className="ml-1 font-normal normal-case tracking-normal text-stone-400">(optional)</span>
                </span>
                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 500))}
                    rows={2}
                    maxLength={500}
                    placeholder={provider.isFood
                        ? 'Anything else — e.g. “it’s mum’s 60th, could you pipe a message”.'
                        : 'e.g. “we’re on the top floor, the buzzer doesn’t work” — or a special request.'}
                    className="mt-1 block w-full resize-y rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
            </label>

            {/* Total, spelled out when it multiplies */}
            {item && multiplies && (
                <div className="mt-4 text-sm text-stone-700">
                    {itemPriceLabel(item.price, item.unit)} × {quantity}
                    <span className="mx-1">=</span>
                    <span className="font-semibold text-stone-900">£{total.toFixed(2)}</span>
                </div>
            )}

            {/* The reassurance, per shape */}
            <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
                {isSlot ? (
                    <><span className="font-semibold text-stone-900">Paid now, confirmed straight away.</span> Your place is held while you pay.</>
                ) : (
                    <><span className="font-semibold text-stone-900">Your card isn’t charged yet.</span> {provider.who} has 48 hours to confirm; if they decline or don’t reply, nothing is taken.</>
                )}
            </p>

            <button type="button" onClick={go} disabled={busy}
                className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60">
                {busy ? (isSlot ? 'Booking…' : 'Sending…') : (isSlot ? (total ? `Book · £${total.toFixed(2)}` : 'Book') : 'Send request')}
            </button>

            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

            <p className="mt-3 text-[11px] leading-snug text-stone-400">
                You’re booking {provider.business_name}. Galloway Getaways takes the payment on their
                behalf and is not the provider.
            </p>
        </div>
    );
}
