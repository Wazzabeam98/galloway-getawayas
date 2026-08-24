import HostReservations from '@/components/HostReservations';
import { publicArea, townKey } from '@/lib/places';
import { icalBlockedListingIds } from '@/lib/availability';
import Hero from '@/components/base/Hero';
import UpcomingTrip from '@/components/UpcomingTrip';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getImageUrl } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import Link from 'next/link';
import { Home, Star } from 'lucide-react';
import { hasPublicScore } from '@/lib/reviews';

export const dynamic = 'force-dynamic';

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

    // Same cookie the navbar reads, so the page agrees with the mode switch.
    // Anyone who hasn't chosen is a traveller.
    const mode: 'host' | 'travel' =
        cookieStore.get('gg_mode')?.value === 'host' ? 'host' : 'travel';

    // What the hero's search button put in the URL. Every part is optional —
    // a bare `/` still means "show me everything".
    const where = readParam(searchParams.where);
    const from = readParam(searchParams.from);
    const to = readParam(searchParams.to);
    const guests = Number(readParam(searchParams.guests)) || 0;
    const wantsPets = readParam(searchParams.pets) === '1';

    // Only trust a date pair that is actually a stay.
    const hasDates = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from < to;
    const searching = Boolean(where) || hasDates || guests > 0 || wantsPets;

    let query = supabase
        .from('listings')
        .select('id, title, location, price_per_night, images, rating_avg, rating_count, max_guests')
        .eq('status', 'published')
        .order('created_at', { ascending: false });

    if (guests > 0) query = query.gte('max_guests', guests);
    // Pets are an amenity rather than a column of their own — this is the same
    // string the listing page checks before it offers a pet count.
    if (wantsPets) query = query.contains('amenities', ['Pets allowed']);

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
            .from('bookings')
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

    // What the guest asked for, said back to them, so a short list reads as a
    // result rather than as an empty site.
    const criteria: string[] = [];
    if (where) criteria.push(whereLabel(where));
    if (hasDates) {
        criteria.push(`${format(parseISO(from), 'd MMM')} – ${format(parseISO(to), 'd MMM')}`);
    }
    if (guests > 0) criteria.push(`${guests} guest${guests > 1 ? 's' : ''}`);
    if (wantsPets) criteria.push('pets welcome');

    return (
        <main className="min-h-screen bg-stone-50">
            {/* Kirkcudbright Hero Banner */}
            <Hero />

            {/* Someone with a stay coming up sees it before anything else. Returns
          nothing at all for a signed-out visitor or a guest with no booking.
          In hosting mode the same slot shows the next arrivals instead. */}
            {mode === 'host' ? <HostReservations /> : <UpcomingTrip />}

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
                                : 'Handpicked holiday rentals in Dumfries & Galloway'}
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

                {/* Property Grid */}
                {listings && listings.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
                        {listings.map((property) => {
                            const rating = property.rating_avg ? Number(property.rating_avg) : null;
                            const count = property.rating_count || 0;

                            return (
                                <Link
                                    key={property.id}
                                    href={`/homes/${property.id}`}
                                    className="group flex flex-col space-y-2"
                                >
                                    <div className="w-full h-64 rounded-2xl overflow-hidden bg-stone-200 relative">
                                        {property.images && property.images.length > 0 ? (
                                            <img
                                                src={getImageUrl(property.images[0])}
                                                alt={property.title}
                                                className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                                            />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-stone-400">
                                                <Home className="w-10 h-10" />
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="font-bold text-stone-900 text-base truncate">
                                            {property.title}
                                        </h3>

                                        {rating && hasPublicScore(count) ? (
                                            <span className="flex items-center gap-1 text-sm text-stone-900 shrink-0">
                                                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                                                <span className="font-semibold">{rating.toFixed(2)}</span>
                                                <span className="text-stone-400 font-normal">({count})</span>
                                            </span>
                                        ) : (
                                            <span className="text-xs text-emerald-700 font-semibold shrink-0 mt-0.5">
                                                New
                                            </span>
                                        )}
                                    </div>

                                    <p className="text-sm text-stone-500 truncate">
                                        {publicArea(property.location)}
                                    </p>
                                    <p className="text-sm font-semibold text-stone-900">
                                        £{property.price_per_night} <span className="font-normal text-stone-500">night</span>
                                    </p>
                                </Link>
                            );
                        })}
                    </div>
                ) : searching ? (
                    /* A search that found nothing is not an empty site, and must not
                       be described as one. */
                    <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-stone-200">
                        <h3 className="text-lg font-semibold text-stone-800">
                            No stays match that search
                        </h3>
                        <p className="text-stone-500 mt-1 max-w-md mx-auto">
                            Nothing is free for {criteria.join(' · ')}. Try different dates, or a
                            wider area.
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
            </div>
        </main>
    );
}
