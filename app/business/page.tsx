import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Sparkles, Wrench, MapPin } from 'lucide-react';
import RecruitFaq from '@/components/business/RecruitFaq';
import PropertyTypeIcon from '@/components/PropertyTypeIcon';
import { businessSignupsOpen } from '@/lib/serviceOrders';
import { DEFAULT_COMMISSION_PERCENT } from '@/lib/fees';
import { PROPERTY_TYPES } from '@/lib/propertyTypes';
import { AREAS, hasCopy, listingInArea } from '@/config/areas';
import { adminClient } from '@/lib/supabaseAdmin';

// THE HOST LANDING PAGE — the page meant to rank for "list a holiday let in
// Dumfries & Galloway".
//
// Until Oct 2026 /business WAS the three-tile "What would you like to host?"
// picker: 38 words, a full-screen takeover with no header or footer. Google
// crawled it and declined to index it ("Crawled – currently not indexed").
// Copied from Airbnb's airbnb.co.uk/host/homes (read 30 Oct 2026): a hero with
// one Get started button, three short "why" columns, a reassurance section,
// and "Your questions, answered". Get started goes to the picker, now at
// /business/start, exactly as Airbnb's goes to its own picker.
//
// What Airbnb leaves out, and so do we: no percentage in the hero, no feature
// grid, no testimonials. Where we differ, deliberately:
//   • no earnings estimator — we have too few bookings to estimate from, and a
//     made-up number is worse than none;
//   • no "you're protected" / AirCover section — we offer no damage
//     protection or insurance, and the page must not imply it;
//   • the fee IS stated, once, plainly, in "What it costs" — for a small local
//     platform the low fee is the reason to list, and the FAQ says it anyway;
//   • "What you can list" and "Where guests are looking" are ours: the first
//     answers "is my place right for this?", which Airbnb leaves to its FAQ,
//     and the second is the local part — the area pages, linked.
//
// Every number comes from code: the commission from lib/fees, everything in the
// FAQ from lib/recruitFaq (held to the code by tests/recruit-faq.test.ts).
//
// Content you read, not a surface you act on — flat, never lifted (CLAUDE.md).

export const metadata: Metadata = {
    // The root layout appends ' | Galloway Getaways'.
    title: 'List your holiday let in Dumfries & Galloway',
    description:
        'List your cottage, lodge or glamping site in Dumfries & Galloway for free. '
        + `${DEFAULT_COMMISSION_PERCENT}% commission only when you're booked, no booking fee for guests, `
        + 'paid the day after check-in, and your Airbnb and Booking.com calendars kept in sync.',
    alternates: { canonical: '/business' },
};

// Read on every request, never frozen into a build (see register-interest).
export const dynamic = 'force-dynamic';

const STEPS = [
    {
        title: 'Create your listing',
        body: 'A title, a nightly price, the address, a short description and at least five photos. Your calendar from Airbnb or Booking.com can come with you.',
    },
    {
        title: 'We look it over',
        body: 'We check your first listing before it goes live, so every place on the site is a real one, and tell you if anything needs changing.',
    },
    {
        title: 'Guests book and pay',
        body: 'Guests pay on the site — in full, or a 25% deposit when check-in is more than 30 days away. You choose the cancellation policy and the house rules.',
    },
    {
        title: 'You get paid',
        body: 'We release your share the day after check-in and Stripe pays it into your bank, on the schedule you pick.',
    },
];

