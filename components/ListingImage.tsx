import Image from 'next/image';
import { Home } from 'lucide-react';
import { getImageUrl } from '@/lib/utils';

// The property photo, exactly as Our Properties draws it — the first image
// filling a rounded frame, and, when there isn't one, a composed empty state
// rather than a broken box. The seed cottages ship with no images, so the empty
// state is not an edge case; it is what most cards show until a host uploads.
//
// Lifted out of ListingCard so the home-page trip card can show a booked stay
// the same way the grid shows a listing, without a second copy of the photo /
// no-photo decision drifting from this one.
export default function ListingImage({
    images,
    alt,
    sizes,
    className,
    priority,
}: {
    images: string[] | null | undefined;
    alt: string;
    sizes?: string;
    className?: string;
    priority?: boolean;
}) {
    const first = images && images.length > 0 ? images[0] : null;

    if (!first) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-stone-200 text-stone-400">
                <Home className="h-10 w-10" />
            </div>
        );
    }

    return (
        <Image
            src={getImageUrl(first)}
            alt={alt}
            fill
            sizes={sizes}
            priority={priority}
            className={className}
        />
    );
}
