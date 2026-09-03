'use client';

import TripGroup from '@/components/TripGroup';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { MessageCircle, Navigation, MapPin, Grid3x3, ArrowLeft, CornerDownRight, Car, KeyRound, Phone, CloudOff } from 'lucide-react';
import CopyField from '@/components/arrival/CopyField';
import CheckInOutTimes from '@/components/arrival/CheckInOutTimes';
import ExperiencesTeaser from '@/components/ExperiencesTeaser';
import { getImageUrl, capitializeFirst, displayName } from '@/lib/utils';
import { checkInMethodTitle, checkInBlurb } from '@/lib/checkInMethods';
import Link from 'next/link';
import { cancellationPosition } from '@/lib/cancellationView';
import { ukLongDate, londonDayKey } from '@/lib/dayKey';
import { upcomingUntilCheckout, liveForGuestCard, stayCountdown } from '@/lib/bookingWindows';

interface Booking {
    id: string;
    listing_id: string;
    host_id: string;
    check_in: string;
    check_out: string;
    status: string;
    total_price: number;
    payment_status: string | null;
    balance_amount: number | null;
    balance_due_date: string | null;
    amount_paid: number | null;
    amount_refunded: number | null;
    // True when someone else booked it and added this person along.
    guests?: number | null;
    sharedWithMe?: boolean;
    // Card-safe arrival detail from /api/trips — the whole approach now lives on
    // the card: address and map point, times, what3words, the host's "last bit"
    // directions, parking, how you get in (the method, not the code) and the
    // host's phone. The door code and wifi password never come down: hasCode and
    // hasWifi are booleans that say a secret exists to reveal on Getting-there.
    arrival?: {
        addressLines: string[];
        addressString: string;
        lat: number | null;
        lng: number | null;
        checkInTime: string | null;
        checkInEndTime: string | null;
        checkOutTime: string | null;
        what3words: string | null;
        arrivalDirections: string | null;
        parking: string | null;
        checkInMethod: string | null;
        hasCode: boolean;
        hasWifi: boolean;
        hostPhone: string | null;
    } | null;
}

