'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

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
                // Through the image optimiser, sized to the panel (w-72 = 288px).
                // A plain <img> here sent the original file — the curated town
                // photos are several hundred KB each, and a region borrowing a
                // host's listing photo (Galloway Forest) sent a 1.6 MB phone
                // original into a 288px tile.
                <Image
                    src={photo}
                    alt={alt}
                    fill
                    sizes="288px"
                    className="object-cover"
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

    // Airbnb's row: both arrows up beside the heading, always shown, the one
    // with nowhere to go greyed out; no scroll bar under the row (a phone still
    // swipes it, and the next card peeking in says there is more).
    const arrow = (dir: 1 | -1, enabled: boolean) => (
        <button
            type="button"
            aria-label={dir === 1 ? 'Show more places' : 'Show previous places'}
            onClick={() => scrollBy(dir)}
            disabled={!enabled}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-300 bg-white
                       text-stone-900 transition hover:border-stone-900 hover:shadow-sm
                       disabled:cursor-default disabled:border-stone-200 disabled:text-stone-300 disabled:hover:shadow-none"
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points={dir === 1 ? '9 18 15 12 9 6' : '15 18 9 12 15 6'} />
            </svg>
        </button>
    );

    return (
        <section className="mt-16">
            <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                        Where to stay in Dumfries &amp; Galloway
                    </h2>
                    {/* "places", not "towns": Galloway Forest is a forest park. */}
                    <p className="text-stone-600 text-sm md:text-base mt-1">
                        {towns.length} {towns.length === 1 ? 'place' : 'places'} across the region, and what
                        each one is for.
                    </p>
                </div>
                {(canLeft || canRight) && (
                    <div className="flex flex-none gap-2 pb-1">
                        {arrow(-1, canLeft)}
                        {arrow(1, canRight)}
                    </div>
                )}
            </div>

            <div className="relative -mx-4 sm:mx-0 mt-6">
                <ul
                    ref={scrollRef}
                    className="flex gap-4 overflow-x-auto px-4 sm:px-0 scroll-px-4 sm:scroll-px-0 pb-2 snap-x snap-mandatory
                               [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                    {towns.map((t) => (
                        <li key={t.slug} className="snap-start shrink-0 w-72">
                            {/* Every card the height of the tallest (the row
                                stretches its items), with the link pinned to the
                                bottom, so the green links line up across the row
                                whatever the length of each blurb. */}
                            {/* The card is clickable throughout, but the link
                                is only "Stays in <place> →", stretched over it —
                                the same pattern as ListingCard — so the link text
                                is short and unique, and the place name is plain
                                text, not a heading. */}
                            <div className="group relative flex h-full flex-col rounded-2xl border border-stone-200 hover:border-stone-900 transition overflow-hidden">
                                <TownPhoto photo={t.photo} alt={t.photoAlt} name={t.name} />
                                <div className="flex flex-1 flex-col p-4">
                                    <p className="font-bold text-stone-900">{t.name}</p>
                                    <p className="mt-1 text-sm text-stone-600">{t.blurb}</p>
                                    {/* "Stays", Airbnb's word, on the link; the
                                        area pages keep "Holiday lets in …" in
                                        their own titles and URLs for search. */}
                                    <Link
                                        href={'/holiday-cottages/' + t.slug}
                                        className="mt-auto pt-3 text-sm font-semibold text-emerald-700 after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-emerald-600"
                                    >
                                        Stays in {t.name} →
                                    </Link>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}
