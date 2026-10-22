import type { ReactNode } from 'react';
import ExperienceListingBody from '@/components/marketplace/ExperienceListingBody';
import { FoodCartProvider } from '@/components/marketplace/FoodCart';
import FoodMenu from '@/components/marketplace/FoodMenu';
import { RequestBookingProvider } from '@/components/marketplace/RequestBookingContext';
import ChooseMenu from '@/components/marketplace/ChooseMenu';
import NotTakingBookings from '@/components/NotTakingBookings';
import { EXPERIENCE_NOT_TAKING_BOOKINGS } from '@/lib/listingBookable';
import {
    ExperienceViewerProvider, LiveStandaloneBookingPanel, LiveBookingPanel, LiveFoodBasket,
    type ExperienceViewerState,
} from '@/components/marketplace/ExperienceViewer';
import type { MpProvider } from '@/lib/experiencesData';
import type { ExperienceReviewsBlock } from '@/lib/experienceReviews';
import type { providerResponsiveness } from '@/lib/hostResponsiveness';

// The experience page itself — shared by the edge-cached public page
// (app/experiences/browse/[providerId]/page.tsx) and the per-request owner/admin
// preview (…/[providerId]/preview/page.tsx), so the two can't drift apart.
//
// Nothing here reads the viewer. Whatever depends on who is looking (signed in,
// the reply box, their own stays) and the live calendar come from
// ExperienceViewerProvider after load — or, on the preview route, from `viewer`,
// which that route has already worked out on the server.

export function ExperiencePageView({ p, reviews, responsiveness, banner, preview, viewer, structuredData }: {
    p: MpProvider;
    reviews: ExperienceReviewsBlock;
    responsiveness: Awaited<ReturnType<typeof providerResponsiveness>>;
    banner?: ReactNode;
    // An owner/admin preview of a not-yet-live provider: no report link.
    preview?: boolean;
    viewer?: ExperienceViewerState;
    structuredData?: ReactNode;
}) {
    const who = p.byline || p.business_name;
    const here = `/experiences/browse/${p.id}`;

    // A made-to-order listing reads like a food-ordering site: the MENU leads the
    // page (photos, prices) and the sidebar is a BASKET, both sharing one cart.
    if (p.shape === 'made_to_order') {
        return (
            <ExperienceViewerProvider providerId={p.id} initial={viewer}>
            {structuredData}
            {/* Only fixed-price offerings go in the orderable menu; a range or
                price-on-enquiry item is reached through "Message the provider"
                in the listing body (and refused server-side anyway). */}
            <FoodCartProvider items={p.items}>
                <ExperienceListingBody
                    banner={banner}
                    p={p}
                    backHref="/experiences/browse"
                    backLabel="All experiences"
                    reviews={reviews}
                    sticky
                    responsiveness={responsiveness}
                    reportable={!preview}
                    menu={<FoodMenu leadTimeDays={p.lead_time_days} />}
                    panel={<LiveFoodBasket who={who} isFood={p.isFood} fulfilment={p.fulfilment} deliveryFee={p.deliveryFee} standalone providerId={p.id} leadTimeDays={p.lead_time_days} horizonDays={p.horizonDays} cancellationHours={p.cancellation_window_hours} noRefund={p.noRefund} slotBlocks={p.slotBlocks} />}
                />
            </FoodCartProvider>
            </ExperienceViewerProvider>
        );
    }

    const panel = p.shape === 'slot' ? (
        <LiveStandaloneBookingPanel
            signInNext={here}
            provider={{
                id: p.id, who, shape: p.shape, fulfilment: p.fulfilment, isFood: p.isFood,
                slotCapacity: p.slotCapacity, minPeople: p.minPeople, slotLength: p.slotLength,
                items: p.items, sessions: p.sessions, declaredSessions: p.declaredSessions,
                cancellationHours: p.cancellation_window_hours, noRefund: p.noRefund,
                minAge: p.minAge, everScheduled: p.everScheduled,
            }}
        />
    ) : (
        // A request shape (chef / made-to-order baker), booked standalone — no stay
        // needed. The guest picks a date and, if the provider offers them, a time;
        // a travelling shape asks for an address. The card is held, not charged,
        // until the provider confirms.
        <LiveBookingPanel
            standalone
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
            banner={banner}
            p={p}
            backHref="/experiences/browse"
            backLabel="All experiences"
            panel={panel}
            sticky
            responsiveness={responsiveness}
            reportable={!preview}
            itemsMenu={isComesToYou ? <ChooseMenu items={p.items} minAge={p.minAge} providerMax={p.maxGuests} /> : undefined}
            reviews={reviews}
        />
    );

    return (
        <ExperienceViewerProvider providerId={p.id} initial={viewer}>
            {structuredData}
            {isComesToYou ? <RequestBookingProvider>{body}</RequestBookingProvider> : body}
        </ExperienceViewerProvider>
    );
}

// Paused by its provider or taken down by us: the old link still opens the page,
// with the panel replaced — the same as a hidden cottage. Static "What you get"
// list instead of the interactive menu (no basket, no option picker), so nothing
// on the page starts a booking. Wrapped in the viewer provider only so the
// provider still gets the reply box under their reviews.
export function PausedExperienceView({ p, reviews }: { p: MpProvider; reviews: ExperienceReviewsBlock }) {
    return (
        <ExperienceViewerProvider providerId={p.id}>
            <ExperienceListingBody
                p={p}
                backHref="/experiences/browse"
                backLabel="All experiences"
                reviews={reviews}
                reportable
                panel={<NotTakingBookings message={EXPERIENCE_NOT_TAKING_BOOKINGS} />}
            />
        </ExperienceViewerProvider>
    );
}
