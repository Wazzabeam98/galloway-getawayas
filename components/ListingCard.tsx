import Link from 'next/link';
import Image from 'next/image';
import { Home, Star, PawPrint, Bath } from 'lucide-react';
import { getImageUrl } from '@/lib/utils';
import { cardBadges } from '@/lib/listingRules';
import { publicArea } from '@/lib/places';
import { hasPublicScore } from '@/lib/reviews';

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
}

export default function ListingCard({ listing }: { listing: CardListing }) {
    const rating = listing.rating_avg ? Number(listing.rating_avg) : null;
    const count = listing.rating_count || 0;
    // At most two, from the amenities the host has already ticked. The rule
    // and the cap live in lib/listingRules.ts; which icon draws which is the
    // only part of it that belongs to the card.
    const badges = cardBadges(listing.amenities);

    return (
        <Link href={`/homes/${listing.id}`} className="group flex flex-col space-y-2">
            <div className="w-full h-64 rounded-2xl overflow-hidden bg-stone-200 relative">
                {listing.images && listing.images.length > 0 ? (
                    <Image
                        src={getImageUrl(listing.images[0])}
                        alt={`${listing.title}, a self-catering holiday cottage in ${publicArea(listing.location)}`}
                        fill
                        // One card per row on a phone, two on a tablet, four on
                        // a laptop — so the browser asks for a photo the size of
                        // the card rather than whatever was uploaded.
                        sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        className="object-cover group-hover:scale-105 transition duration-300"
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-stone-400">
                        <Home className="w-10 h-10" />
                    </div>
                )}

                {badges.length > 0 && (
                    // Wraps rather than overflowing: two pills and a narrow
                    // phone card is the case that would otherwise push the
                    // second one off the edge of the photo. `right-2` gives it
                    // something to wrap against.
                    <div className="absolute top-2 left-2 right-2 flex flex-wrap gap-1">
                        {badges.map((badge) => (
                            <span
                                key={badge.amenity}
                                // Hairline ring + drop shadow so the edge holds
                                // on any photo — a bare white pill dissolves
                                // into a pale sky. Unchanged from the paw,
                                // which was hardened for exactly that in
                                // 2813116; the hot tub inherits it rather than
                                // inventing a second treatment that would need
                                // checking on its own.
                                className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-xs font-semibold text-stone-800 shadow-md ring-1 ring-black/10 backdrop-blur"
                                title={badge.title}
                            >
                                {badge.amenity === 'Hot tub' ? (
                                    // sky-700 on the pill, not sky-500: the pill
                                    // is near-white on a bright photo and a mid
                                    // blue on near-white is the exact failure
                                    // the paw already had. 5.9:1 against white.
                                    <Bath className="w-3.5 h-3.5 text-sky-700" />
                                ) : (
                                    <PawPrint className="w-3.5 h-3.5 text-emerald-700" />
                                )}
                                {badge.label}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold text-stone-900 text-base truncate">{listing.title}</h3>

                {rating && hasPublicScore(count) ? (
                    <span className="flex items-center gap-1 text-sm text-stone-900 shrink-0">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        <span className="font-semibold">{rating.toFixed(2)}</span>
                        <span className="text-stone-400 font-normal">({count})</span>
                    </span>
                ) : (
                    <span className="text-xs text-emerald-700 font-semibold shrink-0 mt-0.5">New</span>
                )}
            </div>

            <p className="text-sm text-stone-500 truncate">{publicArea(listing.location)}</p>
            <p className="text-sm font-semibold text-stone-900">
                £{listing.price_per_night} <span className="font-normal text-stone-500">night</span>
            </p>
        </Link>
    );
}
