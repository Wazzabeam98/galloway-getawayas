'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Minus, Plus } from 'lucide-react';
import { optionAvailability, seatConfig } from '@/lib/serviceSlots';
import { unitMultiplies, MAX_ORDER_QUANTITY } from '@/lib/serviceOrders';
import { itemPriceLabel, dateLabel, timeLabel } from '@/components/marketplace/present';

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

// THE "SHOW DATES" DIALOG — the Airbnb-shaped availability picker, shared by both
// booking panels. A guest sets how many people, scrolls EVERY available date
// grouped by day, and taps a large slot card (time · price/person · places left).
// A declared session is the same card at the same standard, marked as a named
// event (violet + its title). Selecting a slot and pressing Book goes straight to
// Stripe Checkout — the panel's onBook does the POST + redirect; no contact is
// collected here (Checkout does that).
export default function BookingDialog({
    who, items, sessions, sessionsForItem, declaredSessions, providerCapacity, providerMinPeople, providerFulfilment, isFood, busy, error, onBook, onClose,
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

    const item = items.find((i) => i.id === itemId) || items[0] || null;
    const perPerson = !!item && unitMultiplies(item.unit);
    const travels = !!item && (String(item.fulfilment) === 'delivery' || (item.fulfilment == null && providerFulfilment === 'delivery'));

    // Esc closes; lock the background scroll while open.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [onClose]);

    // Every offering, chronological, dropped when it's in the past isn't needed —
    // the parent already windows and futures the lists.
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

    const selected = offerings.find((o) => o.key === selKey) || null;
    // Keep the selection valid as the party size / item changes.
    useEffect(() => { if (selected && !fits(selected)) setSelKey(null); /* eslint-disable-next-line */ }, [people, itemId]);

    const minPeople = item && perPerson ? Math.max(1, Number(item.minPeople ?? providerMinPeople) || 1) : 1;
    useEffect(() => { setPeople((p) => Math.max(minPeople, p)); }, [minPeople]);

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
                    <h2 className="text-lg font-bold text-slate-900">Choose a time</h2>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>

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

                {/* The day-grouped, scrollable list of large slot cards */}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    {days.length === 0 ? (
                        <p className="py-8 text-center text-sm text-slate-500">No times available just now — check back soon.</p>
                    ) : days.map((d) => (
                        <div key={d.date} className="mb-5 last:mb-0">
                            <div className="mb-2 text-sm font-semibold text-slate-900">{dateLabel(d.date)}</div>
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
                                                <span className={`block ${declared && o.title ? 'text-sm text-slate-500' : 'text-[15px] font-semibold text-slate-900'}`}>{timeLabel(o.time + ':00')}{declared && o.title ? '' : ''}</span>
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
                    <p className="mt-2 text-[11px] text-slate-400">You’ll enter your details securely at checkout. Galloway Getaways takes the payment on {who}’s behalf and is not the provider.</p>
                </div>
            </div>
        </div>
    );
}
