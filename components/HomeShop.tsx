'use client';

import { areaBySlug, listingInArea } from '@/config/areas';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import ListingCard from '@/components/ListingCard';
import PropertyFilters from '@/components/PropertyFilters';
import {
    readFilters,
    matchesFilters,
    activeFilterCount,
    propertyTypeLabel,
    QUICK_CHIPS,
    type FilterFacts,
} from '@/lib/listingFilters';
import { townKey } from '@/lib/places';
import { formatPrice } from '@/lib/formatMoney';
import { isSelfCheckIn } from '@/lib/checkInMethods';

// The home page's property shop, run in the browser.
//
// The page is edge-cached, so the SERVER renders every published listing (from
// the `unstable_cache`d read) and the full set of browse sections. This
// component reads the hero's search off the URL (?where/from/to/guests and the
// Filters panel's params) and narrows the grid to match — the same rules the
// page used to run server-side while it was force-dynamic, moved to the client
// so the HTML can be the same for everyone and cached. lib/listingFilters,
// townKey and isSelfCheckIn are isomorphic, so the numbers agree exactly with
// what the old server render produced.
//
// Availability for a DATED search is the one part that can't run client-side —
// busy nights, calendar blocks and iCal feeds are server reads — so it's posted
// to /api/listings/search-availability and the returned ids are dropped. While
// that read is in flight the matching listings show optimistically and are
// narrowed the moment it returns; a failed read leaves them in rather than
// emptying the search.
//
// When a search is on, the browse-only sections (towns, experiences, map,
// area links) are hidden, exactly as the server page hid them behind
// `!searching`. The editorial below the grid is always shown, as before.

type HomeListing = {
    id: string;
    title: string;
    location: string | null;
    price_per_night: number | string;
    images: string[] | null;
    rating_avg: number | string | null;
    rating_count: number | null;
    max_guests?: number | string | null;
    amenities?: string[] | null;
    approx_latitude?: number | string | null;
    approx_longitude?: number | string | null;
    property_type?: string | null;
    bedrooms?: number | string | null;
    beds?: number | string | null;
    bathrooms?: number | string | null;
    instant_book?: boolean | null;
    check_in_method?: string | null;
    [key: string]: any;
};

