'use client';

import { useState } from 'react';
import Link from 'next/link';

// The towns, one panel each, on the home page. A visual "browse by area" that
// leads to the area pages — which is where the search traffic actually lands.
//
// Horizontal scroll on purpose, and built to survive a phone: the row scrolls,
// each panel snaps, and a panel is a fixed width rather than a fraction of the
// screen, so it never collapses to a sliver or clips its text on a narrow one.
//
// Photos are placeholder slots for now — a real image drops in at
// public/images/towns/<slug>.jpg and appears with no code change; until then a
// clean grey slot shows rather than a broken-image icon.

interface Town {
    slug: string;
    name: string;
    blurb: string;
}

function TownPhoto({ slug, name }: { slug: string; name: string }) {
    const [broken, setBroken] = useState(false);

    return (
        <div className="relative aspect-[3/2] w-full overflow-hidden rounded-t-2xl bg-stone-200">
            {!broken ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={'/images/towns/' + slug + '.jpg'}
                    alt={name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    onError={() => setBroken(true)}
                />
            ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-medium uppercase tracking-wide text-stone-400">
                    {name}
                </div>
            )}
        </div>
    );
}

export default function TownsCarousel({ towns }: { towns: Town[] }) {
    if (!towns || towns.length === 0) return null;

    return (
        <section className="mt-16">
            <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                Where to stay in Dumfries &amp; Galloway
            </h2>
            <p className="text-stone-600 text-sm md:text-base mt-1 mb-6">
                Nine towns across the region, and what each one is for.
            </p>

            <div className="-mx-4 sm:mx-0">
                <ul
                    className="flex gap-4 overflow-x-auto px-4 sm:px-0 pb-2 snap-x snap-mandatory
                               [scrollbar-width:thin]"
                >
                    {towns.map((t) => (
                        <li key={t.slug} className="snap-start shrink-0 w-72">
                            <Link
                                href={'/holiday-cottages/' + t.slug}
                                className="group block h-full rounded-2xl border border-stone-200 hover:border-stone-900 transition overflow-hidden"
                            >
                                <TownPhoto slug={t.slug} name={t.name} />
                                <div className="p-4">
                                    <h3 className="font-bold text-stone-900">{t.name}</h3>
                                    <p className="mt-1 text-sm text-stone-600">{t.blurb}</p>
                                    <span className="mt-3 inline-block text-sm font-semibold text-emerald-700">
                                        Cottages in {t.name} →
                                    </span>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}
