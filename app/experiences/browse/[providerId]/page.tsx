// Edge-cached (ISR), like the cottage page (/homes/[id]) and the home page. A
// live experience's page is the same for everyone — the listing, its photos,
// prices, public reviews and the provider's first name — so it is served from
// Vercel's cache and rebuilt in the background. Nothing in this file reads the
// viewer: whether they're signed in, the provider's review-reply box, the
// viewer's own stays (the package notice) and the live calendar are fetched
// after load (components/marketplace/ExperienceViewer, /api/experiences/live/
// [providerId]), so no cached copy can ever carry one person's details.
//
// A provider that isn't approved yet is NEVER rendered here. Its cached copy is
// only a redirect to …/[providerId]/preview, a per-request route that checks the
// viewer is its owner or an admin before showing anything (and sends anyone else
// to browse). Reading the session here instead would make Next 13 fail the
// render ("changed from static to dynamic at runtime"), and would risk an
// owner's preview being cached for strangers.
//
// Every save that changes what this page shows — the editor, hours and day-offs,
// prices, approval, pause, take-down, reviews — refreshes it on the spot via
// lib/revalidatePublic; 300s is the background fallback.
export const revalidate = 300;

import { redirect } from 'next/navigation';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadLiveProvider, loadPausedProvider } from '@/lib/experiencesData';
import { loadExperienceReviews } from '@/lib/experienceReviews';
import { providerResponsiveness } from '@/lib/hostResponsiveness';
import { ExperiencePageView, PausedExperienceView } from '@/components/marketplace/ExperiencePageView';
import { getImageUrl } from '@/lib/utils';
import { guestCategory } from '@/lib/serviceProviders';
import type { MpProvider } from '@/lib/experiencesData';
import type { ExperienceReviewsBlock } from '@/lib/experienceReviews';

const SITE_URL = 'https://gallowaygetaways.co.uk';

// Structured data for an experience listing — the counterpart to the cottage
// page's VacationRental + Offer, so experiences can win the same price/rating
// rich results. Modelled as a Product, which is what the experiences platforms
// (GetYourGuide, Viator, Airbnb Experiences) mark a bookable thing-to-do up as:
// Event is for a single dated happening, and our slots are rolling, recurring
// availability rather than one concert on one night.
//
// The PRICE is the part that has to be honest. We publish an Offer price only
// when it is a FIXED price AND it is the very "from" figure the page already
// shows (p.priceFrom) — so the markup can never claim a number the page
// doesn't. A price-on-enquiry provider, and any provider whose cheapest option
// is a RANGE, carries NO price: the Product still earns a rating rich result,
// but we never advertise a price we can't hold the guest to. Pounds, as a
// number, exactly as the cottage Offer uses price_per_night.
// The search / social snippet for an experience — built from STRUCTURED facts
// (the name, its category and where it's based), never the provider's free-text
// description. The description field has turned out to hold arrival logistics
// ("We arrive an hour before to set up. We require parking close to the
// venue…") that read terribly as a search/share snippet and never say what the
// experience is. This keeps logistics out of every snippet (meta, OG, Twitter
// and JSON-LD) for every provider (audit 2026-10-21, F6). The provider's full
// free-text description still shows in the page body (ExperienceListingBody) —
// only the SNIPPET changed, not the page.
function experienceSnippet(name: string, category: string | null, basedLine: string | null): string {
    const what = (category || '').trim() || 'Local experience';
    const town = (basedLine || '').trim();
    const where = town && !/^travels\b/i.test(town) ? `${town}, Dumfries & Galloway` : 'Dumfries & Galloway';
    return `${name} — ${what} in ${where}. Book direct through Galloway Getaways, no booking fee.`;
}

