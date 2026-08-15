export const dynamic = "force-dynamic";
import React from 'react'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers';
import { capitializeFirst, displayName } from '@/lib/utils';
import BookingWidget from '@/components/BookingWidget';
import ReviewStars from '@/components/ReviewStars';
import PhotoGallery from '@/components/PhotoGallery';
import HostReplyBox from '@/components/HostReplyBox';
import ReviewsSummary from '@/components/ReviewsSummary';

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

const FindHome = async ({ params }: { params: { id: string } }) => {
    const supabase = createServerComponentClient({ cookies });

    const { data: home } = await supabase
        .from('listings')
        .select('*')
        .eq('id', params.id)
        .single();

    let hostName = 'Host';
    if (home?.host_id) {
        const { data: hostProfile } = await supabase
            .from('profiles')
            .select('full_name, preferred_name, show_full_name')
            .eq('id', home.host_id)
            .single();
        hostName = displayName(hostProfile, 'Host');
    }

    if (!home) {
        return (
            <div className='container mb-10'>
                <div className='container mt-10 text-center text-slate-500'>
                    This listing couldn't be found.
                </div>
            </div>
        );
    }

    if (home.status === 'draft') {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id !== home.host_id) {
            return (
                <div className='container mb-10'>
                    <div className='container mt-10 text-center text-slate-500'>
                        This listing isn't published yet.
                    </div>
                </div>
            );
        }
    }

    const images: string[] = home.images || [];

    const { data: reviews } = await supabase
        .from('reviews')
        .select('*')
        .eq('listing_id', home.id)
        .eq('review_type', 'guest_to_host')
        .order('created_at', { ascending: false });

    const reviewerIds = Array.from(new Set((reviews || []).map((r) => r.reviewer_id)));
    let reviewerNames: Record<string, string> = {};
    if (reviewerIds.length) {
        const { data: reviewers } = await supabase.from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', reviewerIds);
        (reviewers || []).forEach((p) => { reviewerNames[p.id] = displayName(p, 'Guest'); });
    }

    const { data: { user: viewer } } = await supabase.auth.getUser();
    const isHostViewing = viewer?.id === home.host_id;

    const avgRating = reviews && reviews.length
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;

    return (
        <div className='container mb-10'>
            <div className='container mt-4'>
                <h1 className='text-2xl md:text-3xl font-bold text-slate-900'>{home.title}</h1>
                {reviews && reviews.length > 0 && (
                    <div className='flex items-center gap-1.5 mt-1.5 text-sm text-slate-600'>
                        <ReviewStars value={Math.round(avgRating)} size={15} />
                        <span className='font-semibold text-slate-900'>{avgRating.toFixed(1)}</span>
                        <span>· {reviews.length} review{reviews.length > 1 ? 's' : ''}</span>
                    </div>
                )}

                <PhotoGallery images={images} title={home.title} />

                <div className='grid grid-cols-1 lg:grid-cols-3 gap-10 mt-5'>
                    <div className='lg:col-span-2'>
                        <h2 className='text-xl md:text-2xl font-bold text-slate-900'>
                            {describePlace(home.privacy_type, home.property_type)}
                            {placeSummary(home.location) ? ` in ${placeSummary(home.location)}` : ''}
                        </h2>

                        <p className='mt-1 text-slate-600'>
                            {home.max_guests} guests · {home.bedrooms} bedrooms · {home.beds} beds · {home.bathrooms} bathrooms
                        </p>

                        <div className='flex items-center gap-3 mt-5 pt-5 border-t'>
                            <div className='w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold text-sm flex-shrink-0'>
                                {capitializeFirst(hostName).charAt(0)}
                            </div>
                            <div className='font-semibold text-slate-900'>
                                Hosted by {capitializeFirst(hostName)}
                            </div>
                        </div>

                        {home.amenities && home.amenities.length > 0 && (
                            <div className='mt-5'>
                                <h2 className='text-xl font-semibold mb-2'>What this place offers</h2>
                                <div className='flex flex-wrap gap-2'>
                                    {home.amenities.map((a: string) => (
                                        <span key={a} className='text-sm bg-slate-100 px-3 py-1 rounded-full'>{a}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <h1 className='mt-5 font-semibold text-2xl'>
                            About this place
                        </h1>
                        <div className='mt-2 whitespace-pre-line'>
                            {home.description}
                        </div>

                        {reviews && reviews.length > 0 && (
                            <div className='mt-8'>
                                <ReviewsSummary reviews={reviews} />

                                <h2 className='text-xl font-semibold my-6 flex items-center gap-2'>
                                    <ReviewStars value={Math.round(avgRating)} size={18} />
                                    {avgRating.toFixed(1)} · {reviews.length} review{reviews.length > 1 ? 's' : ''}
                                </h2>
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

                    <div>
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
                            availabilityWindow={home.availability_window}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}

export default FindHome
