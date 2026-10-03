'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SlidersHorizontal, X, Minus, Plus, Check } from 'lucide-react';
import { amenityIcon } from '@/lib/amenityIcons';
import { categories } from '@/config/categories';
import {
    ACCESSIBILITY_AMENITIES, AMENITY_LABELS, FILTER_AMENITIES, QUICK_CHIPS, RECOMMENDED, EMPTY_FILTERS,
    activeFilterCount, matchesFilters, readFilters, writeFilters,
    type FilterFacts, type FilterState,
} from '@/lib/listingFilters';

// Airbnb's filters, over the property grid: a "Filters" button with a count,
// a row of one-tap chips beside it, and the full panel — Recommended, Price
// range, Rooms and beds, Amenities, Booking options, Property type,
// Accessibility features — in
// a modal (a full-screen sheet on a phone) whose button says how many places
// it will show. Only what our listings carry is offered; see lib/listingFilters.
//
// `pool` is every place matching the hero's where/when/who, as the server read
// it. The count on the button is the shared rule run over it, so it is exactly
// the number of cards the grid then shows.

// Six fills the amenity grid exactly: two rows of three on a laptop, three rows
// of two on a phone.
const AMENITIES_SHOWN = 6;

export default function PropertyFilters({ pool }: { pool: FilterFacts[] }) {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();

    const applied = useMemo(() => {
        const p: Record<string, string | string[]> = {};
        params.forEach((v, k) => {
            const cur = p[k];
            p[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
        });
        return readFilters(p);
    }, [params]);

    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<FilterState>(applied);
    const [moreAmenities, setMoreAmenities] = useState(false);
    const [accessOpen, setAccessOpen] = useState(false);

    // What the listings in view actually have, so a filter that could only
    // ever return nothing is not offered. Pets, hot tub and step-free access are
    // always offered — they are the three a guest arrives asking about.
    const present = useMemo(() => {
        const s = new Set<string>();
        pool.forEach((l) => (l.amenities || []).forEach((a) => s.add(a)));
        return s;
    }, [pool]);
    const ALWAYS = ['Pets allowed', 'Hot tub', 'Step-free guest entrance'];
    const chips = QUICK_CHIPS.filter((c) => ALWAYS.indexOf(c.amenity) !== -1 || present.has(c.amenity));
    const recommended = RECOMMENDED.filter((r) => ALWAYS.indexOf(r.amenity) !== -1 || present.has(r.amenity)).slice(0, 4);
    const amenityOptions = FILTER_AMENITIES.filter((a) => a === 'Hot tub' || present.has(a));
    const typesPresent = categories.filter((c) => pool.some((l) => l.property_type === c.name));
    const prices = pool.map((l) => Number(l.price_per_night) || 0).filter((n) => n > 0);
    const priceFloor = prices.length ? Math.min(...prices) : 0;
    const priceCeil = prices.length ? Math.max(...prices) : 0;

    const count = pool.filter((l) => matchesFilters(l, draft)).length;
    const appliedCount = activeFilterCount(applied);

    function go(f: FilterState) {
        const next = writeFilters(new URLSearchParams(params.toString()), f);
        const q = next.toString();
        router.push(pathname + (q ? '?' + q : ''), { scroll: false });
    }

    function toggleChip(amenity: string) {
        const has = applied.amenities.indexOf(amenity) !== -1;
        go({ ...applied, amenities: has ? applied.amenities.filter((a) => a !== amenity) : [...applied.amenities, amenity] });
    }

    function openPanel() {
        setDraft(applied);
        setOpen(true);
    }

    // Esc closes, and the page behind does not scroll while it is open.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [open]);

    const toggleIn = (key: 'amenities' | 'types', value: string) =>
        setDraft((d) => {
            const list = d[key];
            return { ...d, [key]: list.indexOf(value) !== -1 ? list.filter((v) => v !== value) : [...list, value] };
        });

    return (
        <>
            <div className="-mx-4 mb-8 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none]">
                <button
                    type="button"
                    onClick={openPanel}
                    className={`relative inline-flex flex-none items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                        appliedCount > 0 ? 'border-stone-900 bg-stone-50 text-stone-900' : 'border-stone-300 text-stone-800 hover:border-stone-900'
                    }`}
                >
                    <SlidersHorizontal className="h-4 w-4" />
                    Filters
                    {appliedCount > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-stone-900 px-1 text-[11px] font-bold text-white">
                            {appliedCount}
                        </span>
                    )}
                </button>
                <span className="h-6 w-px flex-none bg-stone-200" aria-hidden="true" />
                {chips.map((c) => {
                    const on = applied.amenities.indexOf(c.amenity) !== -1;
                    return (
                        <button
                            key={c.amenity}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleChip(c.amenity)}
                            className={`flex-none whitespace-nowrap rounded-full border px-4 py-2 text-sm transition ${
                                on ? 'border-stone-900 bg-stone-100 font-semibold text-stone-900' : 'border-stone-300 text-stone-700 hover:border-stone-900'
                            }`}
                        >
                            {c.label}
                        </button>
                    );
                })}
            </div>

            {open && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={() => setOpen(false)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="filters-title"
                        onClick={(e) => e.stopPropagation()}
                        className="flex h-full w-full flex-col bg-white text-stone-900 sm:h-auto sm:max-h-[88vh] sm:max-w-[760px] sm:rounded-2xl sm:shadow-2xl"
                    >
                        <div className="relative flex items-center justify-center border-b border-stone-200 px-6 py-4">
                            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute left-4 rounded-full p-2 hover:bg-stone-100">
                                <X className="h-4 w-4" />
                            </button>
                            <h2 id="filters-title" className="text-base font-bold">Filters</h2>
                        </div>

                        <div className="flex-1 overflow-y-auto px-6">
                            {/* Airbnb's "Recommended for you" row — the same amenities as the
                                pills below, so a tile and its pill light up together. */}
                            {recommended.length > 0 && (
                                <Section title="Recommended">
                                    <div className="grid grid-cols-4 gap-2 sm:gap-3">
                                        {recommended.map((r) => (
                                            <Tile key={r.amenity} label={r.label} icon={r.amenity} on={draft.amenities.indexOf(r.amenity) !== -1} onClick={() => toggleIn('amenities', r.amenity)} />
                                        ))}
                                    </div>
                                </Section>
                            )}

                            {/* Price range — per night, which is how our prices are shown. */}
                            {prices.length > 0 && (
                                <Section title="Price range" sub="Nightly price">
                                    {/* One piece, as Airbnb draws it: the track is the bars' baseline
                                        and the handles sit on it. The slider is laid over the bottom
                                        edge of the bars, centred on it, rather than under them. */}
                                    <div className="price-slider relative pb-[calc(var(--thumb)/2)]">
                                        <div className="px-[calc(var(--thumb)/2)]">
                                            <PriceBars prices={prices} min={draft.minPrice} max={draft.maxPrice} />
                                        </div>
                                        {priceCeil > priceFloor && (
                                            <PriceSlider
                                                floor={priceFloor}
                                                ceil={priceCeil}
                                                min={draft.minPrice}
                                                max={draft.maxPrice}
                                                onChange={(minPrice, maxPrice) => setDraft((d) => ({ ...d, minPrice, maxPrice }))}
                                            />
                                        )}
                                    </div>
                                    <div className="mt-4 grid grid-cols-2 gap-4">
                                        <PriceInput label="Minimum" placeholder={priceFloor} value={draft.minPrice} onChange={(v) => setDraft((d) => ({ ...d, minPrice: v }))} />
                                        <PriceInput label="Maximum" placeholder={priceCeil} value={draft.maxPrice} onChange={(v) => setDraft((d) => ({ ...d, maxPrice: v }))} />
                                    </div>
                                </Section>
                            )}

                            <Section title="Rooms and beds">
                                <Stepper label="Bedrooms" value={draft.bedrooms} onChange={(v) => setDraft((d) => ({ ...d, bedrooms: v }))} />
                                <Stepper label="Beds" value={draft.beds} onChange={(v) => setDraft((d) => ({ ...d, beds: v }))} />
                                <Stepper label="Bathrooms" value={draft.bathrooms} onChange={(v) => setDraft((d) => ({ ...d, bathrooms: v }))} />
                            </Section>

                            {amenityOptions.length > 0 && (
                                <Section title="Amenities">
                                    {/* An even grid rather than a wrapping row, so the second line
                                        is never one pill and a gap. */}
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                        {(moreAmenities ? amenityOptions : amenityOptions.slice(0, AMENITIES_SHOWN)).map((a) => (
                                            <Pill key={a} fill label={AMENITY_LABELS[a] || a} icon={a} on={draft.amenities.indexOf(a) !== -1} onClick={() => toggleIn('amenities', a)} />
                                        ))}
                                    </div>
                                    {amenityOptions.length > AMENITIES_SHOWN && (
                                        <button type="button" onClick={() => setMoreAmenities((v) => !v)} className="mt-4 text-sm font-semibold underline underline-offset-4">
                                            {moreAmenities ? 'Show less' : 'Show more'}
                                        </button>
                                    )}
                                </Section>
                            )}

                            <Section title="Booking options">
                                <div className="flex flex-wrap gap-3">
                                    <Pill label="Instant Book" on={draft.instantBook} onClick={() => setDraft((d) => ({ ...d, instantBook: !d.instantBook }))} />
                                    <Pill label="Self check-in" on={draft.selfCheckIn} onClick={() => setDraft((d) => ({ ...d, selfCheckIn: !d.selfCheckIn }))} />
                                    <Pill label="Allows pets" icon="Pets allowed" on={draft.amenities.indexOf('Pets allowed') !== -1} onClick={() => toggleIn('amenities', 'Pets allowed')} />
                                </div>
                            </Section>

                            {typesPresent.length > 1 && (
                                <Section title="Property type">
                                    <div className="flex flex-wrap gap-3">
                                        {typesPresent.map((c) => (
                                            <Pill key={c.name} label={c.label} on={draft.types.indexOf(c.name) !== -1} onClick={() => toggleIn('types', c.name)} />
                                        ))}
                                    </div>
                                </Section>
                            )}

                            {/* Collapsed by default, like Airbnb's; opens itself when one is set. */}
                            <div className="border-b border-stone-200 py-6 last:border-b-0">
                                <button
                                    type="button"
                                    onClick={() => setAccessOpen((v) => !v)}
                                    aria-expanded={accessOpen || ACCESSIBILITY_AMENITIES.some((a) => draft.amenities.indexOf(a) !== -1)}
                                    className="flex w-full items-center justify-between text-left text-lg font-bold"
                                >
                                    Accessibility features
                                    <span className="text-sm font-normal text-stone-500">{accessOpen ? 'Hide' : 'Show'}</span>
                                </button>
                                {(accessOpen || ACCESSIBILITY_AMENITIES.some((a) => draft.amenities.indexOf(a) !== -1)) && (
                                    <div className="mt-4 space-y-1">
                                        {ACCESSIBILITY_AMENITIES.map((a) => {
                                            const on = draft.amenities.indexOf(a) !== -1;
                                            return (
                                                <label key={a} className="flex cursor-pointer items-center justify-between py-2.5 text-[15px]">
                                                    {a}
                                                    <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleIn('amenities', a)} />
                                                    <span aria-hidden="true" className={`flex h-6 w-6 items-center justify-center rounded-md border ${on ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-400'}`}>
                                                        {on && <Check className="h-4 w-4" />}
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-between border-t border-stone-200 px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                            <button
                                type="button"
                                onClick={() => setDraft(EMPTY_FILTERS)}
                                disabled={activeFilterCount(draft) === 0}
                                className="rounded-lg px-2 py-2 text-sm font-semibold underline underline-offset-4 disabled:text-stone-300 disabled:no-underline"
                            >
                                Clear all
                            </button>
                            <button
                                type="button"
                                onClick={() => { setOpen(false); go(draft); }}
                                className="rounded-lg bg-stone-900 px-6 py-3 text-sm font-semibold text-white hover:bg-stone-800"
                            >
                                {count === 0 ? 'No places match' : `Show ${count} place${count === 1 ? '' : 's'}`}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
    return (
        <section className="border-b border-stone-200 py-6 last:border-b-0">
            <h3 className="text-lg font-bold">{title}</h3>
            {sub && <p className="mt-0.5 text-sm text-stone-500">{sub}</p>}
            <div className="mt-4">{children}</div>
        </section>
    );
}

function Pill({ label, icon, on, onClick, fill }: { label: string; icon?: string; on: boolean; onClick: () => void; fill?: boolean }) {
    const Icon = icon ? amenityIcon(icon) : null;
    return (
        <button
            type="button"
            aria-pressed={on}
            onClick={onClick}
            className={`${fill ? 'flex w-full min-w-0' : 'inline-flex'} items-center gap-2 rounded-full border px-4 py-2.5 text-sm transition ${
                on ? 'border-stone-900 bg-stone-100 font-semibold' : 'border-stone-300 hover:border-stone-900'
            }`}
        >
            {Icon && <Icon className="h-4 w-4 flex-none" />}
            <span className={fill ? 'truncate' : undefined}>{label}</span>
        </button>
    );
}

// A Recommended tile: Airbnb's square with the icon in it and the name beneath.
function Tile({ label, icon, on, onClick }: { label: string; icon: string; on: boolean; onClick: () => void }) {
    const Icon = amenityIcon(icon);
    return (
        <button type="button" aria-pressed={on} onClick={onClick} className="group flex min-w-0 flex-col items-center gap-2 text-center">
            <span
                className={`flex h-[72px] w-full items-center justify-center rounded-xl border transition sm:h-24 ${
                    on ? 'border-2 border-stone-900 bg-stone-50' : 'border-stone-200 group-hover:border-stone-900'
                }`}
            >
                <Icon className="h-7 w-7 text-stone-800 sm:h-8 sm:w-8" strokeWidth={1.5} />
            </span>
            <span className={`text-[13px] leading-tight sm:text-sm ${on ? 'font-semibold' : 'text-stone-700'}`}>{label}</span>
        </button>
    );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    return (
        <div className="flex items-center justify-between py-2.5">
            <span className="text-[15px]">{label}</span>
            <div className="flex items-center gap-4">
                <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 1))} className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-300 text-stone-600 hover:border-stone-900 disabled:opacity-30">
                    <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-10 text-center text-[15px]">{value === 0 ? 'Any' : value + '+'}</span>
                <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= 8} onClick={() => onChange(value + 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-300 text-stone-600 hover:border-stone-900 disabled:opacity-30">
                    <Plus className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}

function PriceInput({ label, placeholder, value, onChange }: { label: string; placeholder: number; value: number | null; onChange: (v: number | null) => void }) {
    return (
        <label className="block rounded-xl border border-stone-300 px-4 py-2 focus-within:border-stone-900">
            <span className="block text-xs text-stone-500">{label}</span>
            <span className="flex items-center gap-1 text-[15px]">
                £
                <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={value ?? ''}
                    placeholder={String(placeholder)}
                    onChange={(e) => onChange(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
                    className="w-full bg-transparent outline-none"
                />
            </span>
        </label>
    );
}

// Airbnb's two handles on the scale. Dragging either sets the minimum or
// maximum, and the boxes below follow; typing in a box moves its handle. A
// handle back at the end of the scale means "no limit" (null), the same as an
// empty box. The handles cannot cross.
function PriceSlider({ floor, ceil, min, max, onChange }: {
    floor: number; ceil: number; min: number | null; max: number | null;
    onChange: (min: number | null, max: number | null) => void;
}) {
    const clamp = (n: number) => Math.min(ceil, Math.max(floor, n));
    const lo = clamp(min ?? floor);
    const hi = Math.max(lo, clamp(max ?? ceil));
    const pct = (n: number) => ((n - floor) / (ceil - floor)) * 100;
    // Where a thumb's centre sits: inset by half a thumb at each end, as the
    // browser draws it.
    const at = (n: number) => `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${pct(n) / 100})`;
    // With both handles pushed right, the minimum must sit on top or it could
    // never be dragged back out from under the maximum.
    const minOnTop = lo > floor + (ceil - floor) / 2;
    return (
        <div className="absolute inset-x-0 bottom-0 h-[var(--thumb)]">
            <div className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-stone-200" style={{ left: 'calc(var(--thumb) / 2)', right: 'calc(var(--thumb) / 2)' }} />
            <div className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-stone-900" style={{ left: at(lo), width: `calc((100% - var(--thumb)) * ${(pct(hi) - pct(lo)) / 100})` }} />
            <input
                type="range"
                className="price-range"
                style={{ zIndex: minOnTop ? 2 : 1 }}
                min={floor}
                max={ceil}
                step={1}
                value={lo}
                aria-label="Minimum price"
                aria-valuetext={`£${lo}`}
                onChange={(e) => {
                    const v = Math.min(Number(e.target.value), hi);
                    onChange(v <= floor ? null : v, max);
                }}
            />
            <input
                type="range"
                className="price-range"
                style={{ zIndex: minOnTop ? 1 : 2 }}
                min={floor}
                max={ceil}
                step={1}
                value={hi}
                aria-label="Maximum price"
                aria-valuetext={`£${hi}`}
                onChange={(e) => {
                    const v = Math.max(Number(e.target.value), lo);
                    onChange(min, v >= ceil ? null : v);
                }}
            />
        </div>
    );
}

// Airbnb's little histogram over the price inputs: where the prices sit, with
// the bars outside the chosen range greyed out.
function PriceBars({ prices, min, max }: { prices: number[]; min: number | null; max: number | null }) {
    const BUCKETS = 24;
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const width = Math.max(1, (hi - lo) / BUCKETS);
    const counts = new Array(BUCKETS).fill(0);
    prices.forEach((p) => { counts[Math.min(BUCKETS - 1, Math.floor((p - lo) / width))]++; });
    const peak = Math.max(...counts);
    return (
        <div className="flex h-16 items-end gap-[3px]" aria-hidden="true">
            {counts.map((c, i) => {
                const from = lo + i * width;
                const inRange = (min == null || from + width >= min) && (max == null || from <= max);
                return (
                    <div
                        key={i}
                        className={`flex-1 rounded-t-sm ${inRange ? 'bg-stone-900' : 'bg-stone-200'}`}
                        style={{ height: c ? Math.max(8, (c / peak) * 100) + '%' : 0 }}
                    />
                );
            })}
        </div>
    );
}
