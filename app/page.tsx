import HostReservations from '@/components/HostReservations';
import { townKey, publicArea } from '@/lib/places';
import { getImageUrl } from '@/lib/utils';
import PriceMap from '@/components/PriceMap';
import { icalBlockedListingIds } from '@/lib/availability';
import Hero from '@/components/base/Hero';
import ComingSoonBanner from '@/components/base/ComingSoonBanner';
import { businessSignupsOpen } from '@/lib/serviceOrders';
import UpcomingTrip from '@/components/UpcomingTrip';
import UpcomingExperience, { type Upcoming } from '@/components/UpcomingExperience';
import { guestExperienceLists } from '@/lib/guestExperienceLists';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { format, parseISO } from 'date-fns';
import Link from 'next/link';
import ListingCard from '@/components/ListingCard';
import PropertyFilters from '@/components/PropertyFilters';
import { readFilters, matchesFilters, activeFilterCount, propertyTypeLabel, QUICK_CHIPS, type FilterFacts } from '@/lib/listingFilters';
import { isSelfCheckIn } from '@/lib/checkInMethods';
import HomeExperiences, { liveHomeProviders, ExperiencesForBusinesses } from '@/components/HomeExperiences';
import TownsCarousel from '@/components/TownsCarousel';
import { AREAS, hasCopy } from '@/config/areas';
import fs from 'fs';
import path from 'path';
import { resolveWorkMode } from '@/lib/workMode';
import { readWorkSide } from '@/lib/workSide';

export const dynamic = 'force-dynamic';

// A town's carousel photo, or null if none has been dropped in yet. Checks the
// filesystem at request time rather than trusting a list, so adding a photo is
// the only step needed to put a town on the home page. The extensions are tried
// in order and the first hit wins; the returned path is what the browser loads.
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
    // The home page's own search description, so "self-catering" stays in
    // front of search engines now the hero headline no longer says it. Set
    // here rather than in the layout, whose description every page without
    // one inherits.
    // The home page's own title (browser tab and search result). `absolute`
    // so the layout's " | Galloway Getaways" template isn't added.
    title: { absolute: 'Self-catering Accommodation in Dumfries & Galloway' },
    description:
        'Book self-catering holiday cottages and accommodation across Dumfries & Galloway. Book direct with the people who own them — no booking fee, ever.',
};

