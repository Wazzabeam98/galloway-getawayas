// Edge-cached (ISR). The shop front is the same for everyone — every published
// listing (anon-readable columns), the towns row, the experiences shelf and the
// map — so it is served from Vercel's cache and rebuilt in the background. The
// two per-viewer things that used to force it dynamic now run on the client:
//
//   • the hero's search (where/when/who + the Filters panel) reads the URL in
//     components/HomeShop and narrows this same grid in the browser, posting to
//     /api/listings/search-availability for the one part — dated availability —
//     that can't run client-side; and
//   • the personal block (your upcoming trip, your next reservations, your
//     booked experiences) is fetched after load by components/HomePersonal, so
//     no viewer's details — and none of a confirmed stay's arrival secrets —
//     ever land in the cached HTML.
//
// A listing publish/edit/approve/hide/delete, an Arrange save or a calendar
// change refreshes this page on the spot via lib/revalidatePublic (tag 'home' /
// 'listings' and path '/'); 300s is the background fallback.
export const revalidate = 300;

import React, { Suspense } from 'react';
import { publicArea } from '@/lib/places';
import { getImageUrl } from '@/lib/utils';
import PriceMap from '@/components/PriceMap';
import Hero from '@/components/base/Hero';
import ComingSoonBanner from '@/components/base/ComingSoonBanner';
import { businessSignupsOpen } from '@/lib/serviceOrders';
import CohostInvites from '@/components/CohostInvites';
import HomePersonal from '@/components/HomePersonal';
import HomeShop from '@/components/HomeShop';
import { createClient } from '@supabase/supabase-js';
import Env from '@/config/Env';
import Link from 'next/link';
import ListingCard from '@/components/ListingCard';
import HomeExperiences, { liveHomeProviders, ExperiencesForBusinesses } from '@/components/HomeExperiences';
import TownsCarousel from '@/components/TownsCarousel';
import { AREAS, hasCopy, listingInArea } from '@/config/areas';
import { unstable_cache } from 'next/cache';
import fs from 'fs';
import path from 'path';
import { orderPublishedListings } from '@/lib/listingOrder';

// A town's carousel photo, or null if none has been dropped in yet. Checks the
// filesystem rather than trusting a list, so adding a photo is the only step
// needed to put a town on the home page. The extensions are tried in order and
// the first hit wins; the returned path is what the browser loads.
const TOWN_PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'avif'];
function townPhoto(slug: string): string | null {
    for (const ext of TOWN_PHOTO_EXTS) {
        const rel = '/images/towns/' + slug + '.' + ext;
        if (fs.existsSync(path.join(process.cwd(), 'public', rel))) return rel;
    }
    return null;
}

// What is in each town photograph, written for somebody who cannot see it —
// which also happens to be what Google Images indexes on. The town name is
// deliberately not the whole of it: the name is already the heading right below
// the picture, and repeating it adds nothing, whereas "ruined tower on an
// island, rowing boat, still water" is a description a search can match.
//
// Keyed by the same slug as the file, so a photo and its description are added
// together. A town whose photo has been dropped in without a line here still
// appears — it falls back to naming the town, which is the old behaviour and no
// worse than it was.
const TOWN_PHOTO_ALT: Record<string, string> = {
    kirkcudbright:
        "The roofless stone shell of MacLellan's Castle standing over the rooftops of "
        + 'whitewashed harbour houses, its empty windows and crow-stepped gables lit by low '
        + 'evening sun against a clear blue sky',
    'castle-douglas':
        'The ruined stone tower of Threave Castle on its island in the River Dee at sunrise, '
        + 'a white clinker-built rowing boat moored on water so still it mirrors the golden '
        + 'reed beds along the bank',
    'gatehouse-of-fleet':
        'The long three-storey grey stone mill at Gatehouse, rows of white sash windows under '
        + 'a slate roof, seen across the Water of Fleet through overhanging summer trees and '
        + 'reflected in the river',
    dalbeattie:
        'A gravel path curving away through tall moss-footed conifers in Dalbeattie forest, '
        + 'low sun throwing long shadows across fallen leaves, with a loch showing through the '
        + 'trunks ahead',
};

function townPhotoAlt(slug: string, name: string): string {
    return TOWN_PHOTO_ALT[slug] || name + ', Dumfries & Galloway';
}

