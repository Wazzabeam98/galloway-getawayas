'use client';

import { useMemo, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { dateLabel } from '@/components/marketplace/present';
import MonthCalendar from '@/components/marketplace/MonthCalendar';
import { useFoodCart } from '@/components/marketplace/FoodCart';

const COMMON_ALLERGENS = ['Nuts', 'Peanuts', 'Gluten', 'Dairy', 'Eggs', 'Fish', 'Shellfish', 'Soya', 'Sesame'];
const dayKeyFromNow = (days: number) => shiftDayKey(londonDayKey(), days);
const lastNight = (checkOut: string) => shiftDayKey(String(checkOut).slice(0, 10), -1);
const maxKey = (a: string, b: string) => (a > b ? a : b);

// THE BASKET for a made-to-order (food-ordering) listing — the sidebar beside the
// menu. It reads the shared cart, takes a collection/delivery DATE ONLY (the time
// is arranged by message afterwards), a delivery address when the order delivers,
// and any allergy, then sends the order. A cart of only standard items books and
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
    const [address, setAddress] = useState('');
    const [allergy, setAllergy] = useState('');
    const [allergyTags, setAllergyTags] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    async function send() {
        setError(null);
        if (!lines.length) { setError('Add something from the menu first.'); return; }
        if (!date) { setError('Pick a ' + deliverWord + ' date.'); return; }
        if (needsAddress && !address.trim()) { setError('Add the delivery address.'); return; }
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

    return (
        <div className="flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
            <div className="flex-none border-b border-slate-100 px-5 pt-5 pb-4">
                <div className="flex items-center gap-2 text-slate-900">
                    <ShoppingBag className="h-5 w-5 flex-none text-slate-500" aria-hidden />
                    <span className="text-lg font-semibold">Your basket</span>
                </div>
                <span className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${hasCustom ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>
                    {hasCustom ? `Request — ${who} has 48 hours to confirm` : 'Books instantly'}
                </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {lines.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">Your basket is empty — add something from the menu.</p>
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
                        <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Pick a {deliverWord} date</div>
                        <div className="mt-1 rounded-xl border border-slate-200 px-3 pb-2">
                            <MonthCalendar availableDays={availableDays} selected={date || null} onSelect={setDate} today={londonDayKey()} />
                        </div>
                        <p className="mt-1.5 text-xs text-slate-400">The {deliverWord} time is arranged by message once your order is placed.</p>

                        {needsAddress && (
                            <label className="mt-4 block">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery address</span>
                                <textarea value={address} onChange={(e) => setAddress(e.target.value.slice(0, 300))} rows={2}
                                    className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
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
                <button type="button" onClick={send} disabled={busy || !lines.length || !date}
                    className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                    {busy ? 'Sending…' : (hasCustom ? 'Send request' : 'Book & pay')}
                </button>
                <p className="mt-2 text-xs text-slate-400">{hasCustom
                    ? `Your card is held, not charged, until ${who} accepts your made-to-order items.`
                    : 'You pay now and your order is confirmed straight away.'}</p>
            </div>
        </div>
    );
}
