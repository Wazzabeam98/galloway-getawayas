'use client';

import { useMemo, useState } from 'react';
import LoginModel from '@/components/auth/LoginModel';
import { unitMultiplies } from '@/lib/serviceOrders';
import { optionAvailability, bookingIsPrivate } from '@/lib/serviceSlots';
import { itemPriceLabel, dateLabel, timeLabel } from '@/components/marketplace/present';

interface PanelItem { id: string; name: string; price: number; unit: string; image: string | null; fulfilment?: string | null; }
interface PanelSession { date: string; time: string; row: { capacity: number; seats_taken: number; private: boolean } | null; }

// The standalone (bookingless) booking box for a SLOT experience — the public
// listing's right column. Browsing is public; booking needs an account, so a
// logged-out visitor gets a sign-in prompt here (LoginModel), never a checkout
// that fails. The date is any day the provider is open within the horizon (the
// sessions are already generated over it); a travelling session's address is
// typed in (no cottage to pick). Rules unchanged: first name only, no address
// before payment. The slots/book route re-validates everything server-side.
export default function StandaloneBookingPanel({ provider, signedIn, signInNext }: {
    provider: {
        id: string; who: string; shape: string; fulfilment?: string | null;
        slotCapacity: number; minPeople: number; items: PanelItem[]; sessions: PanelSession[];
    };
    signedIn: boolean;
    signInNext: string;
}) {
    const [itemId, setItemId] = useState<string>(provider.items.length === 1 ? provider.items[0].id : '');
    const [date, setDate] = useState<string>('');
    const [time, setTime] = useState<string>('');
    const [qty, setQty] = useState<number>(1);
    const [attendees, setAttendees] = useState<number>(1);
    const [address, setAddress] = useState<string>('');
    const [note, setNote] = useState<string>('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const item = provider.items.find((i) => i.id === itemId) || null;
    const perPerson = !!item && unitMultiplies(item.unit);
    const travels = !!item && (String(item.fulfilment) === 'delivery' || (item.fulfilment == null && provider.fulfilment === 'delivery'));

    const days = useMemo(() => Array.from(new Set(provider.sessions.map((s) => s.date))), [provider.sessions]);
    const times = useMemo(() => provider.sessions.filter((s) => s.date === date), [provider.sessions, date]);
    const chosen = provider.sessions.find((s) => s.date === date && s.time === time) || null;

    const priceLabel = item ? itemPriceLabel(item.price, item.unit) : (provider.items.length ? 'from ' + itemPriceLabel(Math.min(...provider.items.map((i) => i.price)), provider.items[0].unit) : '');

    async function book() {
        if (!item || !date || !time) { setError('Pick a treatment, a day and a time.'); return; }
        if (travels && !address.trim()) { setError('Add the address the provider should come to.'); return; }
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/services/slots/book', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerId: provider.id, itemId: item.id, sessionDate: date, sessionTime: time,
                    quantity: perPerson ? qty : 1, attendees: perPerson ? undefined : attendees,
                    serviceAddress: travels ? address.trim() : undefined, note: note.trim() || undefined,
                }),
            });
            const j = await res.json();
            if (!res.ok || !j.ok || !j.url) { setError(j.error || 'Could not start that. Try again.'); setBusy(false); return; }
            window.location.href = j.url;
        } catch {
            setError('Could not start that. Try again.'); setBusy(false);
        }
    }

    return (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
            <div className="text-2xl font-semibold text-slate-900">{priceLabel}</div>
            <span className="mt-2 inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                Instant book — confirmed straight away
            </span>

            {/* Availability is public — a logged-out visitor sees the days, times
                and spots left, the same as Airbnb. Only the booking form and
                button below are gated behind sign-in. */}
            <div className="mt-4">
                {provider.items.length > 1 && (
                    <fieldset className="mb-4">
                        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose</legend>
                        <div className="mt-2 space-y-1.5">
                            {provider.items.map((it) => (
                                <label key={it.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${itemId === it.id ? 'border-emerald-600 bg-emerald-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
                                    <input type="radio" name="item" checked={itemId === it.id} onChange={() => { setItemId(it.id); setTime(''); }} className="accent-emerald-600" />
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{it.name}</span>
                                    <span className="whitespace-nowrap text-sm font-semibold text-slate-900">{itemPriceLabel(it.price, it.unit)}</span>
                                </label>
                            ))}
                        </div>
                    </fieldset>
                )}

                {days.length === 0 ? (
                    <p className="text-sm text-slate-500">No times available just now — check back soon.</p>
                ) : (
                    <>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pick a day</div>
                        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                            {days.map((d) => (
                                <button key={d} type="button" onClick={() => { setDate(d); setTime(''); }}
                                    className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium ${date === d ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                                    {dateLabel(d)}
                                </button>
                            ))}
                        </div>

                        {date && (
                            <>
                                <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Pick a time</div>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {times.map((s) => {
                                        const a = item ? optionAvailability(s.row, item.unit, { slot_capacity: provider.slotCapacity, slot_min_people: provider.minPeople }) : null;
                                        const left = a && s.row && bookingIsPrivate(item!.unit) === false && a.possible ? a.seatsLeft : null;
                                        return (
                                            <button key={s.time} type="button" onClick={() => setTime(s.time)}
                                                className={`rounded-lg border px-3 py-1.5 text-sm ${time === s.time ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                                                {timeLabel(s.time)}{left != null && left <= 3 ? ` · ${left} left` : ''}
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </>
                )}

                {!signedIn ? (
                    <div className="mt-5 border-t border-slate-100 pt-4">
                        <p className="text-sm text-slate-600">Booking needs an account — it&apos;s how {provider.who} reaches you and how your booking is kept. Browsing and checking times is free.</p>
                        <div className="mt-3"><LoginModel next={signInNext} /></div>
                        <p className="mt-2 text-xs text-slate-400">Sign in or create an account to book.</p>
                    </div>
                ) : (
                <>
                    {item && perPerson && (
                        <label className="mt-4 block">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">How many people</span>
                            <input type="number" min={provider.minPeople || 1} value={qty}
                                onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                className="mt-1 block w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                        </label>
                    )}

                    {item && travels && (
                        <label className="mt-4 block">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where should they come?</span>
                            <textarea value={address} onChange={(e) => setAddress(e.target.value.slice(0, 300))} rows={2}
                                placeholder="The address the provider travels to"
                                className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                            <span className="mt-1 block text-xs text-slate-400">Shared with {provider.who} once your booking is paid.</span>
                        </label>
                    )}

                    <label className="mt-4 block">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Anything {provider.who} should know? <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></span>
                        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2}
                            placeholder="e.g. a special request" className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                    </label>

                    {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}

                    <button type="button" onClick={book} disabled={busy || !item || !date || !time}
                        className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                        {busy ? 'Starting…' : 'Book'}
                    </button>
                    <p className="mt-2 text-xs text-slate-400">Paid now, confirmed straight away. Galloway Getaways takes the payment on {provider.who}&apos;s behalf and is not the provider.</p>
                </>
                )}
            </div>
        </div>
    );
}
