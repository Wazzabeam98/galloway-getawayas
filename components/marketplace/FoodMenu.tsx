'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, Info, X, Utensils, Clock } from 'lucide-react';
import { useFoodCart, type FoodMenuItem } from '@/components/marketplace/FoodCart';
import { noticeLabel } from '@/components/marketplace/present';

// The MENU — the main thing on a made-to-order listing, read like a food-delivery
// marketplace. Each item is a CARD (two columns on desktop, one on mobile) with
// its name, price and a two-line-clipped description, its photo on the right and a
// round + on the photo's corner. Adding turns the + into a stepper pinned to the
// same corner, so the card never reflows. Tapping the card's body opens a sheet
// with the full description, the notice period and a quantity + Add.
//
// A long menu groups under sticky category tabs — but only when the provider has
// used more than one category (otherwise a single "All" tab is just noise). A
// missing photo is left out (no invented placeholder) rather than faked.
export default function FoodMenu({ leadTimeDays = 0 }: { leadTimeDays?: number }) {
    const { items, cart, setQty } = useFoodCart();
    const [sheet, setSheet] = useState<FoodMenuItem | null>(null);
    const notice = noticeLabel(leadTimeDays);

    // Group by the provider's free-text category, first-appearance order preserved
    // (the items already arrive sorted). Uncategorised items fall into one unnamed
    // group. Tabs show only when there are two or more NAMED groups.
    const groups = useMemo(() => {
        const order: string[] = [];
        const byKey = new Map<string, FoodMenuItem[]>();
        for (const it of items) {
            const key = (it.category || '').trim() || '';
            if (!byKey.has(key)) { byKey.set(key, []); order.push(key); }
            byKey.get(key)!.push(it);
        }
        return order.map((key) => ({ key, name: key, items: byKey.get(key)! }));
    }, [items]);
    const named = groups.filter((g) => g.key !== '');
    const showTabs = named.length > 1;

    // Scrollspy: which category the reader is currently inside, so its tab lights
    // up. Only wired when tabs show.
    const [active, setActive] = useState<string>(named[0]?.key || '');
    const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
    useEffect(() => {
        if (!showTabs) return;
        const obs = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
                if (visible) setActive((visible.target as HTMLElement).dataset.cat || '');
            },
            // Trip the moment a heading passes below the nav + tab bar (~140px).
            { rootMargin: '-140px 0px -65% 0px', threshold: 0 },
        );
        for (const g of named) { const el = sectionRefs.current[g.key]; if (el) obs.observe(el); }
        return () => obs.disconnect();
    }, [showTabs, named]);

    function jumpTo(key: string) {
        setActive(key);
        sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    return (
        <section>
            <h2 className="text-xl md:text-2xl font-bold text-slate-900">Menu</h2>

            {showTabs && (
                <div className="sticky top-20 z-40 -mx-4 mt-4 border-b border-slate-200 bg-slate-50/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80 sm:top-20">
                    <div className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {named.map((g) => (
                            <button key={g.key} type="button" onClick={() => jumpTo(g.key)}
                                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                                    active === g.key
                                        ? 'bg-emerald-700 text-white'
                                        : 'text-slate-600 hover:bg-slate-200/70'}`}>
                                {g.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-4 space-y-8">
                {groups.map((g) => (
                    <div key={g.key || '_'} ref={(el) => { sectionRefs.current[g.key] = el; }} data-cat={g.key} className="scroll-mt-36">
                        {g.key && showTabs ? (
                            <h3 className="mb-3 text-lg font-bold text-slate-900">{g.name}</h3>
                        ) : null}
                        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {g.items.map((it) => (
                                <MenuCard key={it.id} it={it} qty={cart[it.id] || 0}
                                    onOpen={() => setSheet(it)} onSet={(n) => setQty(it.id, n)} />
                            ))}
                        </ul>
                    </div>
                ))}
            </div>

            {sheet && typeof document !== 'undefined' && createPortal(
                <ItemSheet it={sheet} qty={cart[sheet.id] || 0} notice={notice}
                    onSet={(n) => setQty(sheet.id, n)} onClose={() => setSheet(null)} />,
                document.body,
            )}
        </section>
    );
}

// A single menu card. The photo box is a FIXED size and `relative`; the + and the
// stepper are both absolutely positioned on its corner, so switching between them
// never nudges the photo or changes the card's height — the reflow the old row
// suffered. The card body opens the item sheet; the +/- controls stop the click
// so they don't also open it.
function MenuCard({ it, qty, onOpen, onSet }: {
    it: FoodMenuItem; qty: number;
    onOpen: () => void; onSet: (n: number) => void;
}) {
    const hasDetail = !!(it.ingredients || it.allergens);
    return (
        <li>
            <div role="button" tabIndex={0} onClick={onOpen}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
                className="flex h-full cursor-pointer gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start gap-1.5">
                        <span className="font-semibold text-slate-900">{it.name}</span>
                        {hasDetail && (
                            <span className="mt-0.5 flex-none text-slate-400"><Info className="h-3.5 w-3.5" aria-hidden /></span>
                        )}
                    </div>
                    <div className="mt-0.5 font-semibold text-slate-900">£{it.price.toFixed(2)}</div>
                    {it.description ? (
                        <p className="mt-1 text-sm leading-relaxed text-slate-600 line-clamp-2">{it.description}</p>
                    ) : null}
                </div>

                <div className="relative h-24 w-24 flex-none">
                    {it.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.image} alt="" loading="lazy" className="h-24 w-24 rounded-xl object-cover" />
                    ) : (
                        <span className="flex h-24 w-24 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                            <Utensils className="h-8 w-8" aria-hidden />
                        </span>
                    )}
                    {/* Add / stepper, anchored to the photo's bottom-right corner. Both
                        live here, so the swap never reflows. */}
                    <div className="absolute -bottom-2.5 right-1" onClick={(e) => e.stopPropagation()}>
                        {qty > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-white px-1 py-1 shadow-md ring-1 ring-slate-200">
                                <button type="button" aria-label={'Fewer ' + it.name} onClick={() => onSet(qty - 1)}
                                    className="flex h-7 w-7 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-50"><Minus className="h-4 w-4" /></button>
                                <span className="min-w-[1.1rem] text-center text-sm font-bold tabular-nums text-slate-900">{qty}</span>
                                <button type="button" aria-label={'More ' + it.name} onClick={() => onSet(qty + 1)}
                                    className="flex h-7 w-7 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-50"><Plus className="h-4 w-4" /></button>
                            </span>
                        ) : (
                            <button type="button" aria-label={'Add ' + it.name} onClick={() => onSet(1)}
                                className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-emerald-700 shadow-md ring-1 ring-slate-200 transition hover:ring-emerald-600">
                                <Plus className="h-5 w-5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </li>
    );
}

// The item sheet — the full detail behind a card. The whole description (the card
// clips it to two lines), the notice period, the ingredients/allergens if any, and
// a quantity + Add so the guest can add straight from here.
function ItemSheet({ it, qty, notice, onSet, onClose }: {
    it: FoodMenuItem; qty: number; notice: string | null;
    onSet: (n: number) => void; onClose: () => void;
}) {
    // Add starts at one when the item isn't in the basket yet; otherwise it edits
    // the quantity already there.
    const [draft, setDraft] = useState(qty > 0 ? qty : 1);
    useEffect(() => { setDraft(qty > 0 ? qty : 1); }, [qty, it.id]);

    return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={it.name}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
                {it.image ? (
                    <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={it.image} alt="" className="h-48 w-full rounded-t-2xl object-cover" />
                        <button type="button" onClick={onClose} aria-label="Close"
                            className="absolute right-3 top-3 rounded-full bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white"><X className="h-5 w-5" /></button>
                    </div>
                ) : (
                    <div className="flex items-start justify-between gap-3 p-5 pb-0">
                        <h3 className="text-lg font-bold text-slate-900">{it.name}</h3>
                        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                    </div>
                )}

                <div className="p-5">
                    {it.image ? <h3 className="text-lg font-bold text-slate-900">{it.name}</h3> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">£{it.price.toFixed(2)}</span>
                        {notice ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                                <Clock className="h-3.5 w-3.5" aria-hidden />{notice}
                            </span>
                        ) : null}
                        {it.isCustom ? (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Made to order</span>
                        ) : null}
                    </div>

                    {it.description ? (
                        <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-700">{it.description}</p>
                    ) : null}

                    {it.isCustom ? (
                        <p className="mt-3 text-sm leading-relaxed text-slate-500">Made to your order — the baker confirms it before your card is charged.</p>
                    ) : null}

                    {it.ingredients ? (
                        <div className="mt-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ingredients</div>
                            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">{it.ingredients}</p>
                        </div>
                    ) : null}
                    {it.allergens ? (
                        <div className="mt-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">Allergens</div>
                            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">{it.allergens}</p>
                        </div>
                    ) : null}

                    <div className="mt-6 flex items-center gap-3">
                        <span className="inline-flex items-center gap-2 rounded-full border border-slate-300 p-1">
                            <button type="button" aria-label="Fewer" onClick={() => setDraft((n) => Math.max(1, n - 1))}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"><Minus className="h-4 w-4" /></button>
                            <span className="min-w-[1.25rem] text-center text-sm font-bold tabular-nums text-slate-900">{draft}</span>
                            <button type="button" aria-label="More" onClick={() => setDraft((n) => n + 1)}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"><Plus className="h-4 w-4" /></button>
                        </span>
                        <button type="button" onClick={() => { onSet(draft); onClose(); }}
                            className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800">
                            {qty > 0 ? 'Update basket' : 'Add to basket'} · £{(it.price * draft).toFixed(2)}
                        </button>
                    </div>
                    {(it.ingredients || it.allergens) ? (
                        <p className="mt-4 text-xs text-slate-400">Message the provider if you need anything checked — a home kitchen isn't a labelled factory line.</p>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
