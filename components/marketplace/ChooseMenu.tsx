'use client';

import { Utensils, Clock, Users } from 'lucide-react';
import { itemPriceLabel, itemGuestRange, itemExtrasSubline, durationLabel } from '@/components/marketplace/present';
import { useRequestBooking } from '@/components/marketplace/RequestBookingContext';
import type { MpItem } from '@/lib/experiencesData';

// The "What you get" list for a comes-to-you experience, made interactive: each
// option carries a Choose button, the way the bakery menu carries Add. Pressing
// it asks the booking panel (through RequestBookingContext) to open its dialog on
// that option — so the option list is gone from the dialog and the guest only
// picks guests, a date and a time. Replaces the static list ExperienceListingBody
// otherwise renders in this slot.
export default function ChooseMenu({ items, minAge, providerMax }: {
    items: MpItem[];
    minAge?: number | null;
    providerMax?: number | null;
}) {
    const ctx = useRequestBooking();
    // Cheapest first — the same order the panel and dialog use, so "From £X" and
    // the list agree.
    const ordered = [...items].sort((a, b) => a.price - b.price);

    return (
        <section className="mt-8 border-t border-slate-200 pt-8">
            <h2 className="text-xl md:text-2xl font-bold text-slate-900">What you get</h2>
            <p className="mt-1 text-sm text-slate-500">Choose an option to book it.</p>
            <ul className="mt-4 divide-y divide-slate-100">
                {ordered.map((it) => {
                    const range = itemGuestRange(it, providerMax);
                    const fee = itemExtrasSubline(it, minAge);
                    const dur = durationLabel(it.duration_minutes);
                    return (
                        <li key={it.id} className="flex gap-4 py-4 first:pt-0">
                            {/* A photo, or a neat fallback tile so a missing image
                                never leaves a ragged gap in the row. */}
                            {it.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={it.image} alt="" loading="lazy" className="h-16 w-16 flex-none rounded-xl object-cover" />
                            ) : (
                                <span className="flex h-16 w-16 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                                    <Utensils className="h-6 w-6" aria-hidden />
                                </span>
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="font-semibold text-slate-900">{it.name}</span>
                                    <span className="whitespace-nowrap font-semibold text-slate-900">{itemPriceLabel(it.price, it.unit)}</span>
                                </div>
                                {range ? (
                                    <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-slate-500">
                                        <Users className="h-3.5 w-3.5 flex-none" aria-hidden />{range}
                                    </p>
                                ) : null}
                                {fee ? <p className="mt-0.5 text-xs text-slate-500">{fee}</p> : null}
                                {dur ? (
                                    <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                                        <Clock className="h-3.5 w-3.5 flex-none" aria-hidden />{dur}
                                    </p>
                                ) : null}
                                {it.description ? <p className="mt-1 text-sm leading-relaxed text-slate-600">{it.description}</p> : null}
                                <button
                                    type="button"
                                    onClick={() => ctx?.openItem(it.id)}
                                    className="mt-3 inline-flex items-center justify-center rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
                                >
                                    Choose
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