// The title and description come from the root layout's defaults, which are
// written for this page. Only the canonical is here — it used to be on the
// layout, where every page without one of its own inherited it and claimed to
// be the home page. See the note in app/layout.tsx.
export const metadata = {
    alternates: { canonical: '/' },
    title: { absolute: 'Self-catering Accommodation in Dumfries & Galloway' },
    description:
        'Book self-catering holiday cottages and accommodation across Dumfries & Galloway. Book direct with the people who own them — no booking fee, ever.',
};

// Every published listing, from Next's data cache rather than the database on
// every visit. The list is the same for everyone (the anon read, published
// only), so it is fetched at most once every five minutes and served from the
// cache in between. A listing published or hidden now shows within five
// minutes, or at once via lib/revalidatePublic; availability for a dated search
// is read live by /api/listings/search-availability, never from the cache.
const cachedPublishedListings = unstable_cache(
    async (): Promise<any[]> => {
        const anon = createClient(Env.SUPABASE_URL, Env.SUPABASE_KEY);
        const { data, error } = await orderPublishedListings(
            anon
                .from('listings')
                .select('id, title, location, price_per_night, images, rating_avg, rating_count, max_guests, amenities, approx_latitude, approx_longitude, property_type, bedrooms, beds, bathrooms, max_pets, instant_book, check_in_method, display_order')
                .eq('status', 'published'),
        );
        // Thrown, so a failed read is never cached as "no listings".
        if (error) throw error;
        return data || [];
    },
    ['home-published-listings-v1'],
    { revalidate: 300, tags: ['home', 'listings'] },
);

async function publishedListings(): Promise<any[]> {
    try {
        return await cachedPublishedListings();
    } catch {
        return [];
    }
}

