export const dynamic = "force-dynamic";
import React from 'react'
import type { Metadata } from 'next';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers';
import { capitializeFirst, displayName, getImageUrl, formatTime } from '@/lib/utils';
import BookingWidget from '@/components/BookingWidget';
import ReviewStars from '@/components/ReviewStars';
import PhotoGallery from '@/components/PhotoGallery';
import HostReplyBox from '@/components/HostReplyBox';
import ReviewsSummary from '@/components/ReviewsSummary';
import { hasPublicScore, MIN_PUBLIC_REVIEWS } from '@/lib/reviews';
import PropertyMap from '@/components/PropertyMap';
import ShowMoreText from '@/components/ShowMoreText';
import AmenityList from '@/components/AmenityList';
import MobileBookingBar from '@/components/MobileBookingBar';
import { KeyRound, Zap, Car, Bath, Waves, Flame, PawPrint, Briefcase, Plug, Users, MapPin, DoorOpen, BadgeCheck, Clock } from 'lucide-react';

// Turns the wizard's plural category into a noun that reads naturally in
// a sentence: "Entire townhouse in ..." rather than "Entire Townhouses".
const PROPERTY_NOUNS: Record<string, string> = {
    'Cottages': 'cottage',
    'Farmhouses': 'farmhouse',
    'Coastal Stays': 'coastal home',
    'Cabins & Pods': 'cabin',
    'Townhouses': 'townhouse',
    'Luxury Stays': 'home',
};

function describePlace(privacyType: string | null, propertyType: string | null): string {
    const noun = (propertyType && PROPERTY_NOUNS[propertyType]) || 'place';

    if (privacyType === 'A private room') return `Private room in a ${noun}`;
    if (privacyType === 'A shared room') return `Shared room in a ${noun}`;
    return `Entire ${noun}`;
}

// The stored location is a full address including street and postcode.
// Guests browsing shouldn't see the exact door number, so this keeps the
// town, region and country and drops the rest.
function placeSummary(location: string | null): string {
    if (!location) return '';

    const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
    const postcode = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/i;

    const kept = parts.filter((part, i) => {
        if (postcode.test(part)) return false;
        if (i === 0 && /^[0-9]/.test(part)) return false;
        return true;
    });

    return kept.join(', ');
}

// Things worth calling out at a glance. Every one is derived from real
// data on the listing — nothing here is decorative.
function propertyHighlights(home: any): { title: string; detail: string; icon: any }[] {
    const amenities: string[] = (home && home.amenities) || [];
    const has = (name: string) => amenities.indexOf(name) !== -1;
    const out: { title: string; detail: string; icon: any }[] = [];

    // How guests get in — worth showing high up, it's one of the first
    // things people want to know.
    const CHECKIN_BLURBS: Record<string, string> = {
        'Lockbox': 'Check yourself in with the lockbox.',
        'Smart lock': 'Let yourself in with a smart lock code.',
        'Keypad': 'Let yourself in using the door keypad.',
        'Host greets you': 'Your host will meet you at the property.',
        'Keys collected nearby': 'Keys are collected from a nearby address.',
        'Building staff': 'Building staff will let you in.',
    };

    if (home && home.check_in_method) {
        const selfServe = ['Lockbox', 'Smart lock', 'Keypad'].indexOf(home.check_in_method) !== -1;
        const methodIcons: Record<string, any> = {
            'Lockbox': KeyRound,
            'Smart lock': KeyRound,
            'Keypad': KeyRound,
            'Host greets you': Users,
            'Keys collected nearby': MapPin,
            'Building staff': DoorOpen,
        };
        out.push({
            title: selfServe ? 'Self check-in' : home.check_in_method,
            detail: CHECKIN_BLURBS[home.check_in_method] || '',
            icon: methodIcons[home.check_in_method] || KeyRound,
        });
    }

    if (home && home.instant_book) {
        out.push({
            title: 'Instant Book',
            detail: 'Your dates are confirmed straight away, with no wait for approval.',
            icon: Zap,
        });
    }
    if (has('Free parking on premises')) {
        out.push({ title: 'Park for free', detail: 'Free parking at the property.', icon: Car });
    }
    if (has('Hot tub')) {
        out.push({ title: 'Hot tub', detail: 'Unwind in the hot tub after a day out.', icon: Bath });
    }
    if (has('Waterfront') || has('Beach access')) {
        out.push({ title: 'By the water', detail: 'Right by the shore on the Solway coast.', icon: Waves });
    }
    if (has('Indoor fireplace')) {
        out.push({ title: 'Real fire', detail: 'An indoor fireplace for the colder months.', icon: Flame });
    }
    if (has('Pets allowed')) {
        out.push({ title: 'Pets welcome', detail: 'Bring the dog along for the trip.', icon: PawPrint });
    }
    if (has('Dedicated workspace')) {
        out.push({ title: 'Room to work', detail: 'A dedicated desk if you need to log on.', icon: Briefcase });
    }
    if (has('EV charger')) {
        out.push({ title: 'EV charging', detail: 'Charge your car on site overnight.', icon: Plug });
    }

    return out.slice(0, 4);
}