function experienceJsonLd(p: MpProvider, reviews: ExperienceReviewsBlock, path: string): object[] {
    const url = SITE_URL + path;
    const image = (Array.isArray(p.photos) && p.photos[0])
        || (p.headshot ? getImageUrl(p.headshot) : null);

    const description = experienceSnippet(p.business_name, p.category, p.based_line);

    // The cheapest option — the same selection the loader uses for p.priceFrom,
    // so a published price equals the displayed "from". Every listed offering
    // has a fixed price.
    const priced = (p.items || []).filter((i) => i.price > 0);
    const cheapest = priced.length
        ? priced.reduce((a, b) => (b.price < a.price ? b : a))
        : null;
    const publishPrice = !!cheapest;

    const product: any = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.business_name,
        description,
        url,
        ...(image ? { image } : {}),
        ...(reviews && reviews.avg != null
            ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: reviews.avg, reviewCount: reviews.count } }
            : {}),
        ...(publishPrice
            ? {
                  offers: {
                      '@type': 'Offer',
                      price: p.priceFrom,
                      priceCurrency: 'GBP',
                      availability: 'https://schema.org/InStock',
                      url,
                      seller: { '@type': 'Organization', name: 'Galloway Getaways' },
                  },
              }
            : {}),
    };

    const breadcrumbs = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
            { '@type': 'ListItem', position: 2, name: 'Experiences', item: `${SITE_URL}/experiences/browse` },
            { '@type': 'ListItem', position: 3, name: p.business_name, item: url },
        ],
    };

    // The provider as a LocalBusiness — who runs this, where, and what they
    // offer. The Product above is the bookable thing and its price; this is
    // the business behind it, the shape Google's local results read (Airbnb
    // marks an experience's host the same way, as a business with a place).
    // Only what the page already shows publicly: the business name, the town
    // it is based in (never a street address — the venue is released on
    // booking), the region it serves, its photo and its rating on the same
    // rule as the Product (none until MIN_PUBLIC_REVIEWS).
    const town = (p.based_line || '').trim();
    const travels = !town || /^travels\b/i.test(town);
    const business: any = {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: p.business_name,
        description,
        url,
        ...(image ? { image } : {}),
        ...(!travels
            ? { address: { '@type': 'PostalAddress', addressLocality: town, addressRegion: 'Dumfries & Galloway', addressCountry: 'GB' } }
            : {}),
        areaServed: { '@type': 'AdministrativeArea', name: 'Dumfries & Galloway' },
        ...(p.priceFrom > 0 ? { priceRange: `From £${p.priceFrom}` } : {}),
        ...(reviews && reviews.avg != null
            ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: reviews.avg, reviewCount: reviews.count } }
            : {}),
        makesOffer: {
            '@type': 'Offer',
            itemOffered: { '@type': 'Service', name: p.business_name, serviceType: p.category },
            url,
        },
    };

    return [product, business, breadcrumbs];
}

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
        .select('business_name, based_line, trade, custom_label, stripe_mcc, guest_details, headshot, photos, status')
        .eq('id', params.providerId)
        .maybeSingle();

    // The generic, reveals-nothing metadata — for a missing provider AND for any
    // status that isn't publicly visible. generateMetadata is cookieless, so it
    // can't tell the owner previewing from a stranger; a not-yet-approved
    // provider's business name, like a draft cottage's title, must not leak into
    // the <head> of a shared link. The owner's own preview still renders the
    // full page via the gate below. A paused/admin-hidden provider keeps
    // status 'approved' (paused is a separate flag), so it keeps its share tags,
    // exactly as a hidden cottage does.
    if (!data || data.status !== 'approved') {
        return {
            title: 'Experience not found',
            description: 'This experience is no longer available.',
            robots: { index: false, follow: false },
        };
    }

    const name = data.business_name || 'Experience';
    // Built from structured facts (name + category + where), never the
    // provider's free-text description — same helper the JSON-LD uses, so the
    // snippet is identical everywhere and never carries arrival logistics (F6).
    const description = experienceSnippet(name, guestCategory(data), data.based_line);

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

// Pre-render every live experience at build so each is a static, edge-cached
// page from its first visit. One that goes live after the build renders on demand
// the first time it is opened and is cached from then (the approval also
// refreshes it). Not-yet-approved providers are never listed. The GitHub build
// check runs without Supabase env, so this returns [] there (pages then render on
// demand and still cache) — the same guard as the cottage page.
export async function generateStaticParams(): Promise<{ providerId: string }[]> {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
    if (!guestExperiencesOpen()) return [];
    try {
        const { data } = await adminClient()
            .from('service_providers')
            .select('id')
            .eq('audience', 'guest')
            .eq('status', 'approved')
            .eq('owner_paused', false)
            .is('admin_hidden_at', null);
        return (data || []).map((r: any) => ({ providerId: String(r.id) }));
    } catch {
        return [];
    }
}

// The PUBLIC (bookingless) listing — readable logged out. Same body as the
// against-a-stay listing, so the two read as one page. The booking column is the
// only difference: a slot experience gets the standalone booking box, a request
// shape the request panel, a made-to-order one the basket; each asks for an
// account only at checkout (components/marketplace/ExperiencePageView).
export default async function PublicListingPage({ params }: { params: { providerId: string } }) {
    const admin = adminClient();
    const open = guestExperiencesOpen();
    const p = await loadLiveProvider(admin, params.providerId, open);

    if (!p) {
        // Paused by its provider, or taken down by us: the old link still opens
        // the page, with the booking panel replaced — the same as a hidden cottage.
        const paused = await loadPausedProvider(admin, params.providerId, open);
        if (paused) {
            const pausedReviews = await loadExperienceReviews(admin, paused.id, null);
            return <PausedExperienceView p={paused} reviews={pausedReviews} />;
        }
        // Not approved yet: only its owner (or an admin reviewing it) may see it,
        // and only on the per-request preview route. This redirect is all that is
        // cached for it — no name, no photos, nothing about the provider.
        const { data: row } = await admin
            .from('service_providers')
            .select('status, audience')
            .eq('id', params.providerId)
            .maybeSingle();
        if (row && row.audience === 'guest' && row.status !== 'approved') {
            redirect(`/experiences/browse/${params.providerId}/preview`);
        }
        // Anything else not live goes back to browse.
        redirect('/experiences/browse');
    }

    const here = `/experiences/browse/${params.providerId}`;
    // Reviews with no viewer: the reply box is switched on after load for the
    // provider (ExperienceViewer → ProviderReplyBox).
    const reviews = await loadExperienceReviews(admin, p.id, null);
    // Response rate and typical reply time for the "Meet your host" card — the same
    // trust lines a cottage host gets, on the same rules (service role; a provider
    // is not a party on their own orders for the visitor's client). Counts their
    // booking requests answered by accepting or declining as well as message
    // replies. Passing it switches the body to the full MeetYourHost card.
    const responsiveness = await providerResponsiveness(admin, p.id, p.ownerId);

    // Product + LocalBusiness + BreadcrumbList structured data, on every live
    // page (made-to-order, slot, request, comes-to-you alike). Not on the paused
    // page above (not bookable, so no offer) nor on the owner's preview (an
    // unapproved page advertises nothing).
    const ldScripts = experienceJsonLd(p, reviews, here).map((obj, i) => (
        <script
            key={i}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(obj) }}
        />
    ));

    return <ExperiencePageView p={p} reviews={reviews} responsiveness={responsiveness} structuredData={ldScripts} />;
}
