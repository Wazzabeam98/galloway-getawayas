'use client';

import { formatGBP } from '@/lib/formatMoney';
import { getImageUrl } from '@/lib/utils';
import { Plus, Minus, Gift } from 'lucide-react';
import { unitLabel, type ListingExtra } from '@/lib/listingExtras';
import { useExtrasSelection } from '@/components/extras/ExtrasSelectionProvider';

// "Extras this host offers" — the SAME card the experiences bakery menu uses
// (components/marketplace/FoodMenu's MenuCard), so a guest adds an extra right
// from the card: a round "+" that becomes a −N+ stepper, the count on the card,
// a fixed photo box on the right. The selection is shared with the booking
// panel (ExtrasSelectionProvider), so adding here shows in the panel's total and
// goes on the booking. Tapping "+" before dates are picked adds the extra and
// prompts for dates the way the rest of the booking flow does.
//
// Matches the bakery card's scan-card shadow (shadow-sm / hover:shadow-md), not
// the lifted-card treatment — deliberately, to look exactly like that menu.
export default function ListingExtras({ extras }: { extras: ListingExtra[] }) {
    const sel = useExtrasSelection();
    const live = (extras || []).filter((e) => e && e.active !== false);
    if (!live.length) return null;

    const qtyOf = (id: string) => (sel ? sel.qtys[id] || 0 : 0);
    const setQty = (id: string, n: number) => {
        if (!sel) return;
        const adding = n > qtyOf(id);
        sel.setQty(id, n);
        // Adding before a stay is chosen: record it, then prompt for dates so the
        // guest can finish — the price lands once the dates do.
        if (adding && !sel.hasDates) sel.requestDates();
    };

    return (
        <div id="extras" className="mt-8 pt-8 border-t scroll-mt-24">
            <h2 className="text-xl font-semibold mb-1">Extras this host offers</h2>
            <p className="text-sm text-slate-500 mb-4">Add any you&rsquo;d like — they go on your booking.</p>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {live.map((e) => {
                    const n = qtyOf(e.id);
                    return (
                        <li key={e.id}>
                            <div className="flex h-full gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md">
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="font-semibold text-slate-900">{e.label}</span>
                                    <div className="mt-0.5 font-semibold text-slate-900">
                                        {formatGBP(Number(e.price))}
                                        <span className="font-normal text-slate-400"> {unitLabel(e.unit)}</span>
                                    </div>
                                    {e.description && (
                                        <p className="mt-1 text-sm leading-relaxed text-slate-600 line-clamp-2">{e.description}</p>
                                    )}
                                </div>

                                <div className="relative h-24 w-32 flex-none">
                                    {e.photo ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={getImageUrl(e.photo)} alt="" loading="lazy" className="h-24 w-32 rounded-xl object-cover" />
                                    ) : (
                                        <span className="flex h-24 w-32 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                                            <Gift className="h-8 w-8" aria-hidden />
                                        </span>
                                    )}
                                    {/* The add / stepper, pinned to the photo's corner so +↔stepper
                                        never reflows the card — exactly as the bakery menu does it. */}
                                    <div className="absolute -bottom-2.5 right-1">
                                        {n > 0 ? (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-white px-1 py-1 shadow-md ring-1 ring-slate-200">
                                                <button type="button" aria-label={'Fewer ' + e.label} onClick={() => setQty(e.id, n - 1)}
                                                    className="flex h-7 w-7 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-50">
                                                    <Minus className="h-4 w-4" />
                                                </button>
                                                <span className="min-w-[1.1rem] text-center text-sm font-bold tabular-nums text-slate-900">{n}</span>
                                                <button type="button" aria-label={'More ' + e.label} onClick={() => setQty(e.id, n + 1)}
                                                    className="flex h-7 w-7 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-50">
                                                    <Plus className="h-4 w-4" />
                                                </button>
                                            </span>
                                        ) : (
                                            <button type="button" aria-label={'Add ' + e.label} onClick={() => setQty(e.id, 1)}
                                                className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-emerald-700 shadow-md ring-1 ring-slate-200 transition hover:ring-emerald-600">
                                                <Plus className="h-5 w-5" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
