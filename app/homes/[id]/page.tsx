export const dynamic = "force-dynamic";
import React from 'react'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers';
import Image from 'next/image';
import { capitializeFirst, getImageUrl, displayName } from '@/lib/utils';
import BookingWidget from '@/components/BookingWidget';
import ReviewStars from '@/components/ReviewStars';
import HostReplyBox from '@/components/HostReplyBox';
import ReviewsSummary from '@/components/ReviewsSummary';

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
                <h1 className='text-2xl font-bold'>{home.title}</h1>
                {reviews && reviews.length > 0 && (
                    <div className='flex items-center gap-2 mt-1'>
                        <ReviewStars value={Math.round(avgRating)} size={16} />
                        <span className='text-sm text-slate-600'>{avgRating.toFixed(1)} · {reviews.length} review{reviews.length > 1 ? 's' : ''}</span>
                    </div>
                )}
                <p className='text-slate-600'>{home.location}</p>

                {images.length > 0 ? (
                    <Image
                        src={getImageUrl(images[0])}
                        width={100}
                        height={100}
                        alt='home_image'
                        className='rounded-lg w-full h-[500px] object-cover object-center my-3'
                        unoptimized
                    />
                ) : (
                    <div className='rounded-lg w-full h-[500px] bg-slate-100 flex items-center justify-center text-slate-400 my-3'>
                        No photo available
                    </div>
                )}

                {images.length > 1 && (
                    <div className='grid grid-cols-4 gap-2 mb-5'>
                        {images.slice(1).map((img, i) => (
                            <Image
                                key={i}
                                src={getImageUrl(img)}
                                width={100}
                                height={100}
                                alt={`home_image_${i + 2}`}
                                className='rounded-lg w-full h-24 object-cover'
                                unoptimized
                            />
                        ))}
                    </div>
                )}

                <div className='grid grid-cols-1 lg:grid-cols-3 gap-10 mt-5'>
                    <div className='lg:col-span-2'>
                        <h1 className='text-2xl font-bold text-brand'>
                            Hosted by {capitializeFirst(hostName)}
                        </h1>

                        <p className='mt-2 text-slate-600'>
                            {home.max_guests} guests · {home.bedrooms} bedrooms · {home.beds} beds · {home.bathrooms} bathrooms
                        </p>

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