// The `where` slug the hero sends is the town with its spaces turned into
// hyphens, which is exactly what townKey() produces once the hyphens come back
// out. Reusing townKey means the search agrees with the passport about what
// counts as the same town, however the host happened to type the address.
function whereLabel(slug: string): string {
    const small = ['of', 'and', 'the'];
    return slug
        .split('-')
        .map((word, i) =>
            i > 0 && small.includes(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
        )
        .join(' ');
}

function readParam(value: string | string[] | undefined): string {
    return typeof value === 'string' ? value : '';
}

export default async function HomePage({
    searchParams,
}: {
    searchParams: { [key: string]: string | string[] | undefined };
}) {
    const cookieStore = cookies();
    const supabase = createServerComponentClient({ cookies });

    // Same rule the navbar reads, so the page agrees with the mode switch: the
    // side they were last on, or — never having chosen — hosting for an
    // approved host or provider and travelling for everyone else (lib/workMode).
    const { data: { user: viewer } } = await supabase.auth.getUser();
    const mode = resolveWorkMode(cookieStore.get('gg_mode')?.value, await readWorkSide(supabase, viewer?.id));

    // What the hero's search button put in the URL. Every part is optional —
    // a bare `/` still means "show me everything".
    const where = readParam(searchParams.where);
    const from = readParam(searchParams.from);
    const to = readParam(searchParams.to);
    const guests = Number(readParam(searchParams.guests)) || 0;
    // The Filters panel and its chips (lib/listingFilters) — the hero's pets=1
    // is read as the "Pets allowed" amenity, so the two agree.
    const filters = readFilters(searchParams);
    const filterCount = activeFilterCount(filters);
    const wantsPets = filters.amenities.indexOf('Pets allowed') !== -1;

    // Only trust a date pair that is actually a stay.
    const hasDates = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from < to;
    const searching = Boolean(where) || hasDates || guests > 0 || filterCount > 0;

    let query = supabase
        .from('listings')
        .select('id, title, location, price_per_night, images, rating_avg, rating_count, max_guests, amenities, approx_latitude, approx_longitude, property_type, bedrooms, beds, bathrooms, instant_book, check_in_method')
        .eq('status', 'published')
        .order('created_at', { ascending: false });

    if (guests > 0) query = query.gte('max_guests', guests);
    // Pets are an amenity rather than a column of their own, and are matched
    // with the other filters below rather than here — the panel's count needs
    // the places WITHOUT pets too, to say what turning it off would give.

    // The signed-in guest's booked experiences still to come, read here so the
    // card is in the first paint — the same lister the to-review endpoint uses,
    // with the user identified by this page's own (server component) client.
    // Nothing for a signed-out visitor or in hosting mode.
    const upcomingExperiences: Promise<Upcoming[]> = mode === 'host'
        ? Promise.resolve([])
        : (viewer ? guestExperienceLists(viewer.id) : Promise.resolve({ upcoming: [] as any[] }))
            .then((d: any) => (d && d.upcoming) || [])
            .catch(() => []);

    const { data } = await query;
    let listings = data || [];

    if (where) {
        const wanted = where.replace(/[^a-z]/g, '');
        listings = listings.filter((l) => townKey(l.location) === wanted);
    }

    if (hasDates && listings.length > 0) {
        const ids = listings.map((l) => l.id);

        // A booking [check_in, check_out) clashes with the wanted stay
        // [from, to) exactly when it starts before the stay ends and ends
        // after the stay starts.
        const { data: clashing } = await supabase
            // Busy nights, not bookings. See
            // 20260828231530_bookings_are_not_public.sql.
            .from('listing_busy_nights')
            .select('listing_id')
            .in('listing_id', ids)
            .in('status', ['pending', 'confirmed'])
            .lt('check_in', to)
            .gt('check_out', from);

        const { data: blocked } = await supabase
            .from('calendar_overrides')
            .select('listing_id')
            .in('listing_id', ids)
            .eq('is_blocked', true)
            .gte('date', from)
            .lt('date', to);

        // The third source: dates taken on Airbnb, Booking.com and anything
        // else the host syncs. Those are cached in the database by the
        // three-hourly sync job, so this is a read rather than a trip out to
        // another website.
        //
        // Ids in, ids out. The events stay inside that call — some platforms
        // put a guest name or a reservation link in an event, and this page
        // renders for the public.
        const icalBlocked = await icalBlockedListingIds(ids, from, to);

        const unavailable = new Set<string>([
            ...(clashing || []).map((b) => b.listing_id),
            ...(blocked || []).map((b) => b.listing_id),
            ...Array.from(icalBlocked),
        ]);

        listings = listings.filter((l) => !unavailable.has(l.id));
    }

    // The filters, last: `pool` is everything that matches where/when/who, and
    // is what the panel counts against, so its "Show N places" is exactly the
    // grid you get. Same rule (lib/listingFilters) here and in the browser.
    const factsOf = (l: any): FilterFacts => ({
        amenities: l.amenities,
        property_type: l.property_type,
        price_per_night: l.price_per_night,
        bedrooms: l.bedrooms,
        beds: l.beds,
        bathrooms: l.bathrooms,
        instant_book: l.instant_book,
        self_check_in: isSelfCheckIn(l.check_in_method),
    });
    const pool = listings.map(factsOf);
    listings = listings.filter((l) => matchesFilters(factsOf(l), filters));

    // Which area pages to offer. Same two conditions the sitemap uses: the
    // page has been written, and there is at least one property in it. An
    // unwritten area page is noindex, so linking to it from the busiest page
    // on the site would be pointing Google at a dead end.
    //
    // Counted from `data` — every published listing — rather than from
    // `listings`, which has the current search applied to it. The area links
    // are navigation, not results, and must not vanish because somebody
    // searched for two guests in March.
    const townCounts: Record<string, number> = {};
    for (const listing of data || []) {
        const key = townKey(listing.location);
        townCounts[key] = (townCounts[key] || 0) + 1;
    }
    const areaLinks = AREAS.filter(
        (area) => hasCopy(area) && area.townKeys.some((key) => (townCounts[key] || 0) > 0)
    );

    // The carousel shows a town only once it has a photo. A written blurb is
    // still required — the panel leads to the area page and needs something to
    // say — but the gate is the image on disk, not a list kept here: drop
    // public/images/towns/<slug>.jpg (or .jpeg/.png/.webp/.avif) in and the
    // town appears on the next request, with no code change. Resolving the file
    // server-side also settles the exact path, so the panel renders a photo we
    // know exists rather than guessing an extension and falling back to grey.
    const carouselTowns = AREAS
        .filter((area) => (area.metaDescription || '').trim().length > 0)
        .map((area) => ({
            slug: area.slug,
            name: area.name,
            blurb: area.metaDescription,
            photo: townPhoto(area.slug),
            photoAlt: townPhotoAlt(area.slug, area.name),
        }))
        .filter((t): t is typeof t & { photo: string } => t.photo !== null);

    // Experiences placement depends on whether the shelf is live. Loaded once
    // here and used both to decide the layout and (for the live state) to render
    // the cards, so the marketplace is read once. Live → the cards sit under Our
    // Properties; empty → the coming-soon panel drops down between the towns row
    // and the map instead, so an empty section never leads. Hidden while a
    // property search is on, like the sections below.
    const homeExperienceList = searching ? [] : await liveHomeProviders();
    const experiencesLive = homeExperienceList.length > 0;

    // What the guest asked for, said back to them, so a short list reads as a
    // result rather than as an empty site.
    const criteria: string[] = [];
    if (where) criteria.push(whereLabel(where));
    if (hasDates) {
        criteria.push(`${format(parseISO(from), 'd MMM')} – ${format(parseISO(to), 'd MMM')}`);
    }
    if (guests > 0) criteria.push(`${guests} guest${guests > 1 ? 's' : ''}`);
    if (wantsPets) criteria.push('pets welcome');
    // Amenities and types by name (a chip's own label where it has one); the
    // rest — price, rooms, booking options — as a count.
    filters.amenities
        .filter((a) => a !== 'Pets allowed')
        .forEach((a) => criteria.push((QUICK_CHIPS.find((c) => c.amenity === a) || { label: a }).label.toLowerCase()));
    filters.types.forEach((t) => criteria.push(propertyTypeLabel(t) || t));
    if (filters.minPrice != null || filters.maxPrice != null) {
        criteria.push(
            filters.maxPrice == null ? `from £${filters.minPrice}`
                : filters.minPrice == null ? `up to £${filters.maxPrice}`
                    : `£${filters.minPrice}–£${filters.maxPrice}`,
        );
    }
    if (filters.bedrooms) criteria.push(`${filters.bedrooms}+ bedroom${filters.bedrooms > 1 ? 's' : ''}`);
    if (filters.beds) criteria.push(`${filters.beds}+ bed${filters.beds > 1 ? 's' : ''}`);
    if (filters.bathrooms) criteria.push(`${filters.bathrooms}+ bathroom${filters.bathrooms > 1 ? 's' : ''}`);
    if (filters.instantBook) criteria.push('Instant Book');
    if (filters.selfCheckIn) criteria.push('self check-in');

    return (
        <main className="min-h-screen bg-stone-50">
            {/* Opening soon: the one route in for hosts and trades while sign-up
          sits behind the coming-soon tiles. Above the hero, seen first. Follows
          the same switch as the /business tiles, so it goes the moment they open. */}
            {!businessSignupsOpen() && <ComingSoonBanner />}

            {/* Kirkcudbright Hero Banner */}
            <Hero />

            {/* Someone with a stay coming up sees it before anything else. Returns
          nothing at all for a signed-out visitor or a guest with no booking.
          In hosting mode the same slot shows the next arrivals instead. */}
            {mode === 'host' ? <HostReservations /> : (
                <>
                    {/* The stay leads (it's the anchor of the holiday); a booked
                        experience gets its own peer card below. Each self-gates and
                        renders nothing when there's none — no empty shelf. */}
                    <UpcomingTrip />
                    <UpcomingExperience list={await upcomingExperiences} />
                </>
            )}

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                {/* Section Heading */}
                <div className="mb-10 border-b border-stone-200 pb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                            {searching ? 'Stays that match' : 'Our Properties'}
                        </h2>
                        <p className="text-stone-600 text-sm md:text-base mt-1">
                            {searching
                                ? criteria.join(' · ')
                                : 'Handpicked self-catering accommodation in Dumfries & Galloway'}
                        </p>
                    </div>
                    {searching && (
                        <Link
                            href="/"
                            className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-4"
                        >
                            Clear search
                        </Link>
                    )}
                </div>

                {/* Airbnb's Filters button and one-tap chips, over the grid. */}
                <PropertyFilters pool={pool} />

                {/* Property Grid */}
                {listings && listings.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
                        {listings.map((property) => (
                            <ListingCard key={property.id} listing={property} />
                        ))}
                    </div>
                ) : searching ? (
                    /* A search that found nothing is not an empty site, and must not
                       be described as one. */
                    <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-stone-200">
                        <h3 className="text-lg font-semibold text-stone-800">
                            No stays match that search
                        </h3>
                        <p className="text-stone-500 mt-1 max-w-md mx-auto">
                            {hasDates
                                ? <>Nothing is free for {criteria.join(' · ')}. Try different dates, or a wider area.</>
                                : <>Nothing matches {criteria.join(' · ')} yet. Try removing a filter.</>}
                        </p>
                        <Link
                            href="/"
                            className="inline-block mt-5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-full px-6 py-2.5 transition"
                        >
                            Show all properties
                        </Link>
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

                {/* Live experiences sit straight under the properties, the second
                    thing to book — every one of them, nothing when none are live.
                    Hidden while a property search is on, like the sections below. */}
                {!searching && experiencesLive && <HomeExperiences providers={homeExperienceList} />}

                {!searching && <TownsCarousel towns={carouselTowns} />}

                {/* The "offer an experience" panel for local businesses, below the
                    towns row and above the map — always, live experiences or not. */}
                {!searching && <ExperiencesForBusinesses />}

                {/* Every live property on one map — Airbnb's search map. Below
                    the towns carousel: the places to stay lead, the map is for
                    somebody who wants to see where they all sit. A white price
                    pin each, a mini card on tap that links to the listing.
                    Street-level approx points only, zoom capped. */}
                {!searching && (() => {
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
                    return mapPoints.length ? (
                        <section className="mt-16 pt-10 border-t border-stone-200">
                            <h2 className="text-2xl md:text-3xl font-bold text-stone-900">Where our places are</h2>
                            <p className="text-stone-600 text-sm md:text-base mt-1 mb-6">
                                Every property, with its nightly price on the pin — tap one for the place.
                            </p>
                            <PriceMap points={mapPoints} frameClassName="h-[440px] md:h-[560px]" />
                        </section>
                    ) : null;
                })()}

                {/* The homepage's editorial, below the grid on purpose: the
                    properties come first, and someone who already knows they
                    want to book does not have to read past them. Four sections,
                    real h2s so the page has a structure and not just big text. */}
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

                            {/* The owner's own founding lines, a subsection of the
                                booking-direct point rather than a fifth heading —
                                so it is an h3 under the h2, and the page's
                                structure stays real. */}
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

                {/* Browse by town.
                    
                    This is the only thing on the site that links to an area
                    page, so without it they are unreachable — for a guest and
                    for a crawler. It is below the grid on purpose: somebody who
                    already knows where they want to be scrolls to it, and
                    everybody else sees the properties first.
                    
                    Empty until an area page has been written AND has a property
                    in it, so it does not appear at all before then. */}
                {areaLinks.length > 0 && !searching && (
                    <section className="mt-16 pt-10 border-t border-stone-200">
                        {/* Not the carousel's heading again — the carousel
                            above already says "Where to stay…", and two h2s
                            with one name read as a page repeating itself. */}
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
                )}
            </div>
        </main>
    );
}
