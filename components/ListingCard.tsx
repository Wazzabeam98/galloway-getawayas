import Link from 'next/link';
import { Star, PawPrint, Bath, ThermometerSun, Waves, Check, Gem, type LucideIcon } from 'lucide-react';
import ListingImage from '@/components/ListingImage';
import { cardBadges } from '@/lib/listingRules';
import { publicArea } from '@/lib/places';
import { hasPublicScore } from '@/lib/reviews';
import { nearestTown, nearestTownLabel } from '@/lib/nearestTown';
import { propertyTypeLabel } from '@/lib/listingFilters';
import ListingStats from '@/components/ListingStats';
import { formatPrice } from '@/lib/formatMoney';

// One property card, used by the home page grid and by the area pages.
//
// Lifted out of app/page.tsx rather than copied, because the two would have
// drifted — and the thing that would have drifted is the rating rule. A card
// must not show a score until the listing has MIN_PUBLIC_REVIEWS of them
// (lib/reviews.ts), and a second copy of that condition is a second place for
// it to be got wrong.
//
// The alt text is the property title plus what the place is and where it is.
// Not decorative: for "holiday cottage Kirkcudbright" Google Images is a real
// way in, and these are the only pictures on the site of the places being sold.
//
// The title alone was too thin — "Rowan Cottage" is a name, not a description,
// and it tells a search engine nothing about what the picture shows. These
// photos are uploaded by hosts, so the code cannot know whether a given one is
// the kitchen or the view; what it can say truthfully is what the property is
// and which town it is in, which is the query guests actually type.

export interface CardListing {
    id: string;
    title: string;
    location: string | null;
    price_per_night: number | string;
    images: string[] | null;
    rating_avg: number | string | null;
    rating_count: number | null;
    /**
     * Drives the badges. 'Pets allowed' and 'Hot tub' are amenities hosts
     * already tick — see cardBadges in lib/listingRules.ts.
     */
    amenities?: string[] | null;
    /**
     * The ~110m public point. Two things read it: the search map's price pin,
     * and — when the property is outside one of the main towns — the card's
     * "X miles from <nearest town>" line. Optional, so a grid that doesn't
     * select the columns simply omits both.
     */
    approx_latitude?: number | string | null;
    approx_longitude?: number | string | null;
    /** The category the host picked at sign-up ("Cottages", "Townhouses"…). */
    property_type?: string | null;
    /**
     * The counts shown in the small stats row under the location. Optional, so a
     * grid that doesn't select them simply omits the items it hasn't got;
     * `max_pets` is null when pets aren't allowed or no number is stored.
     */
    max_guests?: number | string | null;
    bedrooms?: number | string | null;
    bathrooms?: number | string | null;
    max_pets?: number | string | null;
    /** Our Luxury tag — set by an admin, never by the host (Airbnb Luxe's shape). */
    is_luxury?: boolean | null;
}

// Which icon and colour draws which badge. The rule and the cap live in
// lib/listingRules.ts (cardBadges, BADGE_AMENITIES); this is the only part
// that belongs to the card. Each colour is a Tailwind 700 so they sit in
// one family on the near-white pill (bg-white/95): sky-700 5.9:1, emerald-700
// 5.5:1, cyan-700 5.4:1 and amber-700 5.0:1 against white — all clear of the 4.5:1 AA floor,
// white being the worst case. A badge amenity with no entry here draws a
// neutral tick rather than the wrong icon (the old ternary gave everything
// that was not a hot tub a green paw).
const BADGE_STYLE: Record<string, { Icon: LucideIcon; color: string }> = {
    'Hot tub': { Icon: Bath, color: 'text-sky-700' },
    'Pets allowed': { Icon: PawPrint, color: 'text-emerald-700' },
    'Pool': { Icon: Waves, color: 'text-cyan-700' },
    'Sauna': { Icon: ThermometerSun, color: 'text-amber-700' },
};

