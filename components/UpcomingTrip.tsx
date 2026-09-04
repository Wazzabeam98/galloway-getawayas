import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { formatUk } from '@/lib/cancellation';
import { cancellationPosition } from '@/lib/cancellationView';
import { londonDayKey, daysBetweenKeys } from '@/lib/dayKey';
import { liveForGuestCard, stayCountdown } from '@/lib/bookingWindows';
import { bookingReleasesPrivateData } from '@/lib/bookingEntitlement';
import { adminClient } from '@/lib/supabaseAdmin';
import { directionsUrl as buildDirectionsUrl } from '@/lib/directions';
import { publicArea } from '@/lib/places';
import ListingImage from '@/components/ListingImage';
import CheckInOutTimes from '@/components/arrival/CheckInOutTimes';
import CopyField from '@/components/arrival/CopyField';
import TripGroup from '@/components/TripGroup';
import HomeCancelPanel from '@/components/HomeCancelPanel';
import GuestExperiences from '@/components/GuestExperiences';
import { MessageSquare, CalendarDays, Navigation, Grid3x3, KeyRound } from 'lucide-react';

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
        .select('id, listing_id, check_in, check_out, status, payment_status, guests, amount_paid, amount_refunded, cleaning_fee')
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

    // The guest's own confirmed experiences for this stay, so the in-place cancel
    // confirm can name what a stay-cancel takes with it (the same list the trips
    // card shows). Their own rows, read under RLS.
    const { data: myOrders } = await supabase
        .from('service_orders')
        .select('item_name, service_date')
        .eq('booking_id', booking.id)
        .eq('guest_id', auth.session.user.id)
        .eq('status', 'confirmed');
    const cancelOrders = (myOrders || []).map((o: any) => ({ item_name: o.item_name, service_date: o.service_date }));

    // Arrival essentials for the times box — the address behind Get directions
    // and the what3words — but ONLY for a CONFIRMED stay. A pending request is
    // not entitled to private location data (the same bookingReleasesPrivateData
    // rule as /api/trips and the arrival page), so its card shows the times
    // alone. Read under the service role because what3words lives in the
    // grant-less listing_arrival table.
    let directionsUrl: string | null = null;
    let what3words: string | null = null;
    let addressToCopy: string | null = null;
    let hasCode = false;
    if (bookingReleasesPrivateData(booking)) {
        const admin = adminClient();
        const [{ data: place }, { data: arr }, { data: access }] = await Promise.all([
            admin.from('listings').select('street_address, postcode, location, latitude, longitude').eq('id', booking.listing_id).maybeSingle(),
            admin.from('listing_arrival').select('what3words').eq('listing_id', booking.listing_id).maybeSingle(),
            // EXISTENCE ONLY — never the code value. Selecting 'code' would pull
            // the secret into this request and into the card's data. The card is
            // a signal; the code itself shows only on the arrival page.
            admin.from('listing_access_codes').select('listing_id').eq('listing_id', booking.listing_id).maybeSingle(),
        ]);
        const p: any = place || {};
        what3words = (arr as any)?.what3words || null;
        hasCode = !!access;
        // The FULL street address and postcode for Copy address — never the
        // town on its own, which sends a guest to the wrong end of a village.
        addressToCopy = [p.street_address, p.postcode]
            .map((s: any) => String(s || '').trim())
            .filter(Boolean)
            .join(', ') || null;
        // Shared rule: a pin, or a STREET address — never the town alone.
        directionsUrl = buildDirectionsUrl({
            latitude: p.latitude, longitude: p.longitude,
            streetAddress: p.street_address, postcode: p.postcode, location: p.location,
        });
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

    // The door code stays off this card and out of /api/trips. This is the only
    // thing the card knows about it: a code is on file AND its reveal window has
    // opened (<= 3 days, the same window the arrival page uses). When both are
    // true the card says the way in is ready and links through — signal only.
    const wayInReady = hasCode && daysUntilCheckIn <= 3;

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

    // The card's content, one block each, so the two layouts below arrange the
    // SAME pieces — nothing added or removed between them.
    const photoEl = (
        <Link href={homeHref}
            className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-stone-200 md:aspect-square">
            <ListingImage
                images={listing.images}
                alt={listing.title}
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover transition duration-300 group-hover:scale-105"
                priority
            />
        </Link>
    );

    const headlineEl = (
        <div className="text-4xl md:text-5xl font-bold text-stone-900 tracking-tight">{headline}</div>
    );

    const stayDetailsEl = (
        <>
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
        </>
    );

    const groupEl = (booking.status !== 'cancelled' && booking.status !== 'declined') ? (
        <div className="mt-4">
            <TripGroup
                bookingId={booking.id}
                guests={booking.guests}
                cottage={listing.title}
                when={formatUk(new Date(booking.check_in)) + ' → ' + formatUk(new Date(booking.check_out))}
            />
        </div>
    ) : null;

    const railEl = (
        <div className="mt-5">
            <CheckInOutTimes
                surface="home"
                mode="split"
                checkInDate={booking.check_in}
                checkOutDate={booking.check_out}
                checkInTime={listing.check_in_time}
                checkOutTime={listing.check_out_time}
                aside={(directionsUrl || what3words || wayInReady || addressToCopy) ? (
                    // A 2×2, like the arrival screen's row. Left column: what3words
                    // (with its Copy) and Get directions beneath it. Right column:
                    // the way-in signal and Copy address beneath it — so the two
                    // buttons sit side by side on one row, not one full-width slab.
                    // Below sm the two columns STACK into one (see note); nothing
                    // is squeezed into a half-width button.
                    <div className="grid grid-cols-1 items-stretch gap-x-4 gap-y-3 sm:grid-cols-2">
                        <div className="flex flex-col justify-between gap-2.5">
                            {what3words ? (
                                <div className="flex items-center gap-2">
                                    <Grid3x3 className="h-4 w-4 flex-none text-emerald-700" />
                                    {/* Wrap, don't truncate — the three words are
                                        the precise thing and must be readable in
                                        full even in the narrower column. */}
                                    <span className="min-w-0 flex-1 break-words text-sm text-emerald-700">{what3words}</span>
                                    <CopyField value={what3words} label="Copy" />
                                </div>
                            ) : <span aria-hidden="true" />}
                            {directionsUrl && (
                                <a href={directionsUrl} target="_blank" rel="noreferrer"
                                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800">
                                    <Navigation className="h-4 w-4" /> Get directions
                                </a>
                            )}
                        </div>
                        <div className="flex flex-col justify-between gap-2.5">
                            {wayInReady ? (
                                <Link href={'/arrival/' + booking.id}
                                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
                                    <KeyRound className="h-4 w-4 flex-none" /> Your way in is ready &rarr;
                                </Link>
                            ) : <span aria-hidden="true" />}
                            {addressToCopy && (
                                <CopyField value={addressToCopy} label="Copy address" block />
                            )}
                        </div>
                    </div>
                ) : null}
            />
        </div>
    );

    const cancelEl = freeUntilKey ? (
        <HomeCancelPanel
            bookingId={booking.id}
            checkIn={booking.check_in}
            policy={listing.cancellation_policy}
            amountPaid={booking.amount_paid}
            amountRefunded={booking.amount_refunded}
            cleaningFee={(booking as any).cleaning_fee}
            orders={cancelOrders}
            freeUntilKey={freeUntilKey}
            freeDaysLeft={freeDaysLeft}
        />
    ) : null;

    const actionsEl = (
        <div className="flex flex-wrap gap-3 mt-8">
            <Link href="/trips"
                className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition">
                <CalendarDays className="w-4 h-4" /> Your trip
            </Link>
            <Link href={'/messages/' + booking.id}
                className="inline-flex items-center gap-2 px-6 py-3 border border-stone-300 hover:border-stone-900 text-stone-800 text-sm font-semibold rounded-xl transition">
                <MessageSquare className="w-4 h-4" /> Message your host
            </Link>
        </div>
    );

    // Photo top-left, and the details beside it: headline, stay details, then the
    // group row directly under them — so the column beside the square photo is
    // filled rather than left hanging under the image. The rail and the actions
    // run full width below both.
    const card = (
        <div className="rounded-3xl border border-stone-200 bg-white p-6 md:p-8">
            <div className="md:flex md:items-start md:gap-8">
                <div className="mb-6 md:mb-0 md:w-1/4 md:flex-none">
                    {photoEl}
                </div>
                <div className="md:min-w-0 md:flex-1">
                    {headlineEl}
                    {stayDetailsEl}
                    {groupEl}
                </div>
            </div>
            <div>
                {railEl}
                {cancelEl}
                {actionsEl}
            </div>
        </div>
    );

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

            {card}

            {/* The guest experiences, below the trip — what's booked for the stay
                and a way into browsing more, the same panel the trips page carries,
                so the home page no longer has to send a guest to /trips to find
                any of it. It shows its own "coming soon" when the marketplace is
                closed, and nothing when there's neither a booking nor a provider. */}
            {booking.status !== 'cancelled' && booking.status !== 'declined' && (
                <div className="mt-8">
                    <GuestExperiences
                        bookingId={booking.id}
                        checkIn={booking.check_in}
                        checkOut={booking.check_out}
                        town={publicArea(listing.location)}
                    />
                </div>
            )}
        </section>
    );
}