// The `where` slug the hero sends is the town with its spaces turned into
// hyphens, which is what townKey() produces once the hyphens come back out.
function whereLabel(slug: string): string {
    const area = areaBySlug(slug);
    if (area) return area.name;
    const small = ['of', 'and', 'the'];
    return slug
        .split('-')
        .map((word, i) =>
            i > 0 && small.includes(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
        )
        .join(' ');
}

const factsOf = (l: any): FilterFacts => ({
    amenities: l.amenities,
    property_type: l.property_type,
    price_per_night: l.price_per_night,
    bedrooms: l.bedrooms,
    beds: l.beds,
    bathrooms: l.bathrooms,
    instant_book: l.instant_book,
    self_check_in: isSelfCheckIn(l.check_in_method),
    is_luxury: l.is_luxury === true,
});

export default function HomeShop({
    listings,
    browseSections,
    editorial,
    areaLinks,
}: {
    listings: HomeListing[];
    browseSections: ReactNode;
    editorial: ReactNode;
    areaLinks: ReactNode;
}) {
    const sp = useSearchParams();

    const where = sp.get('where') || '';
    const from = sp.get('from') || '';
    const to = sp.get('to') || '';
    const guests = Number(sp.get('guests') || '') || 0;

    const filters = useMemo(
        () =>
            readFilters({
                am: sp.getAll('am'),
                type: sp.getAll('type'),
                pets: sp.get('pets') ?? undefined,
                pmin: sp.get('pmin') ?? undefined,
                pmax: sp.get('pmax') ?? undefined,
                bedrooms: sp.get('bedrooms') ?? undefined,
                beds: sp.get('beds') ?? undefined,
                baths: sp.get('baths') ?? undefined,
                ib: sp.get('ib') ?? undefined,
                selfci: sp.get('selfci') ?? undefined,
                lux: sp.get('lux') ?? undefined,
            }),
        [sp],
    );
    const filterCount = activeFilterCount(filters);
    const wantsPets = filters.amenities.indexOf('Pets allowed') !== -1;

    // Only trust a date pair that is actually a stay.
    const hasDates =
        /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from < to;
    const searching = Boolean(where) || hasDates || guests > 0 || filterCount > 0;

    // Everything matching where/when/who BEFORE the amenity/type/price panel —
    // the guest count and the town, settled synchronously.
    const whoWhere = useMemo(() => {
        let out = guests > 0
            ? listings.filter((l) => Number(l.max_guests) >= guests)
            : listings;
        if (where) {
            // An area slug from the hero: the area's own rule (listingInArea —
            // by town, or for Galloway Forest by the map circle), the same one
            // the tiles and area pages use. An older link's bare town still
            // matches by name.
            const area = areaBySlug(where);
            const wanted = where.replace(/[^a-z]/g, '');
            out = area
                ? out.filter((l) => listingInArea(area, l as any))
                : out.filter((l) => townKey(l.location) === wanted);
        }
        return out;
    }, [listings, guests, where]);

    // Availability for a dated search, read from the server. Keyed on the
    // candidate ids and the dates, so it re-runs when the search changes.
    const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
    const candidateKey = useMemo(
        () => whoWhere.map((l) => l.id).join(','),
        [whoWhere],
    );

    useEffect(() => {
        if (!hasDates) {
            setUnavailable(new Set());
            return;
        }
        const ids = candidateKey ? candidateKey.split(',') : [];
        if (ids.length === 0) {
            setUnavailable(new Set());
            return;
        }
        let live = true;
        fetch('/api/listings/search-availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ ids, from, to }),
        })
            .then((r) => (r.ok ? r.json() : { unavailable: [] }))
            .then((d) => {
                if (live) setUnavailable(new Set((d && d.unavailable) || []));
            })
            .catch(() => {
                // A failed read must not empty the search — keep every candidate.
                if (live) setUnavailable(new Set());
            });
        return () => {
            live = false;
        };
    }, [hasDates, candidateKey, from, to]);

    const afterDates = hasDates
        ? whoWhere.filter((l) => !unavailable.has(l.id))
        : whoWhere;

    // `pool` is everything that matches where/when/who, and is what the Filters
    // panel counts against — so its "Show N places" is exactly the grid you get.
    const pool = useMemo(() => afterDates.map(factsOf), [afterDates]);
    const grid = afterDates.filter((l) => matchesFilters(factsOf(l), filters));

    // What the guest asked for, said back to them.
    const criteria: string[] = [];
    if (where) criteria.push(whereLabel(where));
    if (hasDates) {
        criteria.push(`${format(parseISO(from), 'd MMM')} – ${format(parseISO(to), 'd MMM')}`);
    }
    if (guests > 0) criteria.push(`${guests} guest${guests > 1 ? 's' : ''}`);
    if (wantsPets) criteria.push('pets welcome');
    filters.amenities
        .filter((a) => a !== 'Pets allowed')
        .forEach((a) =>
            criteria.push(
                (QUICK_CHIPS.find((c) => c.amenity === a) || { label: a }).label.toLowerCase(),
            ),
        );
    filters.types.forEach((t) => criteria.push(propertyTypeLabel(t) || t));
    if (filters.minPrice != null || filters.maxPrice != null) {
        criteria.push(
            filters.maxPrice == null
                ? `from ${formatPrice(filters.minPrice)}`
                : filters.minPrice == null
                  ? `up to ${formatPrice(filters.maxPrice)}`
                  : `${formatPrice(filters.minPrice)}–${formatPrice(filters.maxPrice)}`,
        );
    }
    if (filters.bedrooms) criteria.push(`${filters.bedrooms}+ bedroom${filters.bedrooms > 1 ? 's' : ''}`);
    if (filters.beds) criteria.push(`${filters.beds}+ bed${filters.beds > 1 ? 's' : ''}`);
    if (filters.bathrooms) criteria.push(`${filters.bathrooms}+ bathroom${filters.bathrooms > 1 ? 's' : ''}`);
    if (filters.instantBook) criteria.push('Instant Book');
    if (filters.selfCheckIn) criteria.push('self check-in');
    if (filters.luxury) criteria.push('Luxury');

    return (
        <>
            {/* Section Heading */}
            <div className="mb-10 border-b border-stone-200 pb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                        {searching ? 'Stays that match' : 'Our Properties'}
                    </h2>
                    <p className="text-stone-600 text-sm md:text-base mt-1">
                        {searching
                            ? criteria.join(' · ')
                            : 'Handpicked self-catering accommodation in Dumfries & Galloway'}
                    </p>
                </div>
                {searching && (
                    <Link
                        href="/"
                        className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-4"
                    >
                        Clear search
                    </Link>
                )}
            </div>

            {/* Airbnb's Filters button and one-tap chips, over the grid. */}
            <PropertyFilters pool={pool} />

            {/* Property Grid */}
            {grid.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
                    {grid.map((property, i) => (
                        // The first row loads eagerly (the grid's LCP after the
                        // hero); the rest stay lazy.
                        <ListingCard key={property.id} listing={property} priority={i < 4} />
                    ))}
                </div>
            ) : searching ? (
                /* A search that found nothing is not an empty site, and must not
                   be described as one. */
                <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-stone-200">
                    <h3 className="text-lg font-semibold text-stone-800">
                        No stays match that search
                    </h3>
                    <p className="text-stone-500 mt-1 max-w-md mx-auto">
                        {hasDates ? (
                            <>Nothing is free for {criteria.join(' · ')}. Try different dates, or a wider area.</>
                        ) : (
                            <>Nothing matches {criteria.join(' · ')} yet. Try removing a filter.</>
                        )}
                    </p>
                    <Link
                        href="/"
                        className="inline-block mt-5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-full px-6 py-2.5 transition"
                    >
                        Show all properties
                    </Link>
                </div>
            ) : (
                <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-stone-200">
                    <h3 className="text-lg font-semibold text-stone-800">
                        No properties listed yet
                    </h3>
                    <p className="text-stone-500 mt-1 max-w-md mx-auto">
                        Ready to list your Kirkcudbright holiday stay? Click <strong>Add homes</strong> in the top menu to publish your first property!
                    </p>
                </div>
            )}

            {/* The browse-only sections (live experiences, towns carousel,
                experiences-for-business and the map) are hidden while a search
                is on, exactly as the server page hid them behind `!searching`. */}
            {!searching && browseSections}

            {/* The editorial is always shown, below the grid, as before. */}
            {editorial}

            {/* Area links: navigation, hidden during a search like the rest. */}
            {!searching && areaLinks}
        </>
    );
}
