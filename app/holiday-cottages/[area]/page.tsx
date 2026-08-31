export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { MapPin } from 'lucide-react';
import ListingCard, { type CardListing } from '@/components/ListingCard';
import { townKey } from '@/lib/places';
import { AREAS, areaBySlug, hasCopy, type Area } from '@/config/areas';

const SITE_URL = 'https://gallowaygetaways.co.uk';

// An area landing page: /holiday-cottages/kirkcudbright
//
// The copy lives in config/areas.ts and is deliberately empty until somebody
// writes it. An area with no copy still RENDERS — you can look at it, and the
// properties in it are real — but it is noindex and it is not in the sitemap.
// See the note on isPublishable() for why a thin generated page is worse than
// no page at all.
//
// Everything on this page other than the copy comes from data that already
// exists: the properties are matched to the area by townKey(), the same
// function the home page search uses.

async function listingsForArea(area: Area): Promise<CardListing[]> {
    const supabase = createServerComponentClient({ cookies });

    // Named columns, not a star. This page is read by strangers, so it runs as
    // `anon`, which no longer holds a table-level grant on listings — a
    // select('*') is refused outright, and tests/no-star-select-on-listings
    // fails the build for one. Same list the home page grid asks for.
    const { data } = await supabase
        .from('listings')
        .select('id, title, location, price_per_night, images, rating_avg, rating_count, amenities')
        .eq('status', 'published')
        .order('created_at', { ascending: false });

    // Matched in code rather than in the query because `location` is a free
    // text address and townKey() is what decides two spellings are one town.
    return (data || []).filter((l) => area.townKeys.indexOf(townKey(l.location)) !== -1);
}

export async function generateMetadata({
    params,
}: {
    params: { area: string };
}): Promise<Metadata> {
    const area = areaBySlug(params.area);
    if (!area) {
        return { title: 'Not found', robots: { index: false, follow: false } };
    }

    const listings = await listingsForArea(area);
    const publishable = hasCopy(area) && !area.hold && listings.length > 0;

    // Built the way people search: what, then where. "Holiday cottages in
    // Kirkcudbright" is the phrase; the brand goes on the end by the template
    // in the root layout.
    const title = `Holiday cottages in ${area.name}`;

    // The real description is written by hand in config/areas.ts. This
    // fallback exists so the page is never description-less while it is being
    // worked on — it is not good enough to publish, which is one more reason
    // an unwritten page is noindex.
    const description =
        area.metaDescription
        || `Self catering holiday cottages and apartments in ${area.name}, Dumfries & Galloway. `
           + 'Book direct with local hosts — no booking fees.';

    const image = listings.length && listings[0].images && listings[0].images.length
        ? `${SITE_URL}/images/hero-1.jpg`
        : `${SITE_URL}/images/hero-1.jpg`;

    return {
        title,
        description,
        alternates: { canonical: `/holiday-cottages/${area.slug}` },
        openGraph: {
            type: 'website',
            locale: 'en_GB',
            url: `${SITE_URL}/holiday-cottages/${area.slug}`,
            siteName: 'Galloway Getaways',
            title: `${title} | Galloway Getaways`,
            description,
            images: [{ url: image, width: 1200, height: 630, alt: `Holiday cottages in ${area.name}` }],
        },
        twitter: {
            card: 'summary_large_image',
            title: `${title} | Galloway Getaways`,
            description,
            images: [image],
        },
        // Unwritten, or nothing to show: the page exists and is not offered to
        // Google. This has to be a meta tag as well as a sitemap omission —
        // leaving a page out of a sitemap does not stop it being indexed from
        // a link.
        ...(publishable ? {} : { robots: { index: false, follow: false } }),
    };
}

// Where the copy goes. Rendered only when there is copy, so an unwritten page
// shows the properties and nothing pretending to be prose.
function Placeholder({ what }: { what: string }) {
    // Never rendered in production — see the guard at the call sites. It is
    // here so that running the site locally shows you what is still missing
    // rather than a page that merely looks short.
    if (process.env.NODE_ENV === 'production') return null;
    return (
        <div className="my-6 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-5 py-4">
            <p className="text-sm font-semibold text-amber-900">Copy needed: {what}</p>
            <p className="text-sm text-amber-800 mt-1">
                See AREA-BRIEF.md. Until this is written the page is noindex and out of the sitemap.
            </p>
        </div>
    );
}

