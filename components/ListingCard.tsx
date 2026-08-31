import Link from 'next/link';
import Image from 'next/image';
import { Home, Star, PawPrint } from 'lucide-react';
import { getImageUrl } from '@/lib/utils';
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
// The alt text is the property title. Not decorative: for "holiday cottage
// Kirkcudbright" Google Images is a real way in, and these are the only
// pictures on the site of the places being sold.

export interface CardListing {
    id: string;
    title: string;
    location: string | null;
    price_per_night: number | string;
    images: string[] | null;
    rating_avg: number | string | null;
    rating_count: number | null;
    /** Drives the pet-friendly paw. 'Pets allowed' is the amenity hosts tick. */
    amenities?: string[] | null;
}

export default function ListingCard({ listing }: { listing: CardListing }) {
    const rating = listing.rating_avg ? Number(listing.rating_avg) : null;
    const count = listing.rating_count || 0;
    // The pet-friendly flag hosts already tick, as an amenity.
    const petFriendly = Array.isArray(listing.amenities) && listing.amenities.indexOf('Pets allowed') !== -1;

    return (
        <Link href={`/homes/${listing.id}`} className="group flex flex-col space-y-2">
            <div className="w-full h-64 rounded-2xl overflow-hidden bg-stone-200 relative">
                {listing.images && listing.images.length > 0 ? (
                    <Image
                        src={getImageUrl(listing.images[0])}
                        alt={listing.title}
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

                {petFriendly && (
                    <span
                        className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-xs font-semibold text-stone-800 shadow-sm backdrop-blur"
                        title="Dogs welcome"
                    >
                        <PawPrint className="w-3.5 h-3.5 text-emerald-700" />
                        Pet friendly
                    </span>
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
