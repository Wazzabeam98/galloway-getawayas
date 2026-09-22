'use client';

import { Minus, Plus } from 'lucide-react';
import { useFoodCart } from '@/components/marketplace/FoodCart';

// The MENU — the main thing on a made-to-order listing, read like a food-ordering
// site: each item is a row with its photo, name, description and price, and an
// Add control that becomes a +/- stepper once it's in the basket. A missing
// photo is left out (no invented placeholder) rather than faked.
export default function FoodMenu() {
    const { items, cart, setQty } = useFoodCart();
    return (
        <section>
            <h2 className="text-xl md:text-2xl font-bold text-slate-900">Menu</h2>
            <ul className="mt-4 divide-y divide-slate-100">
                {items.map((it) => {
                    const q = cart[it.id] || 0;
                    return (
                        <li key={it.id} className="flex items-center gap-4 py-4 first:pt-0">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                    <span className="font-semibold text-slate-900">{it.name}</span>
                                    {it.isCustom && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">Made to order</span>}
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
        </section>
    );
}