export default async function AreaPage({ params }: { params: { area: string } }) {
    const area = areaBySlug(params.area);
    if (!area) notFound();

    const listings = await listingsForArea(area);
    const written = hasCopy(area);

    // ItemList, not a made-up type. It says "this page is a list of these
    // things", which is what it is, and it is the schema Google reads to
    // understand that an area page sits above the listing pages rather than
    // competing with them. The listings carry their own VacationRental data on
    // their own pages; repeating it here would be two sources for one fact.
    const itemListSchema = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `Holiday cottages in ${area.name}`,
        numberOfItems: listings.length,
        itemListElement: listings.map((l, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: `${SITE_URL}/homes/${l.id}`,
            name: l.title,
        })),
    };

    const breadcrumbSchema = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
            {
                '@type': 'ListItem',
                position: 2,
                name: `Holiday cottages in ${area.name}`,
                item: `${SITE_URL}/holiday-cottages/${area.slug}`,
            },
        ],
    };

    const faqSchema = area.faqs.length
        ? {
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: area.faqs.map((f) => ({
                  '@type': 'Question',
                  name: f.question,
                  acceptedAnswer: { '@type': 'Answer', text: f.answer },
              })),
          }
        : null;

    const nearbyAreas = area.nearby
        .map((slug) => AREAS.filter((a) => a.slug === slug)[0])
        .filter(Boolean);

    return (
        <main className="min-h-screen bg-stone-50">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }}
            />
            {faqSchema && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
                />
            )}

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14">
                {/* A visible breadcrumb as well as the schema one. It is the
                    way back up that a listing page did not have. */}
                <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone-500">
                    <Link href="/" className="hover:text-stone-900 underline underline-offset-4">
                        Home
                    </Link>
                    <span className="mx-2" aria-hidden="true">/</span>
                    <span className="text-stone-900 font-medium">Holiday cottages in {area.name}</span>
                </nav>

                {/* The one h1 on this page, and it is the search term rather
                    than the brand. */}
                <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-stone-900">
                    Holiday cottages in {area.name}
                </h1>
                <p className="mt-3 flex items-center gap-2 text-stone-600">
                    <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                    Dumfries &amp; Galloway, Scotland
                </p>

                {/* --- the two or three paragraphs that are the whole point --- */}
                <section className="mt-8 max-w-3xl">
                    {written ? (
                        area.intro.map((paragraph, i) => (
                            <p key={i} className="text-lg text-stone-700 leading-relaxed mb-4">
                                {paragraph}
                            </p>
                        ))
                    ) : (
                        <Placeholder what={`the introduction to ${area.name} — 250 to 400 words`} />
                    )}
                </section>

                {/* --- the properties --- */}
                <section className="mt-12">
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900 border-b border-stone-200 pb-4 mb-8">
                        {listings.length > 0
                            ? `Places to stay in ${area.name}`
                            : `We have nothing in ${area.name} yet`}
                    </h2>

                    {listings.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
                            {listings.map((listing) => (
                                <ListingCard key={listing.id} listing={listing} />
                            ))}
                        </div>
                    ) : (
                        /* Said plainly rather than dressed up. A page that
                           promises cottages and shows an empty grid is the
                           thing that loses the visitor AND the ranking, which
                           is why this page is out of the sitemap until there
                           is something on it. */
                        <div className="rounded-2xl border border-stone-200 bg-white px-6 py-10 text-center">
                            <p className="text-stone-700">
                                No properties in {area.name} are listed with us at the moment.
                            </p>
                            <Link
                                href="/"
                                className="inline-block mt-5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-full px-6 py-2.5 transition"
                            >
                                See everywhere in Dumfries &amp; Galloway
                            </Link>
                        </div>
                    )}
                </section>

                {/* --- getting there --- */}
                <section className="mt-14 max-w-3xl">
                    <h2 className="text-xl md:text-2xl font-bold text-stone-900 mb-4">
                        Getting to {area.name}
                    </h2>
                    {area.gettingThere.length ? (
                        <ul className="space-y-2 text-stone-700">
                            {area.gettingThere.map((line, i) => (
                                <li key={i}>{line}</li>
                            ))}
                        </ul>
                    ) : (
                        <Placeholder what={`driving times to ${area.name} from Glasgow, Carlisle and Edinburgh`} />
                    )}
                </section>

                {/* --- FAQs --- */}
                <section className="mt-14 max-w-3xl">
                    <h2 className="text-xl md:text-2xl font-bold text-stone-900 mb-4">
                        Common questions about staying in {area.name}
                    </h2>
                    {area.faqs.length ? (
                        <dl className="space-y-6">
                            {area.faqs.map((faq, i) => (
                                <div key={i}>
                                    <dt className="font-semibold text-stone-900">{faq.question}</dt>
                                    <dd className="mt-1 text-stone-700">{faq.answer}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : (
                        <Placeholder what={`three or four questions people ask about ${area.name}`} />
                    )}
                </section>

                {/* --- the sideways links that stop every page being a dead end --- */}
                {nearbyAreas.length > 0 && (
                    <section className="mt-14">
                        <h2 className="text-xl md:text-2xl font-bold text-stone-900 mb-4">
                            Nearby
                        </h2>
                        <ul className="flex flex-wrap gap-3">
                            {nearbyAreas.map((other) => (
                                <li key={other.slug}>
                                    <Link
                                        href={`/holiday-cottages/${other.slug}`}
                                        className="inline-block rounded-full border border-stone-300 hover:border-stone-900 px-4 py-2 text-sm font-semibold text-stone-800 transition"
                                    >
                                        Holiday cottages in {other.name}
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