export default function ListingCard({ listing, priority = false }: { listing: CardListing; priority?: boolean }) {
    const rating = listing.rating_avg ? Number(listing.rating_avg) : null;
    const count = listing.rating_count || 0;
    // At most two, from the amenities the host has already ticked. The rule
    // and the cap live in lib/listingRules.ts; which icon draws which is the
    // only part of it that belongs to the card.
    const badges = cardBadges(listing.amenities);
    const near = nearestTown(listing.location, listing.approx_latitude, listing.approx_longitude);
    // Airbnb's line under the title: "Cottage in Kirkcudbright". Just the area
    // when the host never picked a type.
    const type = propertyTypeLabel(listing.property_type);
    const area = publicArea(listing.location);

    return (
        // Airbnb's card: the whole card is clickable, but the LINK is just the
        // title, stretched over the card (after:inset-0). A crawler and a screen
        // reader get "Mains of Greenlaw Cottage" as the link text instead of the
        // card's every line run together — badge, title, place, price — and the
        // title is plain text, not a heading: a grid of h3s gave the home page
        // 28 headings with no structure.
        <div className="group relative flex flex-col space-y-2">
            <div className="w-full h-64 rounded-2xl overflow-hidden bg-stone-200 relative">
                <ListingImage
                    images={listing.images}
                    alt={`${listing.title}, self-catering accommodation in ${publicArea(listing.location)}`}
                    // One card per row on a phone, two on a tablet, four on
                    // a laptop — so the browser asks for a photo the size of
                    // the card rather than whatever was uploaded.
                    sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    // The first row of cards is the grid's LCP — load those eagerly
                    // with a priority hint so they don't start out as grey boxes;
                    // the rest stay lazy (the default). The caller passes priority
                    // for the first few cards only.
                    priority={priority}
                    className="object-cover group-hover:scale-105 transition duration-300"
                />

                {(badges.length > 0 || listing.is_luxury === true) && (
                    // Wraps rather than overflowing: two pills and a narrow
                    // phone card is the case that would otherwise push the
                    // second one off the edge of the photo. `right-2` gives it
                    // something to wrap against.
                    <div className="absolute top-2 left-2 right-2 flex flex-wrap gap-1">
                        {/* Luxury leads, in its own dark pill: it is our mark on
                            the place, not an amenity the host ticked, so it sits
                            apart from (and outside the cap of) the ones below. */}
                        {listing.is_luxury === true && (
                            <span
                                className="inline-flex items-center gap-1 rounded-full bg-stone-900/90 px-2 py-1 text-xs font-semibold text-white shadow-md ring-1 ring-black/10 backdrop-blur"
                                title="Luxury — chosen by Galloway Getaways"
                            >
                                <Gem className="w-3.5 h-3.5 text-amber-300" />
                                Luxury
                            </span>
                        )}
                        {badges.map((badge) => {
                            // Each badge draws its own icon and colour (see
                            // BADGE_STYLE). The colour is a 700 for the same
                            // reason the hot tub's was: the pill is near-white
                            // on a bright photo, and a mid tone on near-white is
                            // the exact failure the paw was hardened against.
                            const { Icon, color } = BADGE_STYLE[badge.amenity]
                                || { Icon: Check, color: 'text-slate-700' };
                            return (
                                <span
                                    key={badge.amenity}
                                    // Hairline ring + drop shadow so the edge
                                    // holds on any photo — a bare white pill
                                    // dissolves into a pale sky. Hardened for
                                    // exactly that in 2813116; every badge
                                    // inherits it rather than inventing a second
                                    // treatment that would need checking on its own.
                                    className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-xs font-semibold text-stone-800 shadow-md ring-1 ring-black/10 backdrop-blur"
                                    title={badge.title}
                                >
                                    <Icon className={`w-3.5 h-3.5 ${color}`} />
                                    {badge.label}
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="flex items-start justify-between gap-2">
                <p className="font-bold text-stone-900 text-base truncate">
                    <Link href={`/homes/${listing.id}`} className="after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-emerald-600">
                        {listing.title}
                    </Link>
                </p>

                {rating && hasPublicScore(count) ? (
                    <span className="flex items-center gap-1 text-sm text-stone-900 shrink-0">
                        <Star className="w-3.5 h-3.5 fill-stone-900 text-stone-900" />
                        <span className="font-semibold">{rating.toFixed(2)}</span>
                        <span className="text-stone-400 font-normal">({count})</span>
                    </span>
                ) : (
                    <span className="text-xs text-emerald-700 font-semibold shrink-0 mt-0.5">New</span>
                )}
            </div>

            <p className="text-sm text-stone-500 truncate">{type ? `${type} in ${area}` : area}</p>
            <ListingStats
                maxGuests={listing.max_guests}
                bedrooms={listing.bedrooms}
                bathrooms={listing.bathrooms}
                petsAllowed={(listing.amenities || []).includes('Pets allowed')}
                maxPets={listing.max_pets}
            />
            <p className="text-sm font-semibold text-stone-900">
                {formatPrice(listing.price_per_night)} <span className="font-normal text-stone-500">night</span>
            </p>
            {/* The distance line sits at the very bottom, under the price, so
                that the price lands at the same height on every card in a row —
                a card out in the country doesn't push its own price down. */}
            {near && (
                <p className="text-xs text-stone-400 truncate">{nearestTownLabel(near)}</p>
            )}
        </div>
    );
}
