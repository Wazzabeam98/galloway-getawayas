import { DEFAULT_COMMISSION_PERCENT, rateFor, netOfFee } from '@/lib/fees';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getImageUrl, displayName } from '@/lib/utils';
import { formatUk } from '@/lib/cancellation';
import { accessibleListings } from '@/lib/access';
import { MessageSquare, CalendarDays, Phone } from 'lucide-react';
import UpcomingTrip from '@/components/UpcomingTrip';
import BookingActions from '@/components/BookingActions';

// The host-mode counterpart to UpcomingTrip. Somebody who has switched to
// hosting is thinking about who is arriving, not about their own holiday, so
// the top of the home page shows the next two arrivals instead of their trip.
export default async function HostReservations() {
    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getSession();

    if (!auth || !auth.session || !auth.session.user) return null;

    // One pass over their access, then three questions of it. listingIdsFor
    // fetches the lot every time it is called, so asking it twice fetched the
    // same rows twice.
    const access = await accessibleListings(auth.session.user.id);

    // Properties they own, plus any they co-host with permission to see
    // bookings. Read with the service key: a co-host is not the host_id on a
    // booking row, so row-level security would hand back nothing at all.
    const allowed = access.filter((a) => a.can_bookings).map((a) => a.listingId);

    // Money is a separate permission. Somebody can be trusted with the diary
    // and not with the takings — staff, typically — so the earnings line is
    // gated on can_earnings rather than on seeing the booking at all.
    const earningsAllowed = access.filter((a) => a.can_earnings).map((a) => a.listingId);

    // Accepting and declining are never delegated, whatever else somebody has
    // been given — see the note on accessibleListings. Declining refunds the
    // guest, and /api/stripe/refund answers 403 to anyone who is not the
    // host_id, so showing a co-host these buttons offers them a click that
    // cannot work.
    const ownedIds = access.filter((a) => a.isOwner).map((a) => a.listingId);

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
        .select('id, listing_id, guest_id, check_in, check_out, status, guests, total_price, commission_rate, amount_paid, amount_refunded')
        .in('listing_id', allowed)
        .in('status', ['confirmed', 'pending'])
        .gte('check_in', todayKey)
        .order('check_in', { ascending: true })
        .limit(4);

    if (!bookings || bookings.length === 0) return null;

    const listingIds = Array.from(new Set(bookings.map((b) => b.listing_id)));
    const guestIds = Array.from(new Set(bookings.map((b) => b.guest_id)));

    const { data: listings } = await admin
        .from('listings')
        .select('id, title, location, images, commission_rate')
        .in('id', listingIds);

    const { data: guests } = guestIds.length
        ? await admin
            .from('profiles')
            .select('id, full_name, preferred_name, show_full_name, phone')
            .in('id', guestIds)
        : { data: [] };

    const listingMap: Record<
        string,
        { title: string; location: string | null; images: string[] | null; rate: number }
    > = {};
    (listings || []).forEach((l) => {
        listingMap[l.id] = {
            title: l.title,
            location: l.location,
            images: l.images,
            rate: rateFor(l),
        };
    });

    const guestNameMap: Record<string, string> = {};
    const guestPhoneMap: Record<string, string | null> = {};
    (guests || []).forEach((g) => {
        guestNameMap[g.id] = displayName(g, 'Guest');
        guestPhoneMap[g.id] = g.phone || null;
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

                    // The rate stamped on the booking wins, so a stay is
                    // always netted at the rate that applied when it was
                    // taken, even if the listing's rate changed afterwards.
                    // Same order the earnings page uses, so the two agree.
                    const rate =
                        booking.commission_rate !== null && booking.commission_rate !== undefined
                            ? Number(booking.commission_rate)
                            : listing.rate ?? DEFAULT_COMMISSION_PERCENT;

                    // The whole stay less anything already refunded, matching
                    // what the payout run will actually send.
                    const refunded = Number(booking.amount_refunded || 0);
                    const grossDue = Math.round((Number(booking.total_price || 0) - refunded) * 100) / 100;
                    const earns = netOfFee(grossDue > 0 ? grossDue : 0, rate);

                    // A stay pays out the day after check-in.
                    const paysOn = new Date(booking.check_in);
                    paysOn.setHours(0, 0, 0, 0);
                    paysOn.setDate(paysOn.getDate() + 1);

                    const showMoney = earningsAllowed.indexOf(booking.listing_id) !== -1;
                    const canAnswer = ownedIds.indexOf(booking.listing_id) !== -1;

                    // Close enough to arrival that a host may need to ring
                    // them — a late ferry, a key left somewhere. Further out
                    // there is no reason to put a private number on a page
                    // that is open the moment somebody signs in.
                    const phone = days <= 1 ? guestPhoneMap[booking.guest_id] : null;

                    const bookingHref = '/dashboard/bookings/' + booking.id;


                    return (
                        <div
                            key={booking.id}
                            className="relative rounded-3xl overflow-hidden border border-stone-200 hover:border-stone-300 transition bg-white flex flex-col"
                        >
                            {/* Covers the card so the whole thing is
                                clickable. The buttons below sit on top of it. */}
                            <Link
                                href={bookingHref}
                                className="absolute inset-0"
                                aria-label={'Open this booking at ' + listing.title}
                            />

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

                                {showMoney && (
                                    <div className="mt-5 pt-5 border-t border-stone-100">
                                        <div className="text-lg font-semibold text-stone-900">
                                            &pound;{earns.toFixed(2)}
                                            <span className="text-sm font-normal text-stone-500">
                                                {' '}after your {rate}% fee
                                            </span>
                                        </div>
                                        <div className="text-sm text-stone-500 mt-1">
                                            {booking.status === 'pending'
                                                ? 'If you confirm, paid the day after check-in'
                                                : 'Paid ' + formatUk(paysOn)}
                                        </div>
                                    </div>
                                )}

                                {/* The card said a request was waiting and gave
                                    nowhere to answer it, so the host had to go
                                    hunting for the buttons on another page.
                                    'relative' lifts these clear of the link
                                    covering the whole card. */}
                                {booking.status === 'pending' && (
                                    <div className="relative mt-5">
                                        <div className="text-sm font-semibold text-amber-700">
                                            Waiting for you to confirm
                                        </div>
                                        {canAnswer ? (
                                        <div className="mt-3">
                                            <BookingActions
                                                bookingId={booking.id}
                                                totalPrice={Number(booking.total_price || 0)}
                                                amountPaid={Number(booking.amount_paid || 0)}
                                                amountRefunded={Number(booking.amount_refunded || 0)}
                                            />
                                        </div>
                                        ) : (
                                            <div className="mt-1 text-sm text-stone-500">
                                                Only the owner can answer this one.
                                            </div>
                                        )}
                                    </div>
                                )}

                                {phone && (
                                    <a
                                        href={'tel:' + phone}
                                        className="relative inline-flex items-center gap-2 mt-5 text-sm font-semibold text-stone-900 hover:underline w-fit"
                                    >
                                        <Phone className="w-4 h-4" />
                                        {phone}
                                    </a>
                                )}

                                <div className="relative flex flex-wrap gap-3 mt-8">
                                    <Link
                                        href={bookingHref}
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
