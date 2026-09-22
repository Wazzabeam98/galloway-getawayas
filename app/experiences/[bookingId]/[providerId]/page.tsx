import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadMarketplace, pickProvider } from '@/lib/experiencesData';
import { loadExperienceReviews } from '@/lib/experienceReviews';
import ExperienceListingBody from '@/components/marketplace/ExperienceListingBody';
import BookingPanel from '@/components/marketplace/BookingPanel';

export const dynamic = 'force-dynamic';

// The browser tab carries the provider's name — "Loch Sauna | Galloway Getaways"
// (the root layout appends the suffix). Private (behind a booking), so noindex.
export async function generateMetadata(
    { params }: { params: { bookingId: string; providerId: string } }
): Promise<import('next').Metadata> {
    const admin = adminClient();
    const { data } = await admin
        .from('service_providers').select('business_name').eq('id', params.providerId).maybeSingle();
    return { title: (data && data.business_name) || 'Experience', robots: { index: false, follow: false } };
}

// A provider's listing, reached from inside a cottage booking: the stay supplies
// the guest, the dates and the address, so the booking panel is pre-filled and
// the whole page is gated on owning the booking. The public/standalone twin lives
// at /experiences/browse/[providerId] and shares the same body.
export default async function ListingPage(
    { params }: { params: { bookingId: string; providerId: string } }
) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/trips');

    const admin = adminClient();
    const mp = await loadMarketplace(admin, user.id, params.bookingId, guestExperiencesOpen());
    if (!mp.stay) redirect('/trips');
    const p = pickProvider(mp, params.providerId);
    if (!p) redirect(`/experiences/${params.bookingId}`);

    const who = p.byline || p.business_name;
    const reviews = await loadExperienceReviews(admin, p.id, user.id);

    return (
        <ExperienceListingBody
            p={p}
            backHref={`/experiences/${params.bookingId}`}
            backLabel="All experiences"
            reviews={reviews}
            panel={
                <BookingPanel
                    bookingId={params.bookingId}
                    checkIn={mp.stay.check_in}
                    checkOut={mp.stay.check_out}
                    cottageGuests={mp.stay.guests}
                    cottageAdults={mp.stay.adults}
                    cottageChildren={mp.stay.children}
                    stay={{ title: mp.listing?.title || null, town: mp.listing?.location || null }}
                    provider={{
                        id: p.id,
                        business_name: p.business_name,
                        who,
                        shape: p.shape,
                        fulfilment: p.fulfilment,
                        isFood: p.isFood,
                        items: p.items,
                        sessions: p.sessions,
                        declaredSessions: p.declaredSessions,
                        leadTimeDays: p.lead_time_days,
                        minPeople: p.minPeople,
                        slotCapacity: p.slotCapacity,
                        perItemDurations: p.perItemDurations,
                        turnaround: p.turnaround,
                        slotLength: p.slotLength,
                        slotAvailability: p.slotAvailability,
                        slotBlocks: p.slotBlocks,
                        partialBlocks: p.partialBlocks,
                        bookedBlocks: p.bookedBlocks,
                        cancellationHours: p.cancellation_window_hours,
                        noRefund: p.noRefund,
                        minAge: p.minAge,
                        offeredTimes: p.offeredTimes,
                        horizonDays: p.horizonDays,
                        maxGuests: p.maxGuests,
                    }}
                />
            }
        />
    );
}