export default function TripsPage() {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [listingMap, setListingMap] = useState<Record<string, any>>({});
    const [hostNames, setHostNames] = useState<Record<string, string>>({});
    const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());
    const [payingId, setPayingId] = useState<string | null>(null);
    const [payError, setPayError] = useState('');
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    const [cancelError, setCancelError] = useState('');

    const cancelBooking = async (bookingId: string) => {
        setCancelError('');
        setCancellingId(bookingId);
        try {
            const res = await fetch('/api/bookings/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: bookingId }),
            });
            const data = await res.json();

            if (data && data.ok) {
                setBookings((prev) =>
                    prev.map((b) =>
                        b.id === bookingId
                            ? { ...b, status: 'cancelled', balance_amount: 0 }
                            : b
                    )
                );
                setConfirmingId(null);
            } else {
                setCancelError((data && data.error) || 'Could not cancel. Please try again.');
            }
        } catch (err) {
            setCancelError('Could not cancel. Please try again.');
        }
        setCancellingId(null);
    };

    // Sends the guest to Stripe to settle what's left on a booking. Reached
    // either from the button below or from the link in a payment reminder
    // email, which arrives as ?pay=<booking id>.
    const payBalance = async (bookingId: string) => {
        setPayError('');
        setPayingId(bookingId);
        try {
            const res = await fetch('/api/stripe/balance-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: bookingId }),
            });
            const data = await res.json();
            if (data && data.ok && data.url) {
                window.location.href = data.url;
                return;
            }
            setPayError((data && data.error) || 'Could not open the payment page. Please try again.');
        } catch (err: any) {
            setPayError('Could not open the payment page. Please try again.');
        }
        setPayingId(null);
    };

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (!session?.user) {
                setLoading(false);
                return;
            }

            // Fetched on the server so trips shared with this person come
            // through too — and so the money is stripped out of those before
            // it ever reaches the browser.
            const tripsRes = await fetch('/api/trips');
            // Typed here because it arrives as JSON, so TypeScript can't work
            // out its shape the way it does from a Supabase query.
            const bookingRows: Booking[] = tripsRes.ok
                ? ((await tripsRes.json()).trips || [])
                : [];
            setBookings(bookingRows);

            const listingIds = Array.from(new Set((bookingRows || []).map((b) => b.listing_id)));
            if (listingIds.length) {
                const { data: listings } = await supabase
                    .from('listings')
                    .select('id, title, images, cancellation_policy, check_in_time, check_in_end_time, check_out_time')
                    .in('id', listingIds);
                const map: Record<string, any> = {};
                (listings || []).forEach((l) => { map[l.id] = l; });
                setListingMap(map);
            }

            // Arrived from a payment reminder email — go straight to Stripe.
            if (typeof window !== 'undefined') {
                const params = new URLSearchParams(window.location.search);

                const wanted = params.get('pay');
                const target = (bookingRows || []).filter(function (b) { return b.id === wanted; })[0];
                if (target && target.payment_status === 'deposit_paid') {
                    payBalance(target.id);
                }

                // Arrived from the free-cancellation line on the home page
                // card. Open the confirmation panel for that booking rather
                // than making them find it again, but open the panel only —
                // nothing is cancelled until they press the button in it.
                const toCancel = params.get('cancel');
                const cancelTarget = (bookingRows || []).filter(function (b) {
                    return b.id === toCancel;
                })[0];

                if (
                    cancelTarget
                    && !cancelTarget.sharedWithMe
                    && cancelTarget.status !== 'cancelled'
                    && cancelTarget.status !== 'declined'
                ) {
                    setConfirmingId(cancelTarget.id);
                }
            }

            const hostIds = Array.from(new Set((bookingRows || []).map((b) => b.host_id)));
            if (hostIds.length) {
                const { data: hosts } = await supabase.from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', hostIds);
                const names: Record<string, string> = {};
                (hosts || []).forEach((h) => { names[h.id] = displayName(h, 'Host'); });
                setHostNames(names);
            }

            const { data: myReviews } = await supabase
                .from('reviews')
                .select('booking_id')
                .eq('reviewer_id', session.user.id)
                .eq('review_type', 'guest_to_host');
            setReviewedBookingIds(new Set((myReviews || []).map((r) => r.booking_id)));

            setLoading(false);
        };
        load();
    }, [supabase]);

    // The card named in the address only exists once the trips have loaded,
    // so the browser's own jump to #trip-… has been and gone by the time
    // there is anything to jump to.
    useEffect(() => {
        if (loading) return;

        const hash = window.location.hash;
        if (!hash) return;

        const card = document.getElementById(hash.slice(1));
        if (card) card.scrollIntoView({ block: 'start' });
    }, [loading]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
                <Logo />
                <p className="text-slate-500 animate-pulse">Loading your trips...</p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-6 text-center px-4">
                <Logo />
                <h1 className="text-2xl font-bold text-slate-900">Sign in to see your trips</h1>
                <LoginModel />
            </div>
        );
    }

    const today = new Date();
    const statusStyles: Record<string, string> = {
        confirmed: 'bg-green-100 text-green-800',
        pending: 'bg-amber-100 text-amber-800',
        declined: 'bg-slate-100 text-slate-500',
        cancelled: 'bg-slate-100 text-slate-500',
    };

    // Upcoming means a stay that could still happen: not cancelled, not turned
    // down, and not already over. Everything else is history, including a
    // booking cancelled for dates that have not arrived yet — those dates are
    // gone and it is not a trip any more.
    //
    // "Over" is the exact negative of liveForGuestCard, the same test the home
    // card uses, so the two screens agree. It used to be `new Date(check_out) <
    // today` — an instant compare, where check-out's UTC midnight is 01:00 BST,
    // so a stay checking out today was filed under "Past trips" from 01:00 on
    // the last morning while the home card still said "You're there now". The
    // London calendar day keeps it upcoming through the whole checkout day.
    const isOver = (b: Booking) => !liveForGuestCard(b, today);

    // Nearest first at the top, so the next stay is the first thing read.
    const upcoming = bookings
        .filter((b) => !isOver(b))
        .sort((a, b) => (a.check_in < b.check_in ? -1 : 1));

    // Most recent first below, so the stay just finished heads the old ones.
    const past = bookings
        .filter(isOver)
        .sort((a, b) => (a.check_out > b.check_out ? -1 : 1));

    // Same test as the menu and the passport page itself: a confirmed booking
    // of your own whose check-out has been and gone. Dates are compared as
    // strings so a stay checking out this morning is still today's, the way
    // the passport query reads it.
    //
    // A trip somebody else booked and added you to earns no stamp, so it does
    // not unlock the link either.
    const todayIso = londonDayKey();
    const hasCompletedStay = bookings.some(
        (b) => !b.sharedWithMe && b.status === 'confirmed' && b.check_out < todayIso
    );

    // One trip card. It is rendered from two lists now, so it lives in a
    // function rather than inline in a single map.
    const renderTrip = (b: Booking) => {
        const listing = listingMap[b.listing_id];
        // Completed drives the review prompt, so it uses the same London-day
        // "over" test — a stay is not "completed" while the guest is still on it
        // on checkout day.
        const isCompleted = b.status === 'confirmed' && isOver(b);
        const alreadyReviewed = reviewedBookingIds.has(b.id);

        const upcomingConfirmed = upcomingUntilCheckout(b, today);
        const arr = b.arrival || null;
        const homeHref = `/homes/${b.listing_id}`;
        const hostName = capitializeFirst(hostNames[b.host_id] || 'your host');

        // Directions point at the REAL pin, or the full address for the maps app
        // to geocode — never a partial address, which with only a town would send
        // the guest to the town centre. This is the same rule the Getting-there
        // page used; it moves here with the button.
        const hasCoords = !!arr && arr.lat != null && arr.lng != null && !(arr.lat === 0 && arr.lng === 0);
        const directionsUrl = arr && (arr.addressString || hasCoords)
            ? 'https://www.google.com/maps/dir/?api=1&destination='
                + (hasCoords ? arr.lat + ',' + arr.lng : encodeURIComponent(arr.addressString))
            : null;
        // A quiet phase chip, only for the moments that are actually worth a
        // word: they're on the stay, or it's today/tomorrow. Not a big
        // countdown — that's the home card's job as a single hero; on a LIST of
        // trips the date range already carries "when", and a "12 days to go" on
        // every card would be noise. But "You're there now" on the last morning
        // is the exact reassurance the trips-split fix is about, so it earns a
        // place where it applies. Same stayCountdown module as the home card.
        const countdown = upcomingConfirmed ? stayCountdown(b, today) : null;
        const phase = countdown?.phase ?? null;
        // The three-day reveal window — the same span the Getting-there page shows
        // the door code in. Inside it, the card links through to the way in;
        // outside it there is nothing yet to reveal and no link.
        const withinWindow = !!countdown && countdown.daysUntilCheckIn <= 3;
        const phaseChip =
            phase === 'during' ? 'You’re there now'
                : phase === 'today' ? 'Arrives today'
                    : phase === 'tomorrow' ? 'Arrives tomorrow'
                        : null;
        const fmtDay = (s: string) => {
            const d = new Date(s);
            return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        };

        return (
            // Named so the link from the home page card lands on this trip
            // rather than at the top of a list of them.
            <div key={b.id} id={'trip-' + b.id} className="border rounded-2xl p-5 scroll-mt-6">
                {/* Single column: the right column existed only for the
                    per-booking experiences panel, which is behind its flag and
                    now teased once at the page level, so the card is full width
                    rather than a wide half-empty two-up. When experiences launch,
                    the per-booking panel returns as the right column. */}
                <div className="flex items-start gap-4">
                    <Link href={homeHref} className="relative block w-16 h-16 rounded-xl overflow-hidden bg-slate-200 flex-shrink-0">
                        {listing?.images?.[0] && (
                            <Image src={getImageUrl(listing.images[0])} alt={listing.title} fill sizes="64px" className="object-cover" />
                        )}
                    </Link>
                    <div className="flex-1 min-w-0">
                        <Link href={homeHref} className="font-semibold text-slate-900 hover:underline break-words">{listing?.title || 'Listing'}</Link>
                        <div className="text-sm text-slate-600">
                            Hosted by {capitializeFirst(hostNames[b.host_id] || 'Host')} · {fmtDay(b.check_in)} – {fmtDay(b.check_out)}
                        </div>
                        {b.sharedWithMe ? (
                            <div className="text-sm text-slate-400">
                                {b.guests ? b.guests + (b.guests === 1 ? ' guest' : ' guests') : 'Shared with you'}
                            </div>
                        ) : (
                            <div className="text-sm font-medium text-slate-700">£{b.total_price}</div>
                        )}
                        {phaseChip && (
                            <div className="mt-1.5">
                                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                                    {phaseChip}
                                </span>
                            </div>
                        )}
                    </div>
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize flex-shrink-0 ${statusStyles[b.status] || 'bg-slate-100 text-slate-600'}`}>
                        {b.status}
                    </span>
                </div>

                {/* The whole approach, on the card. This used to be a thin
                    summary that linked THROUGH to a near-identical "Getting there"
                    card; the two said the same thing twice. Everything non-secret
                    now lives here — where, the last bit, the times, how you get
                    in, parking, the contact block, the offline promise — and
                    "Getting there" is reduced to the two things that must not sit
                    on a card a guest might leave open on a train: the door code
                    and the wifi password, revealed only in their own window. */}
                {upcomingConfirmed && arr && (
                    <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                        {/* Where, and how to get there */}
                        <div>
                            <div className="flex gap-2">
                                <MapPin className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                                <div className="min-w-0">
                                    {arr.addressLines.length
                                        ? arr.addressLines.map((line, i) => (
                                            <div key={i} className={i === 0 ? 'text-sm font-medium text-slate-900' : 'text-sm text-slate-600'}>{line}</div>
                                        ))
                                        : <div className="text-sm text-slate-500">Ask {hostName} for the address in the messages.</div>}
                                </div>
                            </div>
                            {arr.what3words && (
                                <div className="mt-2 flex items-center gap-2 pl-6">
                                    <Grid3x3 className="h-3.5 w-3.5 flex-none text-emerald-700" />
                                    <span className="text-sm text-emerald-700">{arr.what3words}</span>
                                    <CopyField value={arr.what3words} label="Copy" />
                                </div>
                            )}
                            {!hasCoords && arr.addressString && (
                                <p className="mt-2 pl-6 text-xs text-slate-400">No pin saved for this cottage yet — directions use the address.</p>
                            )}
                            {(directionsUrl || arr.addressString) && (
                                <div className="mt-2.5 grid grid-cols-2 gap-2">
                                    {directionsUrl && (
                                        <a href={directionsUrl} target="_blank" rel="noreferrer"
                                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
                                            <Navigation className="h-3.5 w-3.5" /> Get directions
                                        </a>
                                    )}
                                    {arr.addressString && <CopyField value={arr.addressString} label="Copy address" />}
                                </div>
                            )}
                        </div>

                        {/* The last bit — the host's own words for what sat-nav gets wrong */}
                        {arr.arrivalDirections && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                                    <CornerDownRight className="h-3.5 w-3.5" /> The last bit
                                </div>
                                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-amber-950">{arr.arrivalDirections}</p>
                            </div>
                        )}

                        {/* Check-in / checkout — a fact to read, not a door. Each
                            end pairs its date with its time on one line now. */}
                        <CheckInOutTimes
                            surface="trips"
                            mode="static"
                            checkInDate={b.check_in}
                            checkOutDate={b.check_out}
                            checkInTime={arr.checkInTime}
                            checkOutTime={arr.checkOutTime}
                            checkInEndTime={arr.checkInEndTime}
                        />

                        {/* Getting in — the SIGNAL, never the secret. Inside the
                            window, if there is a code, it says so and links to
                            Getting there where the code lives. With no code but a
                            check-in method (not a secret — it is on the listing),
                            it shows the method plainly. With neither, it points at
                            the host rather than going quiet. */}
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                <KeyRound className="h-3.5 w-3.5" /> Getting in
                            </div>
                            {withinWindow && arr.hasCode ? (
                                <p className="mt-1 text-sm font-medium text-emerald-800">
                                    Your way in is ready.{' '}
                                    <span className="font-normal text-emerald-700">
                                        {arr.hasWifi ? 'Your door code and wifi are on the arrival screen.' : 'Your door code is on the arrival screen.'}
                                    </span>
                                </p>
                            ) : arr.hasCode ? (
                                <p className="mt-1 text-sm text-slate-500">Your way in appears here a few days before you arrive.</p>
                            ) : arr.checkInMethod ? (
                                <div className="mt-1">
                                    <div className="text-sm font-medium text-slate-900">{checkInMethodTitle(arr.checkInMethod)}</div>
                                    {checkInBlurb(arr.checkInMethod) && <div className="text-sm text-slate-600">{checkInBlurb(arr.checkInMethod)}</div>}
                                </div>
                            ) : (
                                <p className="mt-1 text-sm text-slate-500">{hostName} will let you know how to get in — send a message if you&apos;re not sure.</p>
                            )}
                            {withinWindow && (arr.hasCode || arr.hasWifi) && (
                                <Link href={`/arrival/${b.id}`} className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
                                    <Navigation className="h-3.5 w-3.5" /> Getting there
                                </Link>
                            )}
                        </div>

                        {/* Parking, only if the host said */}
                        {arr.parking && (
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    <Car className="h-3.5 w-3.5" /> Parking
                                </div>
                                <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{arr.parking}</p>
                            </div>
                        )}

                        {/* Need a hand — the contact block, the moment you're
                            stuck outside. Call the host if there's a number, or
                            message either way. */}
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                <Phone className="h-3.5 w-3.5" /> Need a hand? Ask {hostName}
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                                {arr.hostPhone ? (
                                    <a href={'tel:' + arr.hostPhone} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800">
                                        <Phone className="h-3.5 w-3.5" /> Call
                                    </a>
                                ) : <span />}
                                <Link href={`/messages/${b.id}`} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400">
                                    <MessageCircle className="h-3.5 w-3.5" /> Message
                                </Link>
                            </div>
                        </div>

                        {/* The offline promise moves here with the arrival detail:
                            this is now the screen a guest opens before setting off
                            down a track with no signal. */}
                        <p className="flex items-center justify-center gap-1.5 pt-0.5 text-center text-[11px] text-slate-400">
                            <CloudOff className="h-3.5 w-3.5" /> Signal&apos;s patchy out here — open this before you set off and it stays put.
                        </p>
                    </div>
                )}

                {/* Message host stays a plain action for bookings with no arrival
                    detail on show — a pending request, a past stay. For an
                    upcoming confirmed stay the contact block above already carries
                    it (with Call), so it is not repeated. */}
                {!upcomingConfirmed && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Link href={`/messages/${b.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400">
                            <MessageCircle className="h-3.5 w-3.5" /> Message host
                        </Link>
                    </div>
                )}

                {b.sharedWithMe ? (
                    <p className="text-xs text-slate-400 mt-3">
                        You were added to this trip. Whoever booked it looks after
                        the payment and any changes.
                    </p>
                ) : (
                    b.status !== 'cancelled'
                        && b.status !== 'declined'
                        && <TripGroup bookingId={b.id} />
                )}

                {!b.sharedWithMe && b.payment_status === 'deposit_paid'
                    && Number(b.balance_amount || 0) > 0
                    && b.status !== 'cancelled'
                    && b.status !== 'declined' && (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <div className="text-sm font-semibold text-amber-900">
                            £{Number(b.balance_amount).toFixed(2)} still to pay
                        </div>
                        <p className="text-xs text-amber-800 mt-0.5">
                            {b.balance_due_date
                                ? 'This is taken from your card automatically on ' + b.balance_due_date + '. You can pay it sooner if you prefer.'
                                : 'You can settle this at any time.'}
                        </p>
                        <button
                            type="button"
                            onClick={() => payBalance(b.id)}
                            disabled={payingId === b.id}
                            className="mt-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
                        >
                            {payingId === b.id ? 'Opening payment…' : 'Pay the balance now'}
                        </button>
                        {payError && payingId === null && (
                            <p className="text-xs text-red-600 mt-2">{payError}</p>
                        )}
                    </div>
                )}

                {!b.sharedWithMe
                    && b.status !== 'cancelled'
                    && b.status !== 'declined'
                    && new Date(b.check_in) > today && (() => {
                    // Where this cancellation stands, worked out once, by the
                    // same function the Cancel screen, the home card and the
                    // messages pane read — so no two of them can tell the guest
                    // a different story. `amount` is exactly what
                    // /api/bookings/cancel will refund when the button is
                    // pressed; it used to be the sum written out again here,
                    // which is how a guest gets shown one figure and refunded
                    // another.
                    const cancel = cancellationPosition({
                        checkIn: b.check_in,
                        policy: listing?.cancellation_policy,
                        amountPaid: b.amount_paid,
                        alreadyRefunded: b.amount_refunded,
                        cleaningFee: (b as any).cleaning_fee,
                        on: today,
                    });
                    const paidSoFar = cancel.paidSoFar;
                    const refund = cancel.amount;

                    if (confirmingId !== b.id) {
                        // The position, under the Cancel link — a fact, not a
                        // warning. Free reads in the emerald used for confirmed;
                        // the paid-refund states are plain text, because red on a
                        // confirmed booking reads as something having gone wrong
                        // with the booking rather than a fact about the policy.
                        const position =
                            cancel.kind === 'free' && cancel.freeUntilKey
                                ? { emerald: true, text: 'Free to cancel until ' + ukLongDate(cancel.freeUntilKey) + '.' }
                                : paidSoFar <= 0
                                    ? { emerald: false, text: 'You haven’t paid for this stay yet, so there’s nothing to lose by cancelling.' }
                                    : refund >= paidSoFar
                                        ? { emerald: false, text: 'You’d get your full £' + paidSoFar.toFixed(2) + ' back if you cancel.' }
                                        : refund > 0
                                            ? { emerald: false, text: '£' + refund.toFixed(2) + ' of the £' + paidSoFar.toFixed(2) + ' you’ve paid comes back if you cancel.' }
                                            : { emerald: false, text: 'These dates are non-refundable — the £' + paidSoFar.toFixed(2) + ' you’ve paid stays with the host if you cancel.' };

                        return (
                            // Set apart from the actions above by a divider —
                            // cancelling is the opposite intention to "add the
                            // people coming with you" and should not sit flush
                            // against it.
                            <div className="mt-5 border-t border-slate-100 pt-4">
                                <button
                                    type="button"
                                    onClick={() => { setConfirmingId(b.id); setCancelError(''); }}
                                    className="text-xs font-semibold text-slate-500 underline hover:text-slate-800"
                                >
                                    Cancel booking
                                </button>
                                <p className={'text-xs mt-1 ' + (position.emerald ? 'text-emerald-700' : 'text-slate-500')}>
                                    {position.text}
                                </p>
                            </div>
                        );
                    }

                    return (
                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-semibold text-slate-900">
                                Cancel this booking?
                            </div>
                            <p className="text-sm text-slate-600 mt-1">
                                {paidSoFar <= 0
                                    ? 'You haven’t paid anything for this stay, so there’s nothing to refund.'
                                    : refund >= paidSoFar
                                        ? 'You’ll get your full £' + paidSoFar.toFixed(2) + ' back to your card, usually within five to ten days.'
                                    : refund > 0
                                        ? 'You’ll get £' + refund.toFixed(2) + ' of the £' + paidSoFar.toFixed(2) + ' you’ve paid back to your card, usually within five to ten days.'
                                        : 'These dates are inside the non-refundable period for this place, so no refund is due on the £' + paidSoFar.toFixed(2) + ' you’ve paid.'}
                            </p>
                            <p className="text-xs text-slate-500 mt-2">
                                The dates will be released for someone else, and this can’t be undone.
                            </p>

                            {cancelError && (
                                <p className="text-xs text-red-600 mt-2">{cancelError}</p>
                            )}

                            <div className="mt-3 flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => cancelBooking(b.id)}
                                    disabled={cancellingId === b.id}
                                    className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
                                >
                                    {cancellingId === b.id ? 'Cancelling…' : 'Yes, cancel it'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmingId(null)}
                                    className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                                >
                                    Keep my booking
                                </button>
                            </div>
                        </div>
                    );
                })()}

                {isCompleted && !alreadyReviewed && (() => {
                    // Reviews close 14 days after check-out.
                    const deadline = new Date(b.check_out);
                    deadline.setDate(deadline.getDate() + 14);
                    const daysLeft = Math.ceil((deadline.getTime() - today.getTime()) / 86400000);

                    if (daysLeft < 0) {
                        return (
                            <p className="text-xs text-slate-400 mt-4">
                                The review window for this stay has closed.
                            </p>
                        );
                    }

                    return (
                        <div className="mt-4 flex items-center gap-3">
                            <Link
                                href={`/review/${b.id}`}
                                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition"
                            >
                                Leave a review
                            </Link>
                            <span className={`text-xs ${daysLeft <= 3 ? 'text-amber-700 font-medium' : 'text-slate-400'}`}>
                                {daysLeft === 0 ? 'Last day' : `${daysLeft} days left`}
                            </span>
                        </div>
                    );
                })()}
                {isCompleted && alreadyReviewed && (
                    <p className="text-xs text-slate-400 mt-3">You've reviewed this stay.</p>
                )}
            </div>
        );
    };

    return (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
            {/* Back to the home page, mirroring the "← Your trips" link at the
                top of Getting there so the two screens match in direction and
                styling. */}
            <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 mb-4"
            >
                <ArrowLeft className="h-4 w-4" /> Home
            </Link>
            <div className="flex items-baseline justify-between gap-4 flex-wrap mb-8">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Your trips</h1>
                {hasCompletedStay && (
                    <Link
                        href="/passport"
                        className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 underline"
                    >
                        Your passport
                    </Link>
                )}
            </div>

            {bookings.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">No trips yet</h3>
                    <p className="text-slate-500 mt-1">Once you book a stay, it'll show up here.</p>
                </div>
            ) : (
                <>
                    {upcoming.length > 0 ? (
                        <div className="space-y-4">
                            {upcoming.map(renderTrip)}
                        </div>
                    ) : (
                        <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
                            <h3 className="text-lg font-semibold text-slate-800">Nothing booked at the moment</h3>
                            <p className="text-slate-500 mt-1">Your past trips are below.</p>
                        </div>
                    )}

                    {past.length > 0 && (
                        <div className="mt-12">
                            <h2 className="text-lg font-semibold text-slate-900 mb-4">Past trips</h2>
                            <div className="space-y-4">
                                {past.map(renderTrip)}
                            </div>
                        </div>
                    )}

                    {/* The experiences teaser, once for the whole page rather
                        than repeated in every card's right column. The flag it
                        reads is global, so any booking id answers it. */}
                    <ExperiencesTeaser bookingId={bookings[0].id} />
                </>
            )}
        </div>
    );
}
