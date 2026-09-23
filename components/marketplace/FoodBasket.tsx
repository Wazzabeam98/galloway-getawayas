'use client';

import { useMemo, useState } from 'react';
import { ShoppingBag, X } from 'lucide-react';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { dateLabel } from '@/components/marketplace/present';
import { DateOnlyDialog } from '@/components/marketplace/RequestBooking';
import { hasUkPostcode } from '@/lib/postcode';
import { useFoodCart } from '@/components/marketplace/FoodCart';

const COMMON_ALLERGENS = ['Nuts', 'Peanuts', 'Gluten', 'Dairy', 'Eggs', 'Fish', 'Shellfish', 'Soya', 'Sesame'];
const dayKeyFromNow = (days: number) => shiftDayKey(londonDayKey(), days);
const lastNight = (checkOut: string) => shiftDayKey(String(checkOut).slice(0, 10), -1);
const maxKey = (a: string, b: string) => (a > b ? a : b);

// THE BASKET for a made-to-order (food-ordering) listing. On desktop it's the
// sidebar beside the menu; on mobile the sidebar would be a wall of form below the
// menu, so instead a sticky bottom bar shows the item count and total, and tapping
// it opens the same basket as a bottom sheet. Both surfaces are the one component
// instance, so they share every field (date, address, allergy) — only one is ever
// visible.
//
// It reads the shared cart, takes a collection/delivery DATE ONLY (the time is
// arranged by message afterwards), a delivery address when the order delivers, and
// any allergy, then places the order. A cart of only standard items orders and
// pays instantly; a custom item makes the whole order a held request.
export default function FoodBasket({
    who, isFood, fulfilment, bookingId, standalone: standaloneProp, checkIn, checkOut, leadTimeDays = 1, horizonDays = 90,
}: {
    who: string; isFood: boolean; fulfilment?: string | null;
    bookingId?: string; standalone?: boolean; checkIn?: string; checkOut?: string;
    leadTimeDays?: number; horizonDays?: number;
}) {
    const { lines, total, count, hasCustom } = useFoodCart();
    const standalone = standaloneProp ?? !bookingId;
    const [date, setDate] = useState('');
    const [dateOpen, setDateOpen] = useState(false);
    const [address, setAddress] = useState('');
    const [allergy, setAllergy] = useState('');
    const [allergyTags, setAllergyTags] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Mobile only: is the basket sheet open. Desktop ignores this (the sidebar is
    // always in view).
    const [mobileOpen, setMobileOpen] = useState(false);

    const lead = Math.max(1, leadTimeDays || 1);
    const minDate = standalone ? dayKeyFromNow(lead) : maxKey(String(checkIn).slice(0, 10), dayKeyFromNow(lead));
    const maxDate = standalone ? dayKeyFromNow(Math.max(1, horizonDays || 90)) : lastNight(String(checkOut));
    const availableDays = useMemo(() => {
        const set = new Set<string>(); let d = minDate;
        for (let i = 0; i < 366 && d <= maxDate; i++) { set.add(d); d = shiftDayKey(d, 1); }
        return set;
    }, [minDate, maxDate]);

    const delivers = fulfilment === 'delivery' || (fulfilment === 'both' && lines.some((l) => String(l.it.fulfilment) === 'delivery'));
    const needsAddress = standalone && delivers;
    const deliverWord = delivers ? 'delivery' : 'collection';
    const suggested = useMemo(() => Array.from(availableDays).sort().slice(0, 4), [availableDays]);
    const canSend = !busy && lines.length > 0 && !!date && !(needsAddress && !hasUkPostcode(address));

    async function send() {
        setError(null);
        if (!lines.length) { setError('Add something from the menu first.'); return; }
        if (!date) { setError('Pick a ' + deliverWord + ' date.'); return; }
        if (needsAddress && !hasUkPostcode(address)) { setError('Add a full delivery address, including a postcode.'); return; }
        setBusy(true);
        try {
            const trimmedAllergy = [allergyTags.join(', '), allergy.trim()].filter(Boolean).join(allergyTags.length && allergy.trim() ? ' — ' : '');
            const res = await fetch('/api/services/order', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: lines.map((l) => ({ itemId: l.it.id, qty: l.qty })),
                    bookingId, serviceDate: date,
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

    // The card content — the same header, body and footer whether it sits in the
    // desktop sidebar or the mobile sheet.
    const content = (
        <>
            <div className="flex-none border-b border-slate-100 px-5 pt-5 pb-4">
                <div className="flex items-center gap-2 text-slate-900">
                    <ShoppingBag className="h-5 w-5 flex-none text-slate-500" aria-hidden />
                    <span className="text-lg font-semibold">Your order</span>
                </div>
                {lines.length > 0 && (
                    <span className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${hasCustom ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>
                        {hasCustom ? `Request — ${who} has 48 hours to confirm` : 'Orders instantly'}
                    </span>
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {lines.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                            <ShoppingBag className="h-7 w-7" aria-hidden />
                        </span>
                        <p className="mt-4 font-semibold text-slate-900">Your basket is empty</p>
                        <p className="mt-1 text-sm text-slate-500">Add something from the menu and it’ll show up here, ready to order.</p>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {lines.map((l) => (
                            <li key={l.it.id} className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="min-w-0 text-slate-800"><span className="font-medium">{l.qty} ×</span> {l.it.name}</span>
                                <span className="tabular-nums font-medium text-slate-900">£{(l.it.price * l.qty).toFixed(2)}</span>
                            </li>
                        ))}
                    </ul>
                )}

                {lines.length > 0 && (
                    <>
                        {/* Compact date, like the slots: a "Show dates" button and a
                            few suggested days; the full calendar opens in a dialog. */}
                        <div className="mt-4 flex items-center justify-between gap-3">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{deliverWord === 'delivery' ? 'Delivery' : 'Collection'} date</span>
                            <button type="button" onClick={() => setDateOpen(true)}
                                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-800">
                                {date ? dateLabel(date) : 'Show dates'}
                            </button>
                        </div>
                        {!date && suggested.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {suggested.map((d) => (
                                    <button key={d} type="button" onClick={() => setDate(d)}
                                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400">
                                        {dateLabel(d)}
                                    </button>
                                ))}
                            </div>
                        )}
                        <p className="mt-1.5 text-xs text-slate-400">The {deliverWord} time is arranged by message once your order is placed.</p>

                        {needsAddress && (
                            <label className="mt-4 block">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery address</span>
                                <textarea value={address} onChange={(e) => setAddress(e.target.value.slice(0, 300))} rows={2} placeholder="Full address, including postcode"
                                    className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                                {address.trim() && !hasUkPostcode(address) && (
                                    <span className="mt-1 block text-xs text-rose-600">Please give a full address, including a postcode.</span>
                                )}
                            </label>
                        )}

                        {isFood && (
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
                )}
            </div>

            <div className="flex-none border-t border-slate-100 px-5 py-4">
                {error && <p className="mb-2 text-sm text-rose-700">{error}</p>}
                <div className="mb-3 flex items-baseline justify-between">
                    <span className="text-sm font-medium text-slate-600">Total{count > 0 ? ` · ${count} item${count === 1 ? '' : 's'}` : ''}</span>
                    <span className="text-lg font-semibold text-slate-900">£{total.toFixed(2)}</span>
                </div>
                <button type="button" onClick={send} disabled={!canSend}
                    className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                    {busy ? 'Sending…' : (hasCustom ? 'Send order request' : 'Place order & pay')}
                </button>
                <p className="mt-2 text-xs text-slate-400">{hasCustom
                    ? `Your card is held, not charged, until ${who} accepts your made-to-order items.`
                    : 'You pay now and your order is confirmed straight away.'}</p>
            </div>
        </>
    );

    return (
        <>
            {/* Desktop: the sidebar basket, always in view. */}
            <div className="hidden lg:flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                {content}
            </div>

            {/* Mobile: a sticky bottom bar with the count and total; tapping opens
                the full basket as a sheet. Shown only once something's in it. */}
            {count > 0 && !mobileOpen && (
                <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
                    <button type="button" onClick={() => setMobileOpen(true)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl bg-emerald-700 px-4 py-3 text-white transition hover:bg-emerald-800">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                            <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-white/20 px-1.5 text-xs font-bold tabular-nums">{count}</span>
                            View basket
                        </span>
                        <span className="text-sm font-bold tabular-nums">£{total.toFixed(2)}</span>
                    </button>
                </div>
            )}

            {/* Mobile: the basket sheet. */}
            {mobileOpen && (
                <div className="lg:hidden fixed inset-0 z-[60] flex items-end justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Your order"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setMobileOpen(false); }}>
                    <div className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white">
                        <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close"
                            className="absolute right-3 top-4 z-10 rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                        {content}
                    </div>
                </div>
            )}

            {dateOpen && (
                <DateOnlyDialog
                    title={`Choose a ${deliverWord} date`}
                    availableDays={availableDays}
                    selected={date || null}
                    onSelect={(d) => { setDate(d); setDateOpen(false); }}
                    onClose={() => setDateOpen(false)}
                />
            )}
        </>
    );
}
