import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadPublicMarketplace, loadPausedProvider, pickProvider } from '@/lib/experiencesData';
import NotTakingBookings from '@/components/NotTakingBookings';
import { EXPERIENCE_NOT_TAKING_BOOKINGS } from '@/lib/listingBookable';
import { loadExperienceReviews } from '@/lib/experienceReviews';
import { providerResponsiveness } from '@/lib/hostResponsiveness';
import ExperienceListingBody from '@/components/marketplace/ExperienceListingBody';
import StandaloneBookingPanel from '@/components/marketplace/StandaloneBookingPanel';
import BookingPanel from '@/components/marketplace/BookingPanel';
import { FoodCartProvider } from '@/components/marketplace/FoodCart';
import FoodMenu from '@/components/marketplace/FoodMenu';
import FoodBasket from '@/components/marketplace/FoodBasket';
import { RequestBookingProvider } from '@/components/marketplace/RequestBookingContext';
import ChooseMenu from '@/components/marketplace/ChooseMenu';
import { PackageStaysProvider } from '@/components/marketplace/PackageNotice';
import { loadStayWindows } from '@/lib/packageNotice';
import { londonDayKey } from '@/lib/dayKey';
import { getImageUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// The browser tab carries the provider's name — "Loch Sauna | Galloway Getaways"
// (the root layout appends the suffix, so the title here is the bare name).
//
// Description, canonical and the social image are set here too. Without them
// this public listing inherited the root layout's home-page description ("Book
// holiday cottages and accommodation…") — wrong for an experience — and had no
// canonical of its own. Kept to one light query on the row the page shows.
export async function generateMetadata(
    { params }: { params: { providerId: string } }
): Promise<import('next').Metadata> {
    const admin = adminClient();
    const { data } = await admin
        .from('service_providers')
        .select('business_name, based_line, description, headshot, photos')
        .eq('id', params.providerId)
        .maybeSingle();

    if (!data) return { title: 'Experience' };

    const name = data.business_name || 'Experience';
    const where = data.based_line ? `${data.based_line}, ` : '';
    // The provider's own blurb, collapsed to one line and clamped, else a
    // sensible default that still says what and where.
    const raw = (data.description || '').replace(/\s+/g, ' ').trim();
    const description = raw
        ? (raw.length > 155 ? raw.slice(0, 152).trimEnd() + '…' : raw)
        : `${name} — a local experience in ${where}Dumfries & Galloway. Booked and paid securely through Galloway Getaways.`;

    const key = (Array.isArray(data.photos) && data.photos[0]) || data.headshot;
    const image = key ? getImageUrl(key) : undefined;

    return {
        title: name,
        description,
        alternates: { canonical: `/experiences/browse/${params.providerId}` },
        openGraph: {
            type: 'website',
            locale: 'en_GB',
            url: `/experiences/browse/${params.providerId}`,
            siteName: 'Galloway Getaways',
            title: name,
            description,
            ...(image ? { images: [{ url: image, alt: name }] } : {}),
        },
        twitter: {
            card: 'summary_large_image',
            title: name,
            description,
            ...(image ? { images: [image] } : {}),
        },
    };
}

// The PUBLIC (bookingless) listing — readable logged out. Same body as the
// against-a-stay listing, so the two read as one page. The booking column is the
// only difference: a slot experience gets the standalone booking box (which
// prompts sign-in when logged out); a request shape (a chef, a made-to-order
// baker) is browsable but not standalone-bookable yet, so it says so honestly and
// points at booking it with a cottage stay — never a checkout that fails.
export default async function PublicListingPage({ params }: { params: { providerId: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    const admin = adminClient();
    const mp = await loadPublicMarketplace(admin, guestExperiencesOpen());
    const p = pickProvider(mp, params.providerId);
    if (!p) {
        // Paused by its provider: the old link still opens the page, with the
        // panel replaced — the same as a hidden cottage. Static "What you get"
        // list instead of the interactive menu (no basket, no option picker),
        // so nothing on the page starts a booking. Anything else not live still
        // goes back to browse.
        const paused = await loadPausedProvider(admin, params.providerId, guestExperiencesOpen());
        if (!paused) redirect('/experiences/browse');
        const pausedReviews = await loadExperienceReviews(admin, paused.id, user?.id ?? null);
        return (
            <ExperienceListingBody
                p={paused}
                backHref="/experiences/browse"
                backLabel="All experiences"
                reviews={pausedReviews}
                reportable
                panel={<NotTakingBookings message={EXPERIENCE_NOT_TAKING_BOOKINGS} />}
            />
        );
    }

    const who = p.byline || p.business_name;
    const here = `/experiences/browse/${params.providerId}`;
    const reviews = await loadExperienceReviews(admin, p.id, user?.id ?? null);
    // Response rate and typical reply time for the "Meet your host" card — the same
    // trust lines a cottage host gets, on the same rules (service role; a provider
    // is not a party on their own orders for the visitor's client). Counts their
    // booking requests answered by accepting or declining as well as message
    // replies. Passing it switches the body to the full MeetYourHost card.
    const responsiveness = await providerResponsiveness(admin, p.id, p.ownerId);
    // The guest's own confirmed, paid stays, as dates only — the checkout draws
    // the package notice when the picked day falls inside one (lib/packageNotice).
    const packageStays = await loadStayWindows(admin, user?.id, londonDayKey());

    // A made-to-order listing reads like a food-ordering site: the MENU leads the
    // page (photos, prices) and the sidebar is a BASKET, both sharing one cart.
    if (p.shape === 'made_to_order') {
        return (
            <PackageStaysProvider stays={packageStays}>
            {/* Only fixed-price offerings go in the orderable menu; a range or
                price-on-enquiry item is reached through "Message the provider"
                in the listing body (and refused server-side anyway). */}
            <FoodCartProvider items={p.items.filter((i) => (i.priceMode || 'fixed') === 'fixed')}>
                <ExperienceListingBody
                    p={p}
                    backHref="/experiences/browse"
                    backLabel="All experiences"
                    reviews={reviews}
                    sticky
                    responsiveness={responsiveness}
                    reportable
                    menu={<FoodMenu leadTimeDays={p.lead_time_days} />}
                    panel={<FoodBasket who={who} isFood={p.isFood} fulfilment={p.fulfilment} deliveryFee={p.deliveryFee} standalone providerId={p.id} signedIn={!!user} leadTimeDays={p.lead_time_days} horizonDays={p.horizonDays} cancellationHours={p.cancellation_window_hours} noRefund={p.noRefund} />}
                />
            </FoodCartProvider>
            </PackageStaysProvider>
        );
    }

    const panel = p.shape === 'slot' ? (
        <StandaloneBookingPanel
            signedIn={!!user}
            signInNext={here}
            provider={{
                id: p.id, who, shape: p.shape, fulfilment: p.fulfilment, isFood: p.isFood,
                slotCapacity: p.slotCapacity, minPeople: p.minPeople, slotLength: p.slotLength,
                items: p.items, sessions: p.sessions, declaredSessions: p.declaredSessions,
                cancellationHours: p.cancellation_window_hours, noRefund: p.noRefund,
                minAge: p.minAge,
            }}
        />
    ) : (
        // A request shape (chef / made-to-order baker), booked standalone — no stay
        // needed. The guest picks a date and, if the provider offers them, a time;
        // a travelling shape asks for an address. The card is held, not charged,
        // until the provider confirms.
        <BookingPanel
            standalone
            signedIn={!!user}
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
                slotAvailability: p.slotAvailability,
                slotBlocks: p.slotBlocks,
                partialBlocks: p.partialBlocks,
                bookedDates: p.bookedDates,
                cancellationHours: p.cancellation_window_hours,
                noRefund: p.noRefund,
                minAge: p.minAge,
                offeredTimes: p.offeredTimes,
                horizonDays: p.horizonDays,
                maxGuests: p.maxGuests,
            }}
        />
    );

    // A comes-to-you experience: choose the option on the listing (ChooseMenu),
    // which opens the panel's dialog on it — wrap the page in the provider that
    // connects the two.
    const isComesToYou = p.shape === 'comes_to_you';
    const body = (
        <ExperienceListingBody
            p={p}
            backHref="/experiences/browse"
            backLabel="All experiences"
            panel={panel}
            sticky
            responsiveness={responsiveness}
            reportable
            itemsMenu={isComesToYou ? <ChooseMenu items={p.items} minAge={p.minAge} providerMax={p.maxGuests} providerId={p.id} providerName={p.business_name} /> : undefined}
            reviews={reviews}
        />
    );

    return (
        <PackageStaysProvider stays={packageStays}>
            {isComesToYou ? <RequestBookingProvider>{body}</RequestBookingProvider> : body}
        </PackageStaysProvider>
    );
}
