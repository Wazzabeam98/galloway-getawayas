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
        .select('id, listing_id, check_in, check_out, status, guests')
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
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10">
            <div className="rounded-3xl overflow-hidden border border-stone-200 bg-white flex flex-col md:flex-row">
                {image && (
                    <div className="md:w-72 h-48 md:h-auto flex-shrink-0">
                        <img
                            src={image}
                            alt={listing.title}
                            className="w-full h-full object-cover"
                        />
                    </div>
                )}

                <div className="p-6 flex-1 flex flex-col justify-center">
                    <div className="text-xs font-semibold tracking-wide uppercase text-emerald-700 mb-1">
                        {booking.status === 'pending' ? 'Awaiting your host' : 'Your next stay'}
                    </div>

                    <div className="text-2xl md:text-3xl font-bold text-stone-900 mb-1">
                        {headline}
                    </div>

                    <div className="text-stone-700 font-medium">{listing.title}</div>
                    <div className="text-sm text-stone-500 mb-4">
                        {formatUk(checkIn)} &rarr; {formatUk(checkOut)}
                        {booking.guests ? ' · ' + booking.guests + (booking.guests === 1 ? ' guest' : ' guests') : ''}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Link
                            href="/trips"
                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition"
                        >
                            <CalendarDays className="w-4 h-4" />
                            Your trip
                        </Link>
                        <Link
                            href={'/messages/' + booking.id}
                            className="inline-flex items-center gap-1.5 px-4 py-2 border border-stone-300 hover:border-stone-900 text-stone-800 text-sm font-semibold rounded-xl transition"
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
