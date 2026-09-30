"use client"

import React, { useMemo, useState } from 'react';
import { Map as MapIcon, List } from 'lucide-react';
import ListingCard, { type CardListing } from '@/components/ListingCard';
import PriceMap, { type PriceMapPoint } from '@/components/PriceMap';
import { publicArea } from '@/lib/places';
import { getImageUrl } from '@/lib/utils';

// The town-page results, laid out as Airbnb lays out a search: the property
// cards on the left, and a map on the right that stays in view while the cards
// scroll. Hovering a card lifts its price pin; clicking a pin opens a mini card
// that links to the listing. On a phone the list is full width and a floating
// "Show map" button swaps to a full-screen map (and back).
export default function TownSearch({ listings }: { listings: CardListing[] }) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [showMap, setShowMap] = useState(false);

    // Memoised so a hover (which re-renders this component) doesn't hand PriceMap
    // a new array identity and make it tear the whole map down and rebuild it.
    const points = useMemo<PriceMapPoint[]>(() =>
        listings
            .filter((l) => l.approx_latitude != null && l.approx_longitude != null)
            .map((l) => ({
                id: l.id,
                title: l.title,
                price: l.price_per_night,
                image: l.images && l.images[0] ? getImageUrl(l.images[0]) : null,
                area: publicArea(l.location),
                lat: Number(l.approx_latitude),
                lng: Number(l.approx_longitude),
                href: `/homes/${l.id}`,
            })),
        [listings]);

    const hasMap = points.length > 0;

    return (
        <>
            <div className={hasMap ? 'lg:grid lg:grid-cols-[3fr_2fr] lg:gap-8 lg:items-start' : ''}>
                <div className={'grid grid-cols-1 gap-x-6 gap-y-10 ' + (hasMap ? 'sm:grid-cols-2' : 'sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4')}>
                    {listings.map((l) => (
                        <div
                            key={l.id}
                            onMouseEnter={() => setHoveredId(l.id)}
                            onMouseLeave={() => setHoveredId((cur) => (cur === l.id ? null : cur))}
                        >
                            <ListingCard listing={l} />
                        </div>
                    ))}
                </div>

                {hasMap && (
                    // The map is ~40% of the width and stays a full viewport tall,
                    // pinned as the cards scroll — Airbnb's search layout. self-start
                    // keeps the sticky item from stretching to the taller cards
                    // column (which would stop it sticking); the height is measured
                    // from the sticky offset so the map fills the screen rather than
                    // ending partway down the list.
                    <div className="hidden lg:block lg:sticky lg:top-24 lg:self-start">
                        <PriceMap
                            points={points}
                            highlightId={hoveredId}
                            onHover={setHoveredId}
                            frameClassName="h-[calc(100vh-7rem)]"
                        />
                    </div>
                )}
            </div>

            {/* Phone: a floating pill that swaps the full-width list for a
                full-screen map, the Airbnb pattern. */}
            {hasMap && !showMap && (
                <button
                    type="button"
                    onClick={() => setShowMap(true)}
                    className="lg:hidden fixed bottom-6 left-1/2 z-40 -translate-x-1/2 inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(0,0,0,0.28)]"
                >
                    <MapIcon className="h-4 w-4" /> Show map
                </button>
            )}
            {hasMap && showMap && (
                <div className="lg:hidden fixed inset-0 z-[60] bg-white">
                    <PriceMap points={points} frameClassName="h-full" />
                    <button
                        type="button"
                        onClick={() => setShowMap(false)}
                        className="fixed bottom-6 left-1/2 z-[61] -translate-x-1/2 inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(0,0,0,0.28)]"
                    >
                        <List className="h-4 w-4" /> Show list
                    </button>
                </div>
            )}
        </>
    );
}
