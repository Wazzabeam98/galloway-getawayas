'use client';

import { useState } from 'react';
import { Minus, Plus, Info, X } from 'lucide-react';
import { useFoodCart, type FoodMenuItem } from '@/components/marketplace/FoodCart';

// The MENU — the main thing on a made-to-order listing, read like a food-ordering
// site: each item is a row with its photo, name, description and price, and an
// Add control that becomes a +/- stepper once it's in the basket. An item with
// ingredient or allergen detail carries an info icon that opens it. A missing
// photo is left out (no invented placeholder) rather than faked.
export default function FoodMenu() {
    const { items, cart, setQty } = useFoodCart();
    const [detail, setDetail] = useState<FoodMenuItem | null>(null);
    return (
        <section>
            <h2 className="text-xl md:text-2xl font-bold text-slate-900">Menu</h2>
            <ul className="mt-4 divide-y divide-slate-100">
                {items.map((it) => {
                    const q = cart[it.id] || 0;
                    const hasDetail = !!(it.ingredients || it.allergens);
                    return (
                        <li key={it.id} className="flex items-center gap-4 py-4 first:pt-0">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-slate-900">{it.name}</span>
                                    {it.isCustom && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">Made to order</span>}
                                    {hasDetail && (
                                        <button type="button" onClick={() => setDetail(it)} aria-label={'Ingredients and allergens for ' + it.name}
                                            className="rounded-full p-0.5 text-slate-400 hover:text-slate-700"><Info className="h-4 w-4" /></button>
                                    )}
                                </div>
                                <div className="mt-0.5 font-semibold text-slate-900">£{it.price.toFixed(2)}</div>
                                {it.description ? <p className="mt-1 text-sm leading-relaxed text-slate-600">{it.description}</p> : null}
                            </div>
                            {it.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={it.image} alt="" loading="lazy" className="h-24 w-24 flex-none rounded-xl object-cover" />
                            ) : null}
                            <div className="flex-none">
                                {q > 0 ? (
                                    <span className="inline-flex items-center gap-3">
                                        <button type="button" aria-label={'Fewer ' + it.name} onClick={() => setQty(it.id, q - 1)}
                                            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-700 hover:border-slate-400"><Minus className="h-4 w-4" /></button>
                                        <span className="w-5 text-center text-sm font-semibold text-slate-900">{q}</span>
                                        <button type="button" aria-label={'More ' + it.name} onClick={() => setQty(it.id, q + 1)}
                                            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-700 hover:border-slate-400"><Plus className="h-4 w-4" /></button>
                                    </span>
                                ) : (
                                    <button type="button" onClick={() => setQty(it.id, 1)}
                                        className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:border-slate-500">
                                        Add
                                    </button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>

            {detail && (
                <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={detail.name}
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <div className="flex items-start justify-between gap-3">
                            <h3 className="text-lg font-bold text-slate-900">{detail.name}</h3>
                            <button type="button" onClick={() => setDetail(null)} aria-label="Close" className="rounded-full p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                        </div>
                        {detail.ingredients ? (
                            <div className="mt-4">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ingredients</div>
                                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">{detail.ingredients}</p>
                            </div>
                        ) : null}
                        {detail.allergens ? (
                            <div className="mt-4">
                                <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">Allergens</div>
                                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">{detail.allergens}</p>
                            </div>
                        ) : null}
                        <p className="mt-4 text-xs text-slate-400">Message the provider if you need anything checked — a home kitchen isn't a labelled factory line.</p>
                    </div>
                </div>
            )}
        </section>
    );
}
