'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingBag, X, ChevronDown } from 'lucide-react';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { dateLabel, cancellationBadge } from '@/components/marketplace/present';
import { DateOnlyDialog } from '@/components/marketplace/RequestBooking';
import { hasUkPostcode } from '@/lib/postcode';
import { useFoodCart } from '@/components/marketplace/FoodCart';

const COMMON_ALLERGENS = ['Nuts', 'Peanuts', 'Gluten', 'Dairy', 'Eggs', 'Fish', 'Shellfish', 'Soya', 'Sesame'];
const dayKeyFromNow = (days: number) => shiftDayKey(londonDayKey(), days);
const lastNight = (checkOut: string) => shiftDayKey(String(checkOut).slice(0, 10), -1);
const maxKey = (a: string, b: string) => (a > b ? a : b);

// THE BASKET for a made-to-order (food-ordering) listing, in the same Airbnb-style
// booking card as the slot and comes-to-you panels (present.cancellationBadge, the
// lifted card token). On desktop it's the sidebar beside the menu; on mobile a
// sticky bottom bar shows the count and total, and tapping it opens the same basket
// as a bottom sheet. Both surfaces are the one instance, so they share every field.
//
// It reads the shared cart and takes a collection/delivery DATE ONLY (the time is
// arranged by message afterwards). A "both" provider gets a Collection / Delivery
// switch; delivery adds the provider's delivery fee and, standalone, asks for an
// address (against a stay it goes to the cottage). A cart of only standard items
// orders and pays instantly; a custom item makes the whole order a held request.
export default function FoodBasket({
    who, isFood, fulfilment, deliveryFee = 0, bookingId, standalone: standaloneProp,
    checkIn, checkOut, leadTimeDays = 0, horizonDays = 90, cancellationHours, noRefund,
}: {
    who: string; isFood: boolean; fulfilment?: string | null; deliveryFee?: number;
    bookingId?: string; standalone?: boolean; checkIn?: string; checkOut?: string;
    leadTimeDays?: number; horizonDays?: number;
    cancellationHours?: number | null; noRefund?: boolean | null;
}) {
    const { lines, total: itemsTotal, count, hasCustom } = useFoodCart();
    const standalone = standaloneProp ?? !bookingId;

    // How this provider fulfils: fixed to collection, fixed to delivery, or a
    // choice ("both") the guest makes with a switch at the top of the basket.
    const offersBoth = fulfilment === 'both';
    const fixedDelivery = fulfilment === 'delivery';
    const [mode, setMode] = useState<'collection' | 'delivery'>(fixedDelivery ? 'delivery' : 'collection');
    const delivers = fixedDelivery || (offersBoth && mode === 'delivery');
    const deliverWord = delivers ? 'delivery' : 'collection';

    const [date, setDate] = useState('');
    const [dateOpen, setDateOpen] = useState(false);
    const [address, setAddress] = useState('');
    const [allergy, setAllergy] = useState('');
    const [allergyTags, setAllergyTags] = useState<string[]>([]);
    const [allergyOpen, setAllergyOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mobileOpen, setMobileOpen] = useState(false);

    // The earliest date is today plus the provider's notice period. It's one
    // provider-level setting, so every item in the basket shares it; when items can
    // one day differ, the longest notice would win — which this max already is.
    const lead = Math.max(0, Math.floor(Number(leadTimeDays) || 0));
    const minDate = standalone ? dayKeyFromNow(lead) : maxKey(String(checkIn).slice(0, 10), dayKeyFromNow(lead));
    const maxDate = standalone ? dayKeyFromNow(Math.max(1, horizonDays || 90)) : lastNight(String(checkOut));
    const availableDays = useMemo(() => {
        const set = new Set<string>(); let d = minDate;
        for (let i = 0; i < 366 && d <= maxDate; i++) { set.add(d); d = shiftDayKey(d, 1); }
        return set;
    }, [minDate, maxDate]);

    const fee = delivers ? Math.max(0, Number(deliveryFee) || 0) : 0;
    const total = itemsTotal + fee;
    const needsAddress = standalone && delivers;
    const cancel = cancellationBadge(cancellationHours, noRefund);

    // The closed allergy toggle's summary — the tags picked, plus a hint that a
    // free-text note was added, so a guest sees what's set without opening it.
    const allergySummary = [allergyTags.join(', '), allergy.trim() ? 'a note' : ''].filter(Boolean).join(' · ');

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
                    fulfilment: delivers ? 'delivery' : 'collection',
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

    const canSend = !busy && lines.length > 0 && !!date && !(needsAddress && !hasUkPostcode(address));

    // The card content — the same whether it sits in the desktop sidebar or the
    // mobile sheet.
    const content = (
        <>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-lg font-semibold text-slate-900">Your order</div>
                    <p className={`mt-0.5 text-sm font-medium ${noRefund ? 'text-slate-500' : 'text-emerald-700'}`}>{cancel}</p>
                </div>
                {count > 0 && (
                    <div className="text-right">
                        <div className="text-xl font-semibold text-slate-900">£{total.toFixed(2)}</div>
                        <div className="text-xs text-slate-500">{count} item{count === 1 ? '' : 's'}</div>
                    </div>
                )}
            </div>

            {/* The held-request note sits on its own row, clear of the lines. */}
            {lines.length > 0 && hasCustom && (
                <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                    A held request — {who} has 48 hours to confirm before your card is charged.
                </div>
            )}

            {lines.length === 0 ? (
                <div className="mt-4 flex flex-col items-center justify-center rounded-xl bg-slate-50 py-10 text-center">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200">
                        <ShoppingBag className="h-7 w-7" aria-hidden />
                    </span>
                    <p className="mt-4 font-semibold text-slate-900">Your basket is empty</p>
                    <p className="mt-1 text-sm text-slate-500">Add something from the menu and it’ll show up here, ready to order.</p>
                </div>
            ) : (
                <>
                    <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                        {lines.map((l) => (
                            <li key={l.it.id} className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="min-w-0 text-slate-800"><span className="font-medium">{l.qty} ×</span> {l.it.name}</span>
                                <span className="tabular-nums font-medium text-slate-900">£{(l.it.price * l.qty).toFixed(2)}</span>
                            </li>
                        ))}
                        {fee > 0 && (
                            <li className="flex items-baseline justify-between gap-3 text-sm text-slate-600">
                                <span>Delivery</span>
                                <span className="tabular-nums">£{fee.toFixed(2)}</span>
                            </li>
                        )}
                    </ul>

                    {/* Collection / Delivery switch — only when the provider offers
                        both. A fixed provider shows nothing to switch. */}
                    {offersBoth && (
                        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                            {(['collection', 'delivery'] as const).map((m) => (
                                <button key={m} type="button" onClick={() => setMode(m)}
                                    className={`rounded-lg px-3 py-2 text-sm font-semibold capitalize transition ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                                    {m}{m === 'delivery' && Number(deliveryFee) > 0 ? ` · £${Number(deliveryFee).toFixed(2)}` : ''}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* One date control — the button opens the calendar; the label
                        carries the choice. */}
                    <div className="mt-4">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{delivers ? 'Delivery' : 'Collection'} date</span>
                        <button type="button" onClick={() => setDateOpen(true)}
                            className="mt-1.5 flex w-full items-center justify-between rounded-xl border border-slate-300 px-4 py-3 text-left text-sm font-semibold text-slate-900 hover:border-slate-400">
                            {date ? dateLabel(date) : <span className="text-slate-500">Choose a date</span>}
                            <ChevronDown className="h-4 w-4 flex-none text-slate-400" aria-hidden />
                        </button>
                        <p className="mt-1.5 text-xs text-slate-400">The {deliverWord} time is arranged by message once your order is placed.</p>
                    </div>

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
                    {delivers && !standalone && (
                        <p className="mt-3 text-xs text-slate-500">Delivered to your cottage — nothing for you to arrange.</p>
                    )}

                    {/* Allergies — collapsed by default behind a single toggle; the
                        closed state shows a short summary once anything is picked. */}
                    {isFood && (
                        <div className="mt-4 border-t border-slate-100 pt-4">
                            <button type="button" onClick={() => setAllergyOpen((o) => !o)}
                                className="flex w-full items-center justify-between gap-3 text-left">
                                <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-slate-800">Any allergies or dietary needs?</span>
                                    {!allergyOpen && allergySummary && <span className="block truncate text-xs text-slate-500">{allergySummary}</span>}
                                </span>
                                <ChevronDown className={`h-4 w-4 flex-none text-slate-400 transition ${allergyOpen ? 'rotate-180' : ''}`} aria-hidden />
                            </button>
                            {allergyOpen && (
                                <div className="mt-3">
                                    <div className="flex flex-wrap gap-1.5">
                                        {COMMON_ALLERGENS.map((a) => (
                                            <button key={a} type="button" onClick={() => setAllergyTags((t) => (t.includes(a) ? t.filter((x) => x !== a) : [...t, a]))}
                                                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${allergyTags.includes(a) ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>{a}</button>
                                        ))}
                                    </div>
                                    <textarea value={allergy} onChange={(e) => setAllergy(e.target.value.slice(0, 500))} rows={2} placeholder="Anything else they should know"
                                        className="mt-2 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            <div className="mt-5 border-t border-slate-100 pt-4">
                {error && <p className="mb-2 text-sm text-rose-700">{error}</p>}
                <button type="button" onClick={send} disabled={!canSend}
                    className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                    {busy ? 'Sending…' : (hasCustom ? `Send order request · £${total.toFixed(2)}` : `Place order & pay · £${total.toFixed(2)}`)}
                </button>
                <p className="mt-2 text-xs text-slate-400">{hasCustom
                    ? `Your card is held, not charged, until ${who} accepts your made-to-order items.`
                    : 'You pay now and your order is confirmed straight away.'}</p>
            </div>
        </>
    );

    const dialog = dateOpen && typeof document !== 'undefined' ? createPortal(
        <DateOnlyDialog
            title={`Choose a ${deliverWord} date`}
            availableDays={availableDays}
            selected={date || null}
            onSelect={(d) => { setDate(d); setDateOpen(false); }}
            onClose={() => setDateOpen(false)}
        />, document.body,
    ) : null;

    return (
        <>
            {/* Desktop: the sidebar basket, always in view. */}
            <div className="hidden lg:block rounded-2xl bg-white p-5 border border-slate-200 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
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

            {/* Mobile: the basket sheet, portalled to the body so it sits above the
                sticky category tabs. */}
            {mobileOpen && typeof document !== 'undefined' && createPortal(
                <div className="lg:hidden fixed inset-0 z-[60] flex items-end justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Your order"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setMobileOpen(false); }}>
                    <div className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pt-6">
                        <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close"
                            className="absolute right-3 top-4 z-10 rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                        {content}
                    </div>
                </div>, document.body,
            )}

            {dialog}
        </>
    );
}
