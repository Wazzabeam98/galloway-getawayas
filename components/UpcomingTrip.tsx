import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { formatUk } from '@/lib/cancellation';
import { cancellationPosition } from '@/lib/cancellationView';
import { londonDayKey, daysBetweenKeys, ukLongDate } from '@/lib/dayKey';
import { liveForGuestCard, stayCountdown } from '@/lib/bookingWindows';
import { bookingReleasesPrivateData } from '@/lib/bookingEntitlement';
import { adminClient } from '@/lib/supabaseAdmin';
import { publicArea } from '@/lib/places';
import ListingImage from '@/components/ListingImage';
import CheckInOutTimes from '@/components/arrival/CheckInOutTimes';
import CopyField from '@/components/arrival/CopyField';
import { MessageSquare, CalendarDays, Navigation, Grid3x3 } from 'lucide-react';

// Shown at the top of the home page to someone with a stay coming up. The
// point is that a guest logging in six weeks before their holiday sees their
// holiday, not a search box they've already used.
export default async function UpcomingTrip() {
    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getSession();

    if (!auth || !auth.session || !auth.session.user) return null;

    const now = new Date();

    // Candidates only: confirmed or pending, nearest first. Which one still
    // counts as a trip is lib/bookingWindows' call, not this card's — it used to
    // be a `check_out >= todayKey` filter here, where todayKey was local midnight
    // run through toISOString, and that slips a day under BST: a stay that
    // checked out yesterday survived the filter and showed as "-3 days to go".
    const { data: bookings } = await supabase
        .from('bookings')
        .select('id, listing_id, check_in, check_out, status, guests, amount_paid, amount_refunded, cleaning_fee')
        .eq('guest_id', auth.session.user.id)
        .in('status', ['confirmed', 'pending'])
        .order('check_in', { ascending: true })
        .limit(10);

    const booking = (bookings || []).find((b) => liveForGuestCard(b, now));
    if (!booking) return null;

    const { data: listing } = await supabase
        .from('listings')
        .select('id, title, location, images, check_in_time, check_in_end_time, check_out_time, cancellation_policy')
        .eq('id', booking.listing_id)
        .maybeSingle();

    if (!listing) return null;

    // Arrival essentials for the times box — the address behind Get directions
    // and the what3words — but ONLY for a CONFIRMED stay. A pending request is
    // not entitled to private location data (the same bookingReleasesPrivateData
    // rule as /api/trips and the arrival page), so its card shows the times
    // alone. Read under the service role because what3words lives in the
    // grant-less listing_arrival table.
    let directionsUrl: string | null = null;
    let what3words: string | null = null;
    if (bookingReleasesPrivateData(booking)) {
        const admin = adminClient();
        const [{ data: place }, { data: arr }] = await Promise.all([
            admin.from('listings').select('street_address, postcode, location, latitude, longitude').eq('id', booking.listing_id).maybeSingle(),
            admin.from('listing_arrival').select('what3words').eq('listing_id', booking.listing_id).maybeSingle(),
        ]);
        const p: any = place || {};
        what3words = (arr as any)?.what3words || null;
        const hasCoords = p.latitude != null && p.longitude != null && !(p.latitude === 0 && p.longitude === 0);
        const addressString = [p.street_address, p.postcode, p.location].filter(Boolean).join(', ');
        if (hasCoords || addressString) {
            const dest = hasCoords ? p.latitude + ',' + p.longitude : encodeURIComponent(addressString);
            directionsUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + dest;
        }
    }

    const nights = Math.round(
        (new Date(String(booking.check_out).slice(0, 10)).getTime()
            - new Date(String(booking.check_in).slice(0, 10)).getTime()) / 86400000,
    );

    // The bit that does the work. Everything else on this card is detail. The
    // phase comes from the shared module, so the copy can read like a person
    // wrote it and never prints a negative day count.
    const { phase, daysUntilCheckIn } = stayCountdown(booking, now);
    const headline =
        phase === 'during' ? 'You’re there now'
            : phase === 'today' ? 'Arrives today'
                : phase === 'tomorrow' ? 'Arrives tomorrow'
                    : daysUntilCheckIn + ' days to go';

    // One place works out the cancellation position now — the same one the
    // Cancel screen and the messages pane read — so the card can never promise a
    // free cancellation the cancel flow would charge for. Only worth showing
    // while it is still free; once the window closes, saying so on the home page
    // would be a poke rather than a reassurance.
    const cancel = cancellationPosition({
        checkIn: booking.check_in,
        policy: listing.cancellation_policy,
        amountPaid: booking.amount_paid,
        alreadyRefunded: booking.amount_refunded,
        cleaningFee: (booking as any).cleaning_fee,
        on: now,
    });
    const freeUntilKey = cancel.kind === 'free' ? cancel.freeUntilKey : null;
    const freeDaysLeft = freeUntilKey
        ? daysBetweenKeys(londonDayKey(now), freeUntilKey)
        : 0;

    const homeHref = '/homes/' + booking.listing_id;

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
                {/* The listing, shown the way Our Properties shows it and clickable
                    through to the listing page — photo, title, place. The seed
                    cottages have no photo, so ListingImage draws a composed empty
                    state rather than a broken box. */}
                <Link
                    href={homeHref}
                    className="group relative md:w-2/5 lg:w-1/3 h-56 md:h-auto md:min-h-[20rem] flex-shrink-0 block bg-stone-200"
                >
                    <ListingImage
                        images={listing.images}
                        alt={listing.title}
                        sizes="(max-width: 768px) 100vw, 420px"
                        className="object-cover transition duration-300 group-hover:scale-105"
                        priority
                    />
                </Link>

                <div className="p-8 md:p-10 flex-1 flex flex-col justify-center">
                    {/* The countdown is the reason anyone looks at this, so it
                        gets the room. Everything else is supporting detail. */}
                    <div className="text-4xl md:text-5xl font-bold text-stone-900 tracking-tight">
                        {headline}
                    </div>

                    <div className="mt-6 space-y-1">
                        <Link href={homeHref} className="text-lg font-semibold text-stone-900 hover:underline">
                            {listing.title}
                        </Link>
                        {listing.location && (
                            <div className="text-stone-500">{publicArea(listing.location)}</div>
                        )}
                    </div>

                    <div className="mt-5 pt-5 border-t border-stone-100 text-stone-700">
                        <div className="font-medium">
                            {formatUk(new Date(booking.check_in))} &rarr; {formatUk(new Date(booking.check_out))}
                        </div>
                        <div className="text-sm text-stone-500 mt-1">
                            {nights} {nights === 1 ? 'night' : 'nights'}
                            {booking.guests
                                ? ' · ' + booking.guests + (booking.guests === 1 ? ' guest' : ' guests')
                                : ''}
                        </div>
                    </div>

                    {/* The times, as a matched pair — times only, because the
                        date range and the nights already sit right above. The
                        freed right half carries the one thing this card didn't
                        have: Get directions and the what3words, the essentials a
                        guest wants at a glance on the morning they set off. Two
                        columns on wide screens; stacked below lg. */}
                    <div className="mt-5">
                        <CheckInOutTimes
                            surface="home"
                            mode="split"
                            checkInTime={listing.check_in_time}
                            checkOutTime={listing.check_out_time}
                            aside={(directionsUrl || what3words) ? (
                                <div className="flex h-full flex-col justify-center gap-2.5">
                                    {directionsUrl && (
                                        <a href={directionsUrl} target="_blank" rel="noreferrer"
                                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-stone-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800">
                                            <Navigation className="h-4 w-4" /> Get directions
                                        </a>
                                    )}
                                    {what3words && (
                                        <div className="flex items-center gap-2">
                                            <Grid3x3 className="h-4 w-4 flex-none text-emerald-700" />
                                            <span className="min-w-0 truncate text-sm text-emerald-700">{what3words}</span>
                                            <CopyField value={what3words} label="Copy" />
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        />
                    </div>

                    {/* A link, not a label. Somebody reading this line is
                        usually reading it because they are wondering whether
                        to cancel, and the answer to that was three screens
                        away. It opens the same confirmation panel on /trips
                        that the Cancel booking link there opens — the one
                        place that says what the refund would actually be. */}
                    {freeUntilKey && (
                        <div className="mt-5 text-sm">
                            <Link
                                href={'/trips?cancel=' + booking.id + '#trip-' + booking.id}
                                className={
                                    'underline underline-offset-2 hover:no-underline ' +
                                    (freeDaysLeft <= 3 ? 'text-amber-700' : 'text-emerald-700')
                                }
                            >
                                Free cancellation until {ukLongDate(freeUntilKey)}
                            </Link>
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
