import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getImageUrl, displayName } from '@/lib/utils';
import { formatUk } from '@/lib/cancellation';
import { listingIdsFor } from '@/lib/access';
import { MessageSquare, CalendarDays } from 'lucide-react';
import UpcomingTrip from '@/components/UpcomingTrip';

// The host-mode counterpart to UpcomingTrip. Somebody who has switched to
// hosting is thinking about who is arriving, not about their own holiday, so
// the top of the home page shows the next two arrivals instead of their trip.
export default async function HostReservations() {
    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getSession();

    if (!auth || !auth.session || !auth.session.user) return null;

    // Properties they own, plus any they co-host with permission to see
    // bookings. Read with the service key: a co-host is not the host_id on a
    // booking row, so row-level security would hand back nothing at all.
    const allowed = await listingIdsFor(auth.session.user.id, 'can_bookings');

    // The mode cookie outlives the listings that justified it — someone who
    // has since removed their last property would otherwise get a blank space
    // where their own trip used to be. Give them the guest card back.
    if (allowed.length === 0) return <UpcomingTrip />;

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toISOString().split('T')[0];

    // Arrivals still to come, so this counts down to a check-in rather than
    // sitting on a stay that is already under way.
    const { data: bookings } = await admin
        .from('bookings')
        .select('id, listing_id, guest_id, check_in, check_out, status, guests')
        .in('listing_id', allowed)
        .in('status', ['confirmed', 'pending'])
        .gte('check_in', todayKey)
        .order('check_in', { ascending: true })
        .limit(2);

    if (!bookings || bookings.length === 0) return null;

    const listingIds = Array.from(new Set(bookings.map((b) => b.listing_id)));
    const guestIds = Array.from(new Set(bookings.map((b) => b.guest_id)));

    const { data: listings } = await admin
        .from('listings')
        .select('id, title, location, images')
        .in('id', listingIds);

    const { data: guests } = guestIds.length
        ? await admin
            .from('profiles')
            .select('id, full_name, preferred_name, show_full_name')
            .in('id', guestIds)
        : { data: [] };

    const listingMap: Record<string, { title: string; location: string | null; images: string[] | null }> = {};
    (listings || []).forEach((l) => {
        listingMap[l.id] = { title: l.title, location: l.location, images: l.images };
    });

    const guestNameMap: Record<string, string> = {};
    (guests || []).forEach((g) => {
        guestNameMap[g.id] = displayName(g, 'Guest');
    });

    return (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14">
            <div className="mb-6 border-b border-stone-200 pb-4">
                <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                    {bookings.length === 1 ? 'Your next reservation' : 'Your next reservations'}
                </h2>
                <p className="text-stone-600 text-sm md:text-base mt-1">
                    Who is arriving, and when
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {bookings.map((booking) => {
                    const listing = listingMap[booking.listing_id];
                    if (!listing) return null;

                    const checkIn = new Date(booking.check_in);
                    checkIn.setHours(0, 0, 0, 0);
                    const checkOut = new Date(booking.check_out);
                    checkOut.setHours(0, 0, 0, 0);

                    const days = Math.round((checkIn.getTime() - today.getTime()) / 86400000);
                    const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000);

                    // The countdown to check-in is the reason a host looks at
                    // this, so it gets the room. Everything else is detail.
                    const headline =
                        days === 0
                            ? 'Arriving today'
                            : days === 1
                                ? 'Arriving tomorrow'
                                : days + ' days to go';

                    const image =
                        listing.images && listing.images.length > 0
                            ? getImageUrl(listing.images[0])
                            : null;

                    const guestName = guestNameMap[booking.guest_id] || 'Guest';

                    return (
                        <div
                            key={booking.id}
                            className="rounded-3xl overflow-hidden border border-stone-200 bg-white flex flex-col"
                        >
                            {image && (
                                <div className="h-44 flex-shrink-0">
                                    <img
                                        src={image}
                                        alt={listing.title}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            )}

                            <div className="p-8 flex-1 flex flex-col">
                                <div className="text-3xl md:text-4xl font-bold text-stone-900 tracking-tight">
                                    {headline}
                                </div>

                                <div className="mt-6 space-y-1">
                                    <div className="text-lg font-semibold text-stone-900">
                                        {listing.title}
                                    </div>
                                    {listing.location && (
                                        <div className="text-stone-500">{listing.location}</div>
                                    )}
                                </div>

                                <div className="mt-5 pt-5 border-t border-stone-100 text-stone-700">
                                    <div className="font-medium">{guestName}</div>
                                    <div className="text-sm text-stone-500 mt-1">
                                        {formatUk(checkIn)} &rarr; {formatUk(checkOut)}
                                    </div>
                                    <div className="text-sm text-stone-500 mt-1">
                                        {nights} {nights === 1 ? 'night' : 'nights'}
                                        {booking.guests
                                            ? ' · ' + booking.guests + (booking.guests === 1 ? ' guest' : ' guests')
                                            : ''}
                                    </div>
                                </div>

                                {booking.status === 'pending' && (
                                    <div className="mt-5 text-sm text-amber-700">
                                        Waiting for you to confirm
                                    </div>
                                )}

                                <div className="flex flex-wrap gap-3 mt-8">
                                    <Link
                                        href="/dashboard/bookings"
                                        className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition"
                                    >
                                        <CalendarDays className="w-4 h-4" />
                                        The booking
                                    </Link>
                                    <Link
                                        href={'/messages/' + booking.id}
                                        className="inline-flex items-center gap-2 px-6 py-3 border border-stone-300 hover:border-stone-900 text-stone-800 text-sm font-semibold rounded-xl transition"
                                    >
                                        <MessageSquare className="w-4 h-4" />
                                        Message guest
                                    </Link>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
