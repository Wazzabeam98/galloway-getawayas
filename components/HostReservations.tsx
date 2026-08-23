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
        .select('id, listing_id, guest_id, check_in, check_out, status, guests, total_price, commission_rate, amount_paid, amount_refunded, balance_due_date')
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

    // Whether the guest is waiting on an answer. The card has always carried a
    // Message guest button and never a reason to press it, so a host had to
    // open every conversation to find out there was nothing in any of them.
    // Unread means addressed to this person and not yet opened — the same rule
    // the inbox counts by, so the two never disagree.
    const { data: unreadRows } = await admin
        .from('messages')
        .select('booking_id')
        .in('booking_id', bookings.map((b) => b.id))
        .eq('recipient_id', auth.session.user.id)
        .is('read_at', null);

    const unreadMap: Record<string, number> = {};
    (unreadRows || []).forEach((m: any) => {
        unreadMap[m.booking_id] = (unreadMap[m.booking_id] || 0) + 1;
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

                    // "96 days to go" on its own sends you off to a calendar
                    // to work out what day that actually is. Said beside it,
                    // it doesn't.
                    const arrivalShort = checkIn.toLocaleDateString('en-GB', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                    });

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

                    // What the guest still owes, and when it is taken. The
                    // balance is charged automatically 30 days before check-in
                    // and can fail — an expired card, usually — so a stay can
                    // sit here looking healthy while the money never arrived.
                    // A due date already past with money still outstanding is
                    // the one thing on this card worth chasing today.
                    const stillOwed = Math.round((Number(booking.total_price || 0) - Number(booking.amount_paid || 0)) * 100) / 100;
                    const balanceDue = booking.balance_due_date
                        ? new Date(booking.balance_due_date)
                        : null;
                    if (balanceDue) balanceDue.setHours(0, 0, 0, 0);
                    const balanceLate = stillOwed > 0 && !!balanceDue && balanceDue.getTime() < today.getTime();

                    const unread = unreadMap[booking.id] || 0;

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

                            <div className="p-8 flex-1 flex flex-col">
                                {/* The photo used to be a 176px banner across
                                    the top, which on a listing whose first
                                    image is a placeholder is a white band
                                    above everything that matters. Small and
                                    beside the name it still does the job it
                                    was there for — telling three cottages
                                    apart at a glance — at a tenth of the
                                    height. */}
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-stone-100 flex-shrink-0">
                                        {image && (
                                            <img
                                                src={image}
                                                alt={listing.title}
                                                className="w-full h-full object-cover"
                                            />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-lg font-semibold text-stone-900 truncate">
                                            {listing.title}
                                        </div>
                                        {listing.location && (
                                            <div className="text-stone-500 text-sm truncate">
                                                {listing.location}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-6 text-3xl md:text-4xl font-bold text-stone-900 tracking-tight">
                                    {headline}
                                    {days > 1 && (
                                        <span className="block text-base font-normal text-stone-500 mt-1 tracking-normal">
                                            {arrivalShort}
                                        </span>
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
                                    <div className="relative mt-5 pt-5 border-t border-stone-100">
                                        {/* What the host is paid, framed by the
                                            stay rather than by the fee. The
                                            commission is a fact about this
                                            money, not the headline: a host
                                            reading their own home page wants
                                            to know what is coming, and can
                                            open the sum if they want it. */}
                                        <div className="text-lg font-semibold text-stone-900">
                                            &pound;{earns.toFixed(2)}
                                            <span className="text-sm font-normal text-stone-500">
                                                {' '}for {nights} {nights === 1 ? 'night' : 'nights'}
                                            </span>
                                        </div>
                                        <div className="text-sm text-stone-500 mt-1">
                                            {/* "Paid 27 November" read as the day
                                                the guest paid. It is the day the
                                                host is paid, which is the day
                                                after check-in. */}
                                            {booking.status === 'pending'
                                                ? 'If you confirm, it reaches you the day after check-in'
                                                : 'Reaches you ' + formatUk(paysOn) + ', the day after check-in'}
                                        </div>

                                        {stillOwed > 0 && (
                                            <div
                                                className={
                                                    'text-sm mt-2 font-medium '
                                                    + (balanceLate ? 'text-amber-700' : 'text-stone-600')
                                                }
                                            >
                                                &pound;{stillOwed.toFixed(2)} of it is still to come
                                                {balanceDue
                                                    ? balanceLate
                                                        ? ' — was due ' + formatUk(balanceDue) + ', so the charge may have failed'
                                                        : ' — charged ' + formatUk(balanceDue)
                                                    : ''}
                                            </div>
                                        )}

                                        <details className="group mt-3">
                                            <summary className="text-sm text-stone-500 underline cursor-pointer list-none w-fit hover:text-stone-800">
                                                <span className="group-open:hidden">How that&apos;s worked out</span>
                                                <span className="hidden group-open:inline">Hide the breakdown</span>
                                            </summary>
                                            <div className="mt-2 text-sm space-y-1">
                                                <div className="flex justify-between gap-6 text-stone-600">
                                                    <span>Guest pays</span>
                                                    <span>&pound;{grossDue.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between gap-6 text-stone-600">
                                                    <span>Our fee ({rate}%)</span>
                                                    <span>&minus; &pound;{(Math.round((grossDue - earns) * 100) / 100).toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between gap-6 font-semibold text-stone-900 pt-1 border-t border-stone-100">
                                                    <span>You get</span>
                                                    <span>&pound;{earns.toFixed(2)}</span>
                                                </div>
                                            </div>
                                        </details>
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
                                        href={'/messages?b=' + booking.id}
                                        className={
                                            'inline-flex items-center gap-2 px-6 py-3 border text-sm font-semibold rounded-xl transition '
                                            + (unread > 0
                                                ? 'border-emerald-700 text-emerald-800 hover:bg-emerald-50'
                                                : 'border-stone-300 hover:border-stone-900 text-stone-800')
                                        }
                                    >
                                        <MessageSquare className="w-4 h-4" />
                                        {unread > 0
                                            ? unread === 1
                                                ? '1 unread message'
                                                : unread + ' unread messages'
                                            : 'Message guest'}
                                    </Link>
                                </div>

                                {/* Calling a stay off used to mean finding the
                                    booking first. It is a rare thing to do and
                                    a serious one, so it sits under the card's
                                    own buttons rather than beside them, and
                                    the confirm step spells out the full refund
                                    and the 5% fee before anything moves.

                                    Not once the guest is arriving today: from
                                    check-in onwards a refund of part of the
                                    stay is the right instrument, and that
                                    lives on the booking itself. Owner only —
                                    /api/stripe/refund answers 403 to a
                                    co-host, so offering it would be offering a
                                    click that cannot work. */}
                                {booking.status === 'confirmed' && canAnswer && days >= 1 && (
                                    <div className="relative mt-4 pt-4 border-t border-stone-100">
                                        <BookingActions
                                            bookingId={booking.id}
                                            mode="confirmed"
                                            allowRefund={false}
                                            totalPrice={Number(booking.total_price || 0)}
                                            amountPaid={Number(booking.amount_paid || 0)}
                                            amountRefunded={Number(booking.amount_refunded || 0)}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
