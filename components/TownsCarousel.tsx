'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// The towns, one panel each, on the home page. A visual "browse by area" that
// leads to the area pages — which is where the search traffic actually lands.
//
// Horizontal scroll on purpose, and built to survive a phone: the row scrolls,
// each panel snaps, and a panel is a fixed width rather than a fraction of the
// screen, so it never collapses to a sliver or clips its text on a narrow one.
//
// A town is only here once it has a photo — page.tsx checks the file on disk
// and passes a resolved `photo` path, so this component always has a real image
// to show. The onError fallback stays as a safety net for a file that vanishes
// between the check and the request, not as the normal empty state.
//
// `photoAlt` describes what is actually in the photograph, and page.tsx is
// where those descriptions live, next to the file lookup. The town name is
// already the heading directly under the picture, so repeating it in the alt
// tells Google Images nothing it does not have — "a roofless stone tower house
// against a blue sky" is what puts the photo in front of somebody searching
// for one.

interface Town {
    slug: string;
    name: string;
    blurb: string;
    photo: string;
    photoAlt: string;
}

function TownPhoto({ photo, alt, name }: { photo: string; alt: string; name: string }) {
    const [broken, setBroken] = useState(false);

    return (
        <div className="relative aspect-[3/2] w-full overflow-hidden rounded-t-2xl bg-stone-200">
            {!broken ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={photo}
                    alt={alt}
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
    const scrollRef = useRef<HTMLUListElement>(null);
    // Whether the row can scroll further each way. Both start false so the
    // arrows only appear once we have measured a row that actually overflows —
    // when every panel fits, there is nothing more coming and no arrow to show.
    const [canLeft, setCanLeft] = useState(false);
    const [canRight, setCanRight] = useState(false);

    const update = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        setCanLeft(el.scrollLeft > 1);
        setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    }, []);

    useEffect(() => {
        update();
        const el = scrollRef.current;
        if (!el) return;
        el.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        return () => {
            el.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
        };
    }, [update, towns.length]);

    const scrollBy = (dir: 1 | -1) => {
        const el = scrollRef.current;
        if (!el) return;
        // Most of a screen at a time, so a nudge always reveals a fresh panel
        // rather than a sliver, and the snap lands it cleanly.
        el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
    };

    if (!towns || towns.length === 0) return null;

    return (
        <section className="mt-16">
            <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                Where to stay in Dumfries &amp; Galloway
            </h2>
            <p className="text-stone-600 text-sm md:text-base mt-1 mb-6">
                {towns.length} {towns.length === 1 ? 'town' : 'towns'} across the region, and what
                each one is for.
            </p>

            <div className="relative -mx-4 sm:mx-0">
                <ul
                    ref={scrollRef}
                    className="flex gap-4 overflow-x-auto px-4 sm:px-0 pb-2 snap-x snap-mandatory
                               [scrollbar-width:thin]"
                >
                    {towns.map((t) => (
                        <li key={t.slug} className="snap-start shrink-0 w-72">
                            <Link
                                href={'/holiday-cottages/' + t.slug}
                                className="group block h-full rounded-2xl border border-stone-200 hover:border-stone-900 transition overflow-hidden"
                            >
                                <TownPhoto photo={t.photo} alt={t.photoAlt} name={t.name} />
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

                {canLeft && (
                    <button
                        type="button"
                        aria-label="Scroll to previous towns"
                        onClick={() => scrollBy(-1)}
                        className="absolute left-2 top-[calc(33%-1rem)] z-10 hidden sm:flex h-10 w-10 items-center
                                   justify-center rounded-full bg-white/90 shadow-md ring-1 ring-stone-200
                                   text-stone-900 hover:bg-white transition"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                )}

                {canRight && (
                    <button
                        type="button"
                        aria-label="Scroll to more towns"
                        onClick={() => scrollBy(1)}
                        className="absolute right-2 top-[calc(33%-1rem)] z-10 hidden sm:flex h-10 w-10 items-center
                                   justify-center rounded-full bg-white/90 shadow-md ring-1 ring-stone-200
                                   text-stone-900 hover:bg-white transition"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </button>
                )}
            </div>
        </section>
    );
}