export default async function HomePage() {
    // All shared, public data — read once on the server and the same for
    // everyone, so this whole page prerenders and is served from the edge.
    const data = await publishedListings();
    const experiencesList = await liveHomeProviders();
    const experiencesLive = experiencesList.length > 0;

    // Which listings sit in each area, decided once by listingInArea() — the one
    // place that knows both rules: by town name, and (for Galloway Forest, a
    // region rather than a town) by the listing's own coordinates. The links and
    // the carousel below both read this, so they agree with each other and with
    // the sitemap.
    const allPublished = data || [];
    const listingsByArea = new Map<string, typeof allPublished>();
    for (const area of AREAS) {
        listingsByArea.set(area.slug, allPublished.filter((l) => listingInArea(area, l)));
    }
    const areaLinks = AREAS.filter(
        (area) => hasCopy(area) && (listingsByArea.get(area.slug)?.length ?? 0) > 0,
    );

    // The first real cottage photo in an area, built into a public URL the same
    // way the grid cards are. Used only as a fallback when there is no curated
    // town photo on disk.
    const firstAreaImage = (slug: string): string | null => {
        for (const l of listingsByArea.get(slug) || []) {
            const imgs = l.images;
            if (Array.isArray(imgs) && imgs.length > 0 && typeof imgs[0] === 'string' && imgs[0]) {
                return getImageUrl(imgs[0]);
            }
        }
        return null;
    };

    // The carousel shows a town only once it has a photo and a written blurb.
    // For the towns the photo is a curated image on disk; Galloway Forest, a
    // region not a town, borrows a real cottage's picture from a listing inside
    // the park, and stays off the row until a cottage appears.
    const carouselTowns = AREAS
        .filter((area) => (area.metaDescription || '').trim().length > 0)
        .map((area) => ({
            slug: area.slug,
            name: area.name,
            blurb: area.metaDescription,
            photo: townPhoto(area.slug) ?? firstAreaImage(area.slug),
            photoAlt: townPhotoAlt(area.slug, area.name),
        }))
        .filter((t): t is typeof t & { photo: string } => t.photo !== null);

    const mapPoints = (data || [])
        .filter((l: any) => l.approx_latitude != null && l.approx_longitude != null)
        .map((l: any) => ({
            id: l.id,
            title: l.title,
            price: l.price_per_night,
            image: l.images && l.images[0] ? getImageUrl(l.images[0]) : null,
            area: publicArea(l.location),
            lat: Number(l.approx_latitude),
            lng: Number(l.approx_longitude),
            href: `/homes/${l.id}`,
        }));

    // The browse-only sections, server-rendered once and handed to the shop:
    // live experiences straight under the grid, then the towns row, the
    // "offer an experience" panel and the map. HomeShop shows these only when
    // no search is on, exactly as the page did behind `!searching`.
    const browseSections = (
        <>
            {/* Live experiences sit straight under the properties, the second
                thing to book — every one of them, nothing when none are live. */}
            {experiencesLive && <HomeExperiences providers={experiencesList} />}

            <TownsCarousel towns={carouselTowns} />

            {/* The "offer an experience" panel for local businesses, below the
                towns row and above the map — always, live experiences or not. */}
            <ExperiencesForBusinesses />

            {/* Every live property on one map — Airbnb's search map. Below the
                towns carousel: the places to stay lead, the map is for somebody
                who wants to see where they all sit. Street-level approx points
                only, zoom capped. */}
            {mapPoints.length ? (
                <section className="mt-16 pt-10 border-t border-stone-200">
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900">Where our places are</h2>
                    <p className="text-stone-600 text-sm md:text-base mt-1 mb-6">
                        Every property, with its nightly price on the pin — tap one for the place.
                    </p>
                    <PriceMap points={mapPoints} frameClassName="h-[440px] md:h-[560px]" />
                </section>
            ) : null}
        </>
    );

    // The homepage's editorial, below the grid on purpose: the properties come
    // first, and someone who already knows they want to book does not have to
    // read past them. Always shown — never hidden behind a search.
    const editorial = (
        <section className="mt-16 pt-10 border-t border-stone-200">
            <div className="max-w-3xl space-y-12">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                        Book direct, and the money stays here
                    </h2>
                    <p className="text-stone-600 leading-relaxed mt-3">
                        Every place on Galloway Getaways is let by the person who owns it.
                        When you book, you are dealing with them — not an agency, and not a
                        call centre in another country. If you want to know whether the wood
                        burner is easy to light or where to park a van, you are asking
                        someone who knows.
                    </p>
                    <p className="text-stone-600 leading-relaxed mt-4">
                        We do not add a booking fee. The price you see is the price you pay,
                        and it goes to the owner minus a small commission that keeps the site
                        running. On a week away that is often the difference between one
                        platform and another, and it is the reason booking direct is nearly
                        always cheaper.
                    </p>

                    <h3 className="text-xl font-bold text-stone-900 mt-8">
                        Why we started this
                    </h3>
                    <p className="text-stone-600 leading-relaxed mt-3">
                        We were born and raised in Dumfries and Galloway, and we let places
                        here ourselves. The big platforms take a large share of every
                        booking, and the guest never finds out who owns the place they stayed
                        in. Our fees are about half, so more of it stays with the host and
                        with the region.
                    </p>
                    <p className="text-stone-600 leading-relaxed mt-4">
                        That’s the whole idea, and it goes further than the booking. A guest
                        can arrange a birthday cake, a chef or a day out, all from local
                        businesses on one site. A host can find a joiner who covers their
                        village at nine on a Sunday morning. This only works as a community
                        rather than a directory, and that’s how we intend to run it.
                    </p>
                </div>

                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                        A small corner of Scotland worth knowing
                    </h2>
                    <p className="text-stone-600 leading-relaxed mt-3">
                        Dumfries &amp; Galloway is the part of Scotland people drive past on
                        the way north, which is exactly why it is still quiet. Seventy miles
                        of coastline, forest, dark skies you can actually see stars in, and
                        towns like Kirkcudbright that have been artists’ colonies for a
                        century. It is two hours from Glasgow, two and a half from Carlisle,
                        and it does not feel like either.
                    </p>
                    <p className="text-stone-600 leading-relaxed mt-4">
                        The places we list sit in and around Kirkcudbright, the harbour town on the
                        Dee. Some take dogs. One has a hot tub. All of them are places we
                        would stay ourselves.
                    </p>
                </div>

                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                        More than a bed for the week
                    </h2>
                    <p className="text-stone-600 leading-relaxed mt-3">
                        Once you have booked, you can arrange the rest through us. A local
                        chef to cook dinner where you’re staying on your first night. A cake for
                        the birthday you are down for. The fridge filled before you arrive.
                        Someone to walk the dog while you are out for the day.
                    </p>
                    <p className="text-stone-600 leading-relaxed mt-4">
                        They are all local businesses we have checked, and you book them from
                        your trip page once your stay is confirmed. You pay them, not us — we
                        just make the introduction.
                    </p>
                </div>

                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                        Own a place to let in the region?
                    </h2>
                    <p className="text-stone-600 leading-relaxed mt-3">
                        If you let a property in Dumfries &amp; Galloway, you can list it
                        here. You set your own prices and your own rules, we handle the
                        booking and the payment, and you keep the relationship with your
                        guests. There is no monthly fee.
                    </p>
                    <p className="text-stone-600 leading-relaxed mt-4">
                        You also get a directory of local tradespeople who cover your
                        property — plumbers, joiners, electricians, cleaners — so when
                        something breaks on a changeover day you are not starting from a
                        search engine.
                    </p>
                </div>
            </div>
        </section>
    );

    // Browse by town. The only thing on the site that links to an area page, so
    // without it they are unreachable — for a guest and for a crawler. It is
    // below the grid on purpose, and is hidden while a search is on.
    const areaLinksNode = areaLinks.length > 0 ? (
        <section className="mt-16 pt-10 border-t border-stone-200">
            <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                Holiday cottages by town
            </h2>
            <p className="text-stone-600 text-sm md:text-base mt-1 mb-6">
                Pick a town and see what we have there.
            </p>
            <ul className="flex flex-wrap gap-3">
                {areaLinks.map((area) => (
                    <li key={area.slug}>
                        <Link
                            href={`/holiday-cottages/${area.slug}`}
                            className="inline-block rounded-full border border-stone-300 hover:border-stone-900 px-4 py-2 text-sm font-semibold text-stone-800 transition"
                        >
                            Holiday cottages in {area.name}
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    ) : null;

    // The no-search view, rendered on the server. This is what lands in the
    // cached HTML (the Suspense fallback below, shown while HomeShop reads the
    // URL on the client) — so every published listing, the browse sections, the
    // editorial and the crucial area links are all there for a crawler and for
    // the first paint, with no JavaScript. HomeShop takes over on hydration and
    // applies any search; with no search it renders this same view.
    const staticShop = (
        <>
            <div className="mb-10 border-b border-stone-200 pb-4">
                <h2 className="text-2xl md:text-3xl font-bold text-stone-900">Our Properties</h2>
                <p className="text-stone-600 text-sm md:text-base mt-1">
                    Handpicked self-catering accommodation in Dumfries &amp; Galloway
                </p>
            </div>

            {allPublished.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
                    {allPublished.map((property: any, i: number) => (
                        <ListingCard key={property.id} listing={property} priority={i < 4} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-stone-200">
                    <h3 className="text-lg font-semibold text-stone-800">
                        No properties listed yet
                    </h3>
                    <p className="text-stone-500 mt-1 max-w-md mx-auto">
                        Ready to list your Kirkcudbright holiday stay? Click <strong>Add homes</strong> in the top menu to publish your first property!
                    </p>
                </div>
            )}

            {browseSections}
            {editorial}
            {areaLinksNode}
        </>
    );

    return (
        <main className="min-h-screen bg-stone-50">
            {/* Opening soon: the one route in for hosts and trades while sign-up
          sits behind the coming-soon tiles. Above the hero, seen first. */}
            {!businessSignupsOpen() && <ComingSoonBanner />}

            {/* Kirkcudbright Hero Banner */}
            <Hero />

            {/* A co-host invitation waiting for whoever's signed in: in front of
          them, Accept or Decline, so it can't be missed if the email went to
          junk. Renders nothing otherwise, and fetches on the client so it
          stays out of the cached HTML. */}
            <CohostInvites className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8" />

            {/* Someone with a stay coming up sees it before anything else — or,
          in hosting mode, their next arrivals. Fetched on the client after
          load (components/HomePersonal), so no viewer's details and no stay's
          arrival secrets ever reach the cached HTML. */}
            <HomePersonal />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                {/* The property shop. The server render above (staticShop) is
                    the cached HTML and the first paint; HomeShop reads the URL
                    on the client and narrows the grid for a search. */}
                <Suspense fallback={staticShop}>
                    <HomeShop
                        listings={allPublished}
                        browseSections={browseSections}
                        editorial={editorial}
                        areaLinks={areaLinksNode}
                    />
                </Suspense>
            </div>
        </main>
    );
}