export default async function BusinessPage() {
    const signupsOpen = businessSignupsOpen();
    // Held on production until the host terms are back (see HostFork): the
    // button then registers interest rather than opening a picker of greyed
    // "coming soon" tiles.
    const startHref = signupsOpen ? '/business/start' : '/register-interest?type=holiday_let';
    const startLabel = signupsOpen ? 'Get started' : 'Register your interest';

    const listable = PROPERTY_TYPES.filter((t) => t.group !== 'legacy');
    // Only areas with somewhere to stay in them — the same rule as the sitemap.
    // An area with no listings is noindex, and a link to it hands Google a page
    // that declines to be indexed. A failed read just drops the section.
    const { data: published } = await adminClient()
        .from('listings')
        .select('location, approx_latitude, approx_longitude')
        .eq('status', 'published');
    const placed = (published || []).map((l: any) => ({
        location: l.location,
        approx_latitude: l.approx_latitude == null ? null : Number(l.approx_latitude),
        approx_longitude: l.approx_longitude == null ? null : Number(l.approx_longitude),
    }));
    const areas = AREAS.filter((a) => hasCopy(a) && !a.hold && placed.some((l) => listingInArea(a, l)));

    const cta = (
        <Link
            href={startHref}
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-7 py-3.5 text-base font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
        >
            {startLabel}
            <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
    );

    return (
        <div className="bg-white">
            {/* Hero */}
            <section className="mx-auto max-w-3xl px-4 pb-14 pt-14 text-center sm:px-6 sm:pt-20">
                <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 [text-wrap:balance] sm:text-5xl">
                    List your holiday let in Dumfries &amp; Galloway
                </h1>
                <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-600 [text-wrap:pretty]">
                    Galloway Getaways is the local place to book a self-catering stay in
                    Dumfries &amp; Galloway. Listing your cottage, lodge or cabin is free.
                </p>
                <div className="mt-8">{cta}</div>
                {!signupsOpen && (
                    <p className="mt-3 text-sm text-slate-500">We&apos;re opening to new hosts soon.</p>
                )}
            </section>

            {/* Why — Airbnb's three columns */}
            <section className="border-t border-slate-200">
                <div className="mx-auto grid max-w-5xl gap-10 px-4 py-14 sm:grid-cols-3 sm:px-6">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">It&apos;s easy</h2>
                        <p className="mt-2 text-slate-600">
                            Create a listing in a few steps. Keep it on Airbnb and Booking.com too: we
                            check your other calendars every 15 minutes, so you won&apos;t be
                            double-booked.
                        </p>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">It&apos;s worth it</h2>
                        <p className="mt-2 text-slate-600">
                            Listing is free. You set your price, and we only take our{' '}
                            {DEFAULT_COMMISSION_PERCENT}% when you&apos;re booked. Guests pay no booking
                            fee on top, so your price is the price they see.
                        </p>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">It&apos;s local</h2>
                        <p className="mt-2 text-slate-600">
                            We&apos;re a Dumfries &amp; Galloway business based in Castle Douglas.
                            Guests find you alongside local experiences and places to visit, not
                            thousands of listings from everywhere else.{' '}
                            <Link href="/local-commitment" className="font-semibold text-slate-800 underline underline-offset-2">
                                Our local commitment
                            </Link>
                        </p>
                    </div>
                </div>
            </section>

            {/* What you can list */}
            <section className="border-t border-slate-200 bg-slate-50">
                <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">What you can list</h2>
                    <p className="mt-3 max-w-2xl text-slate-600">
                        Any self-catering place a guest has to themselves, or a private room in one.
                        Glamping sites and berths list by pitch or berth name rather than a street.
                    </p>
                    <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
                        {listable.map((t) => (
                            <li key={t.name} className="flex items-center gap-3 text-slate-800">
                                <PropertyTypeIcon icon={t.icon} className="h-6 w-6 flex-none text-slate-700" />
                                {t.label}
                            </li>
                        ))}
                    </ul>
                </div>
            </section>

            {/* How it works */}
            <section className="border-t border-slate-200">
                <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">How it works</h2>
                    <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                        {STEPS.map((s, i) => (
                            <li key={s.title}>
                                <span className="text-sm font-semibold text-emerald-700">Step {i + 1}</span>
                                <h3 className="mt-1 text-lg font-bold text-slate-900">{s.title}</h3>
                                <p className="mt-2 text-slate-600">{s.body}</p>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            {/* What it costs */}
            <section className="border-t border-slate-200 bg-slate-50">
                <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">What it costs</h2>
                    <dl className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2">
                        <div className="border-t border-slate-200 pt-4">
                            <dt className="font-semibold text-slate-900">To list</dt>
                            <dd className="mt-1 text-slate-600">Free. No sign-up fee, no subscription.</dd>
                        </div>
                        <div className="border-t border-slate-200 pt-4">
                            <dt className="font-semibold text-slate-900">When you&apos;re booked</dt>
                            <dd className="mt-1 text-slate-600">
                                {DEFAULT_COMMISSION_PERCENT}% commission on the booking, kept before we pay you.
                            </dd>
                        </div>
                        <div className="border-t border-slate-200 pt-4">
                            <dt className="font-semibold text-slate-900">For your guests</dt>
                            <dd className="mt-1 text-slate-600">No booking fee on top of your price.</dd>
                        </div>
                        <div className="border-t border-slate-200 pt-4">
                            <dt className="font-semibold text-slate-900">Card fees</dt>
                            <dd className="mt-1 text-slate-600">We don&apos;t pass Stripe&apos;s card fees on to you.</dd>
                        </div>
                    </dl>
                    <p className="mt-6 text-sm text-slate-500">
                        If you cancel a confirmed booking, a fee of 5% of the booking comes off your next payout. The full
                        detail is in the{' '}
                        <Link href="/terms/hosts" className="underline underline-offset-2">Host Agreement</Link>.
                    </p>
                </div>
            </section>

            {/* Where guests are looking — the area pages */}
            {areas.length > 0 && (
                <section className="border-t border-slate-200">
                    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
                        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                            Where guests are looking
                        </h2>
                        <p className="mt-3 max-w-2xl text-slate-600">
                            Guests come to us for the whole of Dumfries &amp; Galloway — the coast, the
                            towns and the Galloway Forest. See what&apos;s already listed near you.
                        </p>
                        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {areas.map((a) => (
                                <li key={a.slug} className="flex items-center gap-2">
                                    <MapPin className="h-4 w-4 flex-none text-slate-500" aria-hidden />
                                    <Link
                                        href={`/holiday-cottages/${a.slug}`}
                                        className="font-medium text-slate-800 underline underline-offset-2 hover:text-slate-900"
                                    >
                                        Holiday lets in {a.name}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>
            )}

            {/* FAQ — the same tested answers as the sign-up flow */}
            <section className="border-t border-slate-200 px-4 py-14 sm:px-6">
                <RecruitFaq audience="host" />
            </section>

            {/* Not a holiday let? */}
            <section className="border-t border-slate-200 bg-slate-50">
                <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Not a holiday let?</h2>
                    <div className="mt-6 grid gap-6 sm:grid-cols-2">
                        <Link href="/business/experience" className="group flex items-start gap-4">
                            <Sparkles className="mt-0.5 h-6 w-6 flex-none text-emerald-700" aria-hidden />
                            <span>
                                <span className="block font-semibold text-slate-900 group-hover:underline">Host a guest experience</span>
                                <span className="block text-slate-600">A private chef, a sauna, a class or a guided walk, booked by guests staying nearby.</span>
                            </span>
                        </Link>
                        <Link href="/services/join" className="group flex items-start gap-4">
                            <Wrench className="mt-0.5 h-6 w-6 flex-none text-emerald-700" aria-hidden />
                            <span>
                                <span className="block font-semibold text-slate-900 group-hover:underline">Offer a service</span>
                                <span className="block text-slate-600">Cleaning, laundry, maintenance and other work for holiday-let owners.</span>
                            </span>
                        </Link>
                    </div>
                </div>
            </section>

            {/* Closing CTA */}
            <section className="border-t border-slate-200">
                <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
                    <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">Ready to list your place?</h2>
                    <div className="mt-6">{cta}</div>
                </div>
            </section>
        </div>
    );
}
