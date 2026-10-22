// Edge-cached (ISR). A published listing page is the same for everyone — the
// host block is public (first name only), reviews are public, and the booking
// card prices from public listing data — so it is served from Vercel's cache
// and rebuilt in the background. The per-viewer bits (the guest-terms tick, the
// host's inline review reply) are fetched on the client. Published ids are
// pre-rendered by generateStaticParams.
//
// Nothing on this route reads the session. A draft or pending listing is never
// rendered here: its cached copy is only a redirect to ./preview, a per-request
// route that checks the viewer is its owner, a co-host with listing access or an
// admin (HomeView, PUBLICLY_VISIBLE). A publish/edit/approve/hide/delete/
// calendar change refreshes the page on the spot via lib/revalidatePublic; 300s
// is the background fallback.
export const revalidate = 300;

import type { Metadata } from 'next';
import { adminClient } from '@/lib/supabaseAdmin';
import { formatPrice } from '@/lib/formatMoney';
import { shareImageUrl } from '@/lib/utils';
import { listingSeoTitle } from '@/lib/seoTitle';
import { describePlace } from '@/lib/propertyTypes';
import HomeView, { placeSummary, SITE_URL } from './HomeView';

// Pre-render every published listing at build so each is a static, edge-cached
// page from the first visit. A listing published after the build is not in this
// list; it renders on demand the first time it is opened and is cached from then
// (its render touches no per-request data), and a publish/edit also refreshes it
// via lib/revalidatePublic. A draft/pending/hidden id is not listed — a draft or
// pending one only ever caches the redirect to its preview route.
export async function generateStaticParams(): Promise<{ id: string }[]> {
    // The GitHub `test-and-build` check runs `next build` with no Supabase env,
    // so adminClient() would throw here and fail the build ("NEXT_PUBLIC_SUPABASE_URL
    // is not set"). Return [] when the env isn't there (or on any read error):
    // dynamicParams defaults true, so pages then render on demand and still cache
    // (ISR) — and the real deploy on Vercel HAS the env, so it pre-renders every
    // published listing as before.
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
    try {
        const { data } = await adminClient()
            .from('listings')
            .select('id')
            .eq('status', 'published');
        return (data || []).map((l: any) => ({ id: String(l.id) }));
    } catch {
        return [];
    }
}
// Per-listing page title and description. Without this every property
// shares one title and Google can't tell them apart — which is the
// single biggest thing holding back a site like this in search.
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
    // Cookieless (service role) so the metadata can be generated statically. It
    // reads any status; `indexable` below keeps a draft/hidden page out of the
    // index exactly as before.
    const { data: readable } = await adminClient()
        .from('listings')
        .select('title, description, location, images, price_per_night, max_guests, bedrooms, property_type, privacy_type, amenities, status')
        .eq('id', params.id)
        .maybeSingle();
    const home: typeof readable = readable;

    // The generic, reveals-nothing metadata. Used for a missing listing AND for
    // any status that isn't publicly visible, so a draft/pending link shared on
    // social carries no title, description, price or photo of the property.
    const notFoundMeta: Metadata = {
        title: 'Property not found',
        description: 'This listing is no longer available.',
        // The page itself 404s (or shows a "not published" notice). This stops
        // the "not found" wording being indexed in the window before Google
        // re-crawls.
        robots: { index: false, follow: false },
    };

    if (!home) {
        return notFoundMeta;
    }

    // Only a publicly visible listing gets real share tags. This mirrors
    // PUBLICLY_VISIBLE in the page below exactly: 'published' is indexed,
    // 'hidden' still opens at its own URL for a guest holding a booking or an
    // old link. Every other status — draft, pending_review, anything added
    // later — is not public, so its title, description, price and photo must
    // not leak into the <head> of a shared link. generateMetadata is cookieless
    // (so it can be built statically), which means it can't tell an owner
    // previewing from a stranger — so it reveals nothing to anyone, and the
    // owner's own preview still renders the full page via the gate below.
    if (home.status !== 'published' && home.status !== 'hidden') {
        return notFoundMeta;
    }

    const area = placeSummary(home.location) || 'Dumfries & Galloway';
    const town = area.split(',')[0].trim();
    const kind = describePlace(home.privacy_type, home.property_type).toLowerCase();

    // Built to match how people actually search: the place, then the town.
    // Kept to what Google shows without cutting it off — see lib/seoTitle.
    // Absolute, because the helper decides whether the brand fits.
    const title = { absolute: listingSeoTitle(home.title, town) };

    const amenities: string[] = home.amenities || [];
    const highlights: string[] = [];
    if (amenities.indexOf('Hot tub') !== -1) highlights.push('hot tub');
    if (amenities.indexOf('Pool') !== -1) highlights.push('pool');
    if (amenities.indexOf('Sauna') !== -1) highlights.push('sauna');
    if (amenities.indexOf('Pets allowed') !== -1) highlights.push('dog friendly');
    if (amenities.indexOf('Wifi') !== -1) highlights.push('wifi');
    const extras = highlights.length ? ` Features ${highlights.join(', ')}.` : '';

    const description =
        `${kind.charAt(0).toUpperCase()}${kind.slice(1)} in ${area}. ` +
        `Sleeps ${home.max_guests}, ${home.bedrooms} bedroom${home.bedrooms === 1 ? '' : 's'}, ` +
        `from ${formatPrice(home.price_per_night)} per night.${extras} ` +
        `Book direct with a local host.`;

    // The cover photo, resized to a 1200×630 JPEG the social scrapers will fetch
    // (see shareImageUrl). The logo is the fallback ONLY when there is no photo.
    const image = home.images && home.images.length > 0
        ? shareImageUrl(home.images[0])
        : `${SITE_URL}/images/og-default.jpg`;

    // Only a published listing belongs in the index. A hidden one is
    // deliberately off the home page and out of the sitemap, but it still
    // opens at its own URL for a guest holding a booking or an old link —
    // which is exactly the shape Google finds and indexes anyway unless it is
    // told not to. A draft or one waiting for review is not public at all.
    const indexable = home.status === 'published';

    return {
        title,
        description,
        alternates: { canonical: `/homes/${params.id}` },
        ...(indexable ? {} : { robots: { index: false, follow: false } }),
        openGraph: {
            type: 'website',
            locale: 'en_GB',
            url: `${SITE_URL}/homes/${params.id}`,
            siteName: 'Galloway Getaways',
            title: `${home.title} — from ${formatPrice(home.price_per_night)} per night`,
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

export default function ListingPage({ params }: { params: { id: string } }) {
    return <HomeView id={params.id} />;
}