// Listings created before coordinates were captured don't have any, so
// look them up from the stored address instead. Next caches the result,
// so this is one lookup per listing rather than one per visitor.
async function lookupCoordinates(location: string | null) {
    if (!location) return null;

    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(location)}`,
            {
                headers: { 'User-Agent': 'GallowayGetawaysApp/1.0' },
                next: { revalidate: 60 * 60 * 24 * 30 },
            }
        );
        if (!res.ok) return null;

        const data = await res.json();
        if (!data || data.length === 0) return null;

        return {
            latitude: parseFloat(data[0].lat),
            longitude: parseFloat(data[0].lon),
        };
    } catch (err) {
        console.error('Could not look up coordinates:', err);
        return null;
    }
}


const SITE_URL = 'https://gallowaygetaways.co.uk';

// Per-listing page title and description. Without this every property
// shares one title and Google can't tell them apart — which is the
// single biggest thing holding back a site like this in search.
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
    const supabase = createServerComponentClient({ cookies });

    const { data: home } = await supabase
        .from('listings')
        .select('title, description, location, images, price_per_night, max_guests, bedrooms, property_type, privacy_type, amenities')
        .eq('id', params.id)
        .single();

    if (!home) {
        return {
            title: 'Property not found',
            description: 'This listing is no longer available.',
        };
    }

    const area = placeSummary(home.location) || 'Dumfries & Galloway';
    const town = area.split(',')[0].trim();
    const kind = describePlace(home.privacy_type, home.property_type).toLowerCase();

    // Built to match how people actually search: type of place, town, then
    // the detail that narrows it down.
    const title = `${home.title} | Self Catering in ${town}`;

    const amenities: string[] = home.amenities || [];
    const highlights: string[] = [];
    if (amenities.indexOf('Hot tub') !== -1) highlights.push('hot tub');
    if (amenities.indexOf('Pets allowed') !== -1) highlights.push('dog friendly');
    if (amenities.indexOf('Wifi') !== -1) highlights.push('wifi');
    const extras = highlights.length ? ` Features ${highlights.join(', ')}.` : '';

    const description =
        `${kind.charAt(0).toUpperCase()}${kind.slice(1)} in ${area}. ` +
        `Sleeps ${home.max_guests}, ${home.bedrooms} bedroom${home.bedrooms === 1 ? '' : 's'}, ` +
        `from £${home.price_per_night} per night.${extras} ` +
        `Book direct with a local host.`;

    const image = home.images && home.images.length > 0
        ? getImageUrl(home.images[0])
        : `${SITE_URL}/images/hero-1.jpg`;

    return {
        title,
        description,
        alternates: { canonical: `/homes/${params.id}` },
        openGraph: {
            type: 'website',
            locale: 'en_GB',
            url: `${SITE_URL}/homes/${params.id}`,
            siteName: 'Galloway Getaways',
            title: `${home.title} — from £${home.price_per_night} per night`,
            description,
            images: [{ url: image, width: 1200, height: 630, alt: home.title }],
        },
        twitter: {
            card: 'summary_large_image',
            title: home.title,
            description,
            images: [image],
        },
    };
}

const FindHome = async ({ params }: { params: { id: string } }) => {
    const supabase = createServerComponentClient({ cookies });

    const { data: home } = await supabase
        .from('listings')
        .select('*')
        .eq('id', params.id)
        .single();

    let hostName = 'Host';
    let hostAvatar: string | null = null;
    // Stripe has been through this host's identity documents. It is a check on
    // the person, not on the property, and the badge below says so.
    let hostVerified = false;
    if (home?.host_id) {
        const { data: hostProfile } = await supabase
            .from('profiles')
            .select('full_name, preferred_name, show_full_name, avatar_url, stripe_payouts_enabled')
            .eq('id', home.host_id)
            .single();
        hostName = displayName(hostProfile, 'Host');
        hostAvatar = hostProfile?.avatar_url || null;
        hostVerified = hostProfile?.stripe_payouts_enabled === true;
    }

    // Guests see a first name only — a surname on a public page is more
    // than anyone needs, and it's how the big platforms do it.
    const hostFirstName = capitializeFirst((hostName || 'Host').split(' ')[0]);
    const highlights = propertyHighlights(home);

    let coords: { latitude: number; longitude: number } | null =
        home?.latitude && home?.longitude
            ? { latitude: home.latitude, longitude: home.longitude }
            : null;
    if (!coords && home?.location) {
        coords = await lookupCoordinates(home.location);
    }

    if (!home) {
        return (
            <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-10'>
                <div className='mt-10 text-center text-slate-500'>
                    This listing couldn't be found.
                </div>
            </div>
        );
    }

    // Which statuses a stranger may see, named rather than excluded.
    //
    // This used to hide 'draft' and show everything else, which meant any
    // status added later was public the moment it existed. 'pending_review'
    // is about to exist, and a listing waiting for approval showing up on its
    // own URL — bookable — is exactly the failure that shape produces.
    //
    // An allow-list cannot fail that way: a new status is invisible until
    // somebody decides otherwise, which is the safe direction.
    //
    // 'hidden' is on the list because it was on it before — a hidden listing
    // is off the home page and out of the sitemap but has always still opened
    // at its own URL, which is what a guest holding a booking or an old link
    // needs. That is behaviour worth keeping, not a hole; changing it is a
    // separate decision from this one.
    const PUBLICLY_VISIBLE = ['published', 'hidden'];

    if (PUBLICLY_VISIBLE.indexOf(home.status) === -1) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id !== home.host_id) {
            return (
                <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-10'>
                    <div className='mt-10 text-center text-slate-500'>
                        This listing isn't published yet.
                    </div>
                </div>
            );
        }
    }

    const images: string[] = home.images || [];

    // Only published reviews are public. An unpublished one is still
    // waiting on the other side, or on the 14 day window closing.
    const { data: reviews } = await supabase
        .from('reviews')
        .select('*')
        .eq('listing_id', home.id)
        .eq('review_type', 'guest_to_host')
        .eq('is_published', true)
        .order('created_at', { ascending: false });

    const reviewerIds = Array.from(new Set((reviews || []).map((r) => r.reviewer_id)));
    let reviewerNames: Record<string, string> = {};
    if (reviewerIds.length) {
        const { data: reviewers } = await supabase.from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', reviewerIds);
        (reviewers || []).forEach((p) => { reviewerNames[p.id] = displayName(p, 'Guest'); });
    }

    const { data: { user: viewer } } = await supabase.auth.getUser();
    const isHostViewing = viewer?.id === home.host_id;

    // The stored average is maintained by a database trigger, so it's the
    // same number everywhere. Falls back to computing it if a listing
    // predates that trigger.
    const avgRating = home.rating_avg
        ? Number(home.rating_avg)
        : reviews && reviews.length
            ? reviews.reduce((sum, r) => sum + Number(r.rating), 0) / reviews.length
            : 0;

    // A handful of reviews is not a rating yet, so a listing stays "New" until
    // it has MIN_PUBLIC_REVIEWS of them rather than publishing a number that
    // one more review could swing by a whole star.
    const reviewCount = reviews?.length || 0;
    const showScore = hasPublicScore(reviewCount);

    return (
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-10 pb-24 lg:pb-0'>
            <div className='mt-4'>
                <h1 className='text-2xl md:text-3xl font-bold text-slate-900'>{home.title}</h1>
                <div className='flex items-center gap-1.5 mt-1.5 text-sm text-slate-600'>
                    {showScore ? (
                        <>
                            <ReviewStars value={Math.round(avgRating)} size={15} />
                            <span className='font-semibold text-slate-900'>{avgRating.toFixed(1)}</span>
                            <span>· {reviewCount} review{reviewCount > 1 ? 's' : ''}</span>
                        </>
                    ) : reviewCount > 0 ? (
                        <span className='inline-flex items-center gap-1.5 font-semibold text-slate-900'>
                            <span className='bg-emerald-50 text-emerald-800 text-xs px-2 py-0.5 rounded-full'>New</span>
                            {reviewCount} review{reviewCount > 1 ? 's' : ''} so far
                        </span>
                    ) : (
                        <span className='bg-emerald-50 text-emerald-800 text-xs px-2 py-0.5 rounded-full font-semibold'>New</span>
                    )}
                </div>

                {/* Structured data. This is what lets Google show a price,
                    star rating and photo directly in the search result —
                    the thing that makes a listing stand out against the
                    big agencies. */}
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            '@context': 'https://schema.org',
                            '@type': 'VacationRental',
                            name: home.title,
                            description: home.description,
                            url: `${SITE_URL}/homes/${home.id}`,
                            image: (home.images || []).slice(0, 6).map((img: string) => getImageUrl(img)),
                            address: {
                                '@type': 'PostalAddress',
                                addressLocality: (placeSummary(home.location) || '').split(',')[0].trim(),
                                addressRegion: 'Dumfries & Galloway',
                                addressCountry: 'GB',
                            },
                            ...(home.latitude && home.longitude
                                ? {
                                      geo: {
                                          '@type': 'GeoCoordinates',
                                          latitude: home.latitude,
                                          longitude: home.longitude,
                                      },
                                  }
                                : {}),
                            numberOfRooms: home.bedrooms,
                            occupancy: {
                                '@type': 'QuantitativeValue',
                                maxValue: home.max_guests,
                            },
                            amenityFeature: (home.amenities || []).map((a: string) => ({
                                '@type': 'LocationFeatureSpecification',
                                name: a,
                                value: true,
                            })),
                            ...(showScore
                                ? {
                                      aggregateRating: {
                                          '@type': 'AggregateRating',
                                          ratingValue: avgRating.toFixed(2),
                                          reviewCount: reviewCount,
                                          bestRating: 5,
                                          worstRating: 1,
                                      },
                                  }
                                : {}),
                            offers: {
                                '@type': 'Offer',
                                price: home.price_per_night,
                                priceCurrency: 'GBP',
                                availability: 'https://schema.org/InStock',
                                url: `${SITE_URL}/homes/${home.id}`,
                            },
                        }),
                    }}
                />

                <PhotoGallery images={images} title={home.title} />

                <div className='grid grid-cols-1 lg:grid-cols-3 gap-10 mt-5'>
                    <div className='order-2 lg:order-1 lg:col-span-2'>
                        <h2 className='text-xl md:text-2xl font-bold text-slate-900'>
                            {describePlace(home.privacy_type, home.property_type)}
                            {placeSummary(home.location) ? ` in ${placeSummary(home.location)}` : ''}
                        </h2>

                        <p className='mt-1 text-slate-600'>
                            {home.max_guests} guests · {home.bedrooms} bedrooms · {home.beds} beds · {home.bathrooms} bathrooms
                        </p>

                        <div className='flex items-center gap-3 mt-5 pt-5 border-t'>
                            <div className='w-11 h-11 rounded-full overflow-hidden bg-slate-900 text-white flex items-center justify-center font-semibold flex-shrink-0'>
                                {hostAvatar ? (
                                    <img
                                        src={getImageUrl(hostAvatar)}
                                        alt={`${hostFirstName}, host`}
                                        className='w-full h-full object-cover'
                                    />
                                ) : (
                                    hostFirstName.charAt(0)
                                )}
                            </div>
                            <div>
                                <div className='flex items-center gap-2 flex-wrap'>
                                    <span className='font-semibold text-slate-900'>
                                        Hosted by {hostFirstName}
                                    </span>
                                    {hostVerified && (
                                        <span className='inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5'>
                                            <BadgeCheck className='w-3.5 h-3.5' />
                                            Verified host
                                        </span>
                                    )}
                                </div>
                                {hostVerified && (
                                    <div className='text-sm text-slate-500'>
                                        Stripe has confirmed {hostFirstName}&apos;s identity.
                                    </div>
                                )}
                                {reviews && reviews.length > 0 && (
                                    <div className='text-sm text-slate-500'>
                                        {reviews.length} review{reviews.length > 1 ? 's' : ''} from guests
                                    </div>
                                )}
                            </div>
                        </div>

                        {(home.check_in_time || home.check_out_time) && (
                            <div className='mt-8 pt-8 lg:mt-5 lg:pt-5 border-t'>
                                <div className='flex items-start gap-4'>
                                    <Clock className='w-6 h-6 text-slate-700 flex-shrink-0 mt-0.5' />
                                    <div>
                                        <div className='font-semibold text-slate-900'>
                                            Check-in and checkout
                                        </div>
                                        <p className='text-sm text-slate-600 mt-0.5'>
                                            {formatTime(home.check_in_time) && (
                                                <>
                                                    Arrive from {formatTime(home.check_in_time)}
                                                    {formatTime(home.check_in_end_time)
                                                        ? ' until ' + formatTime(home.check_in_end_time)
                                                        : ''}
                                                    .{' '}
                                                </>
                                            )}
                                            {formatTime(home.check_out_time) && (
                                                <>Leave by {formatTime(home.check_out_time)} on your last morning.</>
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {highlights.length > 0 && (
                            <div className='mt-8 pt-8 lg:mt-5 lg:pt-5 border-t space-y-4'>
                                {highlights.map((h) => (
                                    <div key={h.title} className='flex items-start gap-4'>
                                        <h.icon className='w-6 h-6 text-slate-700 flex-shrink-0 mt-0.5' strokeWidth={1.5} />
                                        <div>
                                            <div className='font-semibold text-slate-900 text-sm'>{h.title}</div>
                                            <div className='text-sm text-slate-500'>{h.detail}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {home.amenities && home.amenities.length > 0 && (
                            <div className='mt-8 pt-8 lg:mt-5 lg:pt-0 border-t lg:border-t-0'>
                                <h2 className='text-xl font-semibold mb-3'>What this place offers</h2>
                                <AmenityList amenities={home.amenities} />
                            </div>
                        )}

                        <h1 className='mt-8 pt-8 lg:mt-5 lg:pt-0 border-t lg:border-t-0 font-semibold text-2xl'>
                            About this place
                        </h1>
                        <ShowMoreText text={home.description || ''} />

                        {Array.isArray(home.nearby) && home.nearby.length > 0 && (
                            <div className='mt-8 pt-8 border-t'>
                                <h2 className='text-xl font-semibold mb-1'>What&apos;s nearby</h2>
                                <p className='text-sm text-slate-500 mb-4'>
                                    Local spots your host recommends.
                                </p>
                                <div className='border rounded-2xl divide-y'>
                                    {home.nearby.map((item: any, i: number) => (
                                        <div key={i} className='flex items-center justify-between p-4'>
                                            <span className='text-sm text-slate-800 pr-4'>{item.name}</span>
                                            {item.time && (
                                                <span className='text-sm text-slate-500 flex-shrink-0'>{item.time}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {coords && (
                            <PropertyMap
                                latitude={coords.latitude}
                                longitude={coords.longitude}
                                area={placeSummary(home.location)}
                            />
                        )}

                        {(!reviews || reviews.length === 0) && (
                            <div className='mt-8 pt-8 border-t'>
                                <h2 className='text-xl font-semibold mb-2'>Reviews</h2>
                                <div className='border rounded-2xl p-6 bg-slate-50'>
                                    <div className='font-semibold text-slate-900 mb-1'>
                                        No reviews yet
                                    </div>
                                    <p className='text-sm text-slate-600'>
                                        This place is newly listed, so nobody has stayed and reviewed it
                                        through Galloway Getaways yet. Reviews appear here once guests
                                        have checked out — and being one of the first to stay means
                                        yours will be the one others read.
                                    </p>
                                </div>
                            </div>
                        )}

                        {reviews && reviews.length > 0 && (
                            <div className='mt-8'>
                                {showScore && (
                                    <ReviewsSummary
                                        reviews={reviews}
                                        ratingAvg={avgRating}
                                        ratingCount={home.rating_count || reviewCount}
                                        categoryAverages={{
                                            cleanliness: home.rating_cleanliness,
                                            accuracy: home.rating_accuracy,
                                            checkin: home.rating_checkin,
                                            communication: home.rating_communication,
                                            location: home.rating_location,
                                            value: home.rating_value,
                                        }}
                                    />
                                )}

                                <h2 className='text-xl font-semibold my-6 flex items-center gap-2'>
                                    {showScore ? (
                                        <>
                                            <ReviewStars value={Math.round(avgRating)} size={18} />
                                            {avgRating.toFixed(1)} · {reviewCount} review{reviewCount > 1 ? 's' : ''}
                                        </>
                                    ) : (
                                        <>{reviewCount} review{reviewCount > 1 ? 's' : ''}</>
                                    )}
                                </h2>
                                {!showScore && (
                                    <p className='text-sm text-slate-600 -mt-3 mb-6'>
                                        An overall score appears once this place has{' '}
                                        {MIN_PUBLIC_REVIEWS} reviews.
                                    </p>
                                )}
                                <div className='space-y-5'>
                                    {reviews.map((r) => (
                                        <div key={r.id} className='border-b pb-5'>
                                            <div className='flex items-center justify-between mb-1'>
                                                <span className='font-semibold text-slate-900'>{capitializeFirst(reviewerNames[r.reviewer_id] || 'Guest')}</span>
                                                <ReviewStars value={r.rating} size={14} />
                                            </div>
                                            <p className='text-sm text-slate-700'>{r.comment}</p>
                                            {isHostViewing ? (
                                                <HostReplyBox reviewId={r.id} existingReply={r.host_reply} />
                                            ) : r.host_reply ? (
                                                <div className='mt-3 ml-4 pl-4 border-l-2 border-slate-200'>
                                                    <p className='text-xs font-semibold text-slate-500 mb-1'>Response from the host</p>
                                                    <p className='text-sm text-slate-700'>{r.host_reply}</p>
                                                </div>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Under the photos on a phone, second column from lg up
                        exactly as before. `order` is all that moves. */}
                    <div id='book' className='order-1 lg:order-2 scroll-mt-6'>
                        <BookingWidget
                            listingId={home.id}
                            hostId={home.host_id}
                            pricePerNight={home.price_per_night}
                            maxGuests={home.max_guests || 1}
                            petsAllowed={(home.amenities || []).includes('Pets allowed')}
                            instantBook={home.instant_book === true}
                            instantBookRequiresPhone={home.instant_book_requires_phone === true}
                            instantBookRequiresVerifiedId={home.instant_book_requires_verified_id === true}
                            icalImportUrl={home.ical_import_url}
                            weekendPrice={home.weekend_price}
                            cleaningFee={home.cleaning_fee || 0}
                            petFee={home.pet_fee || 0}
                            extraGuestFee={home.extra_guest_fee || 0}
                            extraGuestAfter={home.extra_guest_after || 1}
                            extraGuestPeriod={home.extra_guest_period || 'night'}
                            damageDeposit={home.damage_deposit || 0}
                            availabilityWindow={home.availability_window}
                            cancellationPolicy={home.cancellation_policy}
                        />
                    </div>
                </div>
            </div>
            <MobileBookingBar
                pricePerNight={home.price_per_night}
                label={home.instant_book === true ? 'Reserve' : 'Request to book'}
                targetId='book'
            />
        </div>
    )
}

export default FindHome
