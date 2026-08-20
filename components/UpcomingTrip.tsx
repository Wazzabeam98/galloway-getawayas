import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getImageUrl } from '@/lib/utils';
import { formatUk } from '@/lib/cancellation';
import { MessageSquare, CalendarDays } from 'lucide-react';

// Shown at the top of the home page to someone with a stay coming up. The
// point is that a guest logging in six weeks before their holiday sees their
// holiday, not a search box they've already used.
export default async function UpcomingTrip() {
    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getSession();

    if (!auth || !auth.session || !auth.session.user) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toISOString().split('T')[0];

    const { data: bookings } = await supabase
        .from('bookings')
        .select('id, listing_id, check_in, check_out, status, guests, free_cancel_until')
        .eq('guest_id', auth.session.user.id)
        .in('status', ['confirmed', 'pending'])
        .gte('check_out', todayKey)
        .order('check_in', { ascending: true })
        .limit(1);

    const booking = bookings && bookings[0];
    if (!booking) return null;

    const { data: listing } = await supabase
        .from('listings')
        .select('id, title, location, images')
        .eq('id', booking.listing_id)
        .maybeSingle();

    if (!listing) return null;

    const checkIn = new Date(booking.check_in);
    checkIn.setHours(0, 0, 0, 0);
    const checkOut = new Date(booking.check_out);
    checkOut.setHours(0, 0, 0, 0);

    const days = Math.round((checkIn.getTime() - today.getTime()) / 86400000);
    const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000);

    // Only worth showing while it's still true. Once the window has closed,
    // saying so on the home page would be a poke rather than a reassurance.
    const freeUntil = booking.free_cancel_until ? new Date(booking.free_cancel_until) : null;
    if (freeUntil) freeUntil.setHours(0, 0, 0, 0);
    const canStillCancelFree = !!freeUntil && freeUntil.getTime() >= today.getTime();
    const freeDaysLeft = freeUntil
        ? Math.round((freeUntil.getTime() - today.getTime()) / 86400000)
        : 0;
    const staying = days <= 0 && checkOut.getTime() > today.getTime();

    // The bit that does the work. Everything else on this card is detail.
    const headline = staying
        ? 'You\u2019re there now'
        : days === 0
            ? 'Today\u2019s the day'
            : days === 1
                ? 'Tomorrow'
                : days + ' days to go';

    const image =
        listing.images && listing.images.length > 0 ? getImageUrl(listing.images[0]) : null;

    return (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14">
            <div className="mb-6 border-b border-stone-200 pb-4">
                <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                    {booking.status === 'pending' ? 'Your booking request' : 'Your upcoming trip'}
                </h2>
                <p className="text-stone-600 text-sm md:text-base mt-1">
                    {booking.status === 'pending'
                        ? 'Waiting for your host to confirm'
                        : 'Everything you need for the stay is in here'}
                </p>
            </div>

            <div className="rounded-3xl overflow-hidden border border-stone-200 bg-white flex flex-col md:flex-row">
                {image && (
                    <div className="md:w-2/5 lg:w-1/3 h-56 md:h-auto md:min-h-[20rem] flex-shrink-0">
                        <img
                            src={image}
                            alt={listing.title}
                            className="w-full h-full object-cover"
                        />
                    </div>
                )}

                <div className="p-8 md:p-10 flex-1 flex flex-col justify-center">
                    {/* The countdown is the reason anyone looks at this, so it
                        gets the room. Everything else is supporting detail. */}
                    <div className="text-4xl md:text-5xl font-bold text-stone-900 tracking-tight">
                        {headline}
                    </div>

                    <div className="mt-6 space-y-1">
                        <div className="text-lg font-semibold text-stone-900">{listing.title}</div>
                        {listing.location && (
                            <div className="text-stone-500">{listing.location}</div>
                        )}
                    </div>

                    <div className="mt-5 pt-5 border-t border-stone-100 text-stone-700">
                        <div className="font-medium">
                            {formatUk(checkIn)} &rarr; {formatUk(checkOut)}
                        </div>
                        <div className="text-sm text-stone-500 mt-1">
                            {nights} {nights === 1 ? 'night' : 'nights'}
                            {booking.guests
                                ? ' · ' + booking.guests + (booking.guests === 1 ? ' guest' : ' guests')
                                : ''}
                        </div>
                    </div>

                    {canStillCancelFree && (
                        <div className="mt-5 text-sm">
                            <span className={freeDaysLeft <= 3 ? 'text-amber-700' : 'text-emerald-700'}>
                                Free cancellation until {formatUk(freeUntil as Date)}
                            </span>
                            {freeDaysLeft <= 3 && (
                                <span className="text-stone-500">
                                    {' '}&middot;{' '}
                                    {freeDaysLeft === 0
                                        ? 'last day'
                                        : freeDaysLeft === 1
                                            ? '1 day left'
                                            : freeDaysLeft + ' days left'}
                                </span>
                            )}
                        </div>
                    )}

                    <div className="flex flex-wrap gap-3 mt-8">
                        <Link
                            href="/trips"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition"
                        >
                            <CalendarDays className="w-4 h-4" />
                            Your trip
                        </Link>
                        <Link
                            href={'/messages/' + booking.id}
                            className="inline-flex items-center gap-2 px-6 py-3 border border-stone-300 hover:border-stone-900 text-stone-800 text-sm font-semibold rounded-xl transition"
                        >
                            <MessageSquare className="w-4 h-4" />
                            Message your host
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
}
