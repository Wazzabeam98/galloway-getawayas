'use client';

import TripGroup from '@/components/TripGroup';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { MessageCircle, MapPin, ArrowLeft, ArrowRight, CornerDownRight, Car, KeyRound, Phone, CloudOff, XCircle, ShieldCheck, LifeBuoy, Heart } from 'lucide-react';
import CopyField from '@/components/arrival/CopyField';
import DirectionsPicker from '@/components/arrival/DirectionsPicker';
import PropertyMap from '@/components/PropertyMap';
import { partyLabel, confirmationNumber, cancellationWords } from '@/lib/bookingDisplay';
import CheckInOutTimes from '@/components/arrival/CheckInOutTimes';
import CancelBookingConfirm from '@/components/CancelBookingConfirm';
import ExperiencesTeaser from '@/components/ExperiencesTeaser';
import GuestExperiences from '@/components/GuestExperiences';
import { publicArea } from '@/lib/places';
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
    // The party split, written at checkout and carried through /api/trips. Used
    // only for display ("3 adults · 1 child · 1 pet"); falls back to the guests
    // total where an older row has none.
    adults?: number | null;
    children?: number | null;
    pets?: number | null;
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
        directionsUrl: string | null;
        appleDirectionsUrl: string | null;
        hasCode: boolean;
        hasWifi: boolean;
        hostPhone: string | null;
        hostAvatar: string | null;
        hostBio: string | null;
    } | null;
}

// Marks content on the card that is not backed by real data yet, so a reviewer
// (and a real guest, on this preview) can tell at a glance what's a placeholder.
function PlaceholderTag() {
    return (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            Placeholder
        </span>
    );
}

export default function TripsPage() {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [listingMap, setListingMap] = useState<Record<string, any>>({});
    const [hostNames, setHostNames] = useState<Record<string, string>>({});
    const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());
    // The guest's confirmed experiences, per booking, so the cancel dialog can
    // name what the stay-cancel cascade will also cancel.
    const [ordersByBooking, setOrdersByBooking] = useState<Record<string, { item_name: string; service_date: string }[]>>({});
    const [payingId, setPayingId] = useState<string | null>(null);
    const [payError, setPayError] = useState('');
    // Which booking's cancel confirm is open. The confirm itself — the refund
    // figure, the experiences it names, the call to the cancel route — lives in
    // CancelBookingConfirm, shared with the home card.
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    // Which bookings have their payment breakdown expanded (under the Total).
    const [openBreakdown, setOpenBreakdown] = useState<Record<string, boolean>>({});

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
                    .select('id, title, images, location, cancellation_policy, check_in_time, check_in_end_time, check_out_time')
                    .in('id', listingIds);
                const map: Record<string, any> = {};
                (listings || []).forEach((l) => { map[l.id] = l; });
                setListingMap(map);
            }

            // The guest's confirmed experiences, grouped by booking — so the
            // cancel dialog can name what would be cancelled alongside the stay.
            const { data: myOrders } = await supabase
                .from('service_orders')
                .select('booking_id, item_name, service_date, status')
                .eq('guest_id', session.user.id)
                .eq('status', 'confirmed');
            const byBooking: Record<string, { item_name: string; service_date: string }[]> = {};
            (myOrders || []).forEach((o) => {
                if (!o.booking_id) return;
                (byBooking[o.booking_id] = byBooking[o.booking_id] || []).push({
                    item_name: o.item_name, service_date: o.service_date,
                });
            });
            setOrdersByBooking(byBooking);

            // Arrived from a payment reminder email — go straight to Stripe.
            if (typeof window !== 'undefined') {
                const params = new URLSearchParams(window.location.search);

                const wanted = params.get('pay');
                const target = (bookingRows || []).filter(function (b) { return b.id === wanted; })[0];
                if (target && target.payment_status === 'deposit_paid') {
                    payBalance(target.id);
                }

                // Note: we deliberately do NOT auto-open the cancel panel from a
                // ?cancel= parameter any more. The home card's free-cancel line
                // used to deep-link into a pre-opened panel, so a guest arrived
                // on top of the red "Yes, cancel it" button — one click from a
                // line that read like information. The home card now lands on
                // #trip-<id> with the panel closed; pressing "Cancel booking"
                // here is the deliberate act that opens it.
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
        const hostFirstName = hostName.split(' ')[0];

        // Payment figures — all off the booking row. Shown under the Total via a
        // "Show breakdown" toggle in the facts row (no separate section).
        const payNights = Math.max(1, Math.round((new Date(b.check_out).getTime() - new Date(b.check_in).getTime()) / 86400000));
        const payCleaning = Number((b as any).cleaning_fee || 0);
        const payPet = Number((b as any).pet_fee || 0);
        const payTotal = Number(b.total_price || 0);
        const payAccommodation = Math.max(0, payTotal - payCleaning - payPet);
        const payPaid = Number(b.amount_paid || 0);
        const payRefunded = Number(b.amount_refunded || 0);
        const payRemaining = Number(b.balance_amount || 0);
        const breakdownOpen = !!openBreakdown[b.id];

        // Directions are built server-side by the shared rule (lib/directions):
        // a real pin, or a STREET address — never the town alone, which would
        // drive the guest to the town centre. null means no safe destination, so
        // no button. hasCoords is only for the "no pin saved" note below.
        const hasCoords = !!arr && arr.lat != null && arr.lng != null && !(arr.lat === 0 && arr.lng === 0);
        const directionsUrl = arr?.directionsUrl || null;
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
            phase === 'during' ? 'You’re here'
                : phase === 'today' ? 'You arrive today'
                    : phase === 'tomorrow' ? 'You arrive tomorrow'
                        : null;
        const fmtDay = (s: string) => {
            const d = new Date(s);
            return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        };

        return (
            // Named so the link from the home page card lands on this trip
            // rather than at the top of a list of them.
            <div key={b.id} id={'trip-' + b.id} className="border border-slate-200 rounded-2xl p-6 scroll-mt-6">
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
                        <div className="text-sm text-slate-600 mt-0.5">
                            Hosted by {capitializeFirst(hostNames[b.host_id] || 'Host')} · {fmtDay(b.check_in)} – {fmtDay(b.check_out)}
                        </div>
                        {phaseChip && (
                            <div className="mt-2">
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

                {/* Trip facts — Who's coming leads, as its own labelled section
                    (Airbnb-style) rather than a bare "2 adults" under the price.
                    Confirmation and total sit beside it as the other booking facts;
                    a shared trip shows only who's coming, its money kept off it. */}
                <div className="mt-8 border-t border-slate-100 pt-6">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Who&apos;s coming</div>
                            <div className="mt-1 text-sm font-medium text-slate-900">
                                {partyLabel(b) || (b.sharedWithMe ? 'Shared with you' : '—')}
                            </div>
                        </div>
                        {!b.sharedWithMe && (
                            <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Confirmation</div>
                                <div className="mt-1 font-mono text-sm tracking-wide text-slate-900">{confirmationNumber(b.id)}</div>
                            </div>
                        )}
                        {!b.sharedWithMe && (
                            <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total</div>
                                <div className="mt-1 text-sm font-medium text-slate-900">£{b.total_price}</div>
                                {/* The payment breakdown lives here now — one
                                    underlined toggle under the Total, opening the
                                    figures in place. */}
                                <button
                                    type="button"
                                    onClick={() => setOpenBreakdown((s) => ({ ...s, [b.id]: !s[b.id] }))}
                                    className="mt-1 text-xs font-medium text-slate-500 underline hover:text-slate-800"
                                >
                                    {breakdownOpen ? 'Hide breakdown' : 'Show breakdown'}
                                </button>
                            </div>
                        )}
                    </div>
                    {!b.sharedWithMe && breakdownOpen && (
                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                            <div className="space-y-2 text-sm">
                                <div className="flex items-baseline justify-between text-slate-600">
                                    <span>Accommodation · {payNights} {payNights === 1 ? 'night' : 'nights'}</span>
                                    <span className="tabular-nums">£{payAccommodation.toFixed(2)}</span>
                                </div>
                                {payCleaning > 0 && (
                                    <div className="flex items-baseline justify-between text-slate-600">
                                        <span>Cleaning fee</span><span className="tabular-nums">£{payCleaning.toFixed(2)}</span>
                                    </div>
                                )}
                                {payPet > 0 && (
                                    <div className="flex items-baseline justify-between text-slate-600">
                                        <span>Pet fee</span><span className="tabular-nums">£{payPet.toFixed(2)}</span>
                                    </div>
                                )}
                                <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
                                    <span>Total</span><span className="tabular-nums">£{payTotal.toFixed(2)}</span>
                                </div>
                                <div className="flex items-baseline justify-between text-slate-600">
                                    <span>Paid so far</span><span className="tabular-nums">£{payPaid.toFixed(2)}</span>
                                </div>
                                {payRefunded > 0 && (
                                    <div className="flex items-baseline justify-between text-slate-600">
                                        <span>Refunded</span><span className="tabular-nums">£{payRefunded.toFixed(2)}</span>
                                    </div>
                                )}
                                {payRemaining > 0 && (
                                    <div className="flex items-baseline justify-between font-medium text-amber-800">
                                        <span>Still to pay{b.balance_due_date ? ' · due ' + b.balance_due_date : ''}</span>
                                        <span className="tabular-nums">£{payRemaining.toFixed(2)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Host — the human centre of the card: photo, name, their own
                    words, and Message + Call together. Booking direct with the
                    owner is the whole pitch, so this leads with the person rather
                    than a grey "Hosted by" line. Name is privacy-resolved on the
                    client; photo and bio come from the host's profile. */}
                {upcomingConfirmed && arr && (
                    <div className="mt-8 rounded-2xl border border-slate-200 p-6 sm:p-7">
                        <div className="flex items-center gap-4">
                            {arr.hostAvatar ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={getImageUrl(arr.hostAvatar)} alt={hostFirstName} className="h-14 w-14 flex-none rounded-full object-cover" />
                            ) : (
                                <div className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-emerald-100 text-lg font-semibold text-emerald-800">
                                    {hostFirstName.slice(0, 1).toUpperCase()}
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Your host</div>
                                <div className="mt-0.5 text-base font-semibold text-slate-900">{hostFirstName}</div>
                            </div>
                        </div>
                        <div className="mt-5 grid grid-cols-2 gap-2">
                            {arr.hostPhone ? (
                                <a href={'tel:' + arr.hostPhone} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800">
                                    <Phone className="h-4 w-4" /> Call
                                </a>
                            ) : <span />}
                            <Link href={`/messages/${b.id}`} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
                                <MessageCircle className="h-4 w-4" /> Message
                            </Link>
                        </div>
                    </div>
                )}

                {/* The group, right under the stay details — stacked avatars and
                    the seats still to fill, so a group booking reads as one before
                    anything is opened. Only the booker manages it. */}
                {!b.sharedWithMe && b.status !== 'cancelled' && b.status !== 'declined' && (
                    <div className="mt-8">
                        <TripGroup
                            bookingId={b.id}
                            guests={b.guests}
                            cottage={listing?.title}
                            when={fmtDay(b.check_in) + ' – ' + fmtDay(b.check_out)}
                        />
                    </div>
                )}

                {/* The whole approach, on the card. This used to be a thin
                    summary that linked THROUGH to a near-identical "Getting there"
                    card; the two said the same thing twice. Everything non-secret
                    now lives here — where, the last bit, the times, how you get
                    in, parking, the contact block, the offline promise — and
                    "Getting there" is reduced to the two things that must not sit
                    on a card a guest might leave open on a train: the door code
                    and the wifi password, revealed only in their own window. */}
                {upcomingConfirmed && arr && (
                    // The arrival essentials, grouped in one calm container: flat
                    // sections divided by hairlines with an even rhythm, rather
                    // than a stack of nested boxes packed tight against each other.
                    <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/50 p-6 sm:p-7">
                        <div className="divide-y divide-slate-200/70">
                            {/* Getting in — LEADS the group and is the ONE route to
                                the door code and wifi. One statement, one action:
                                inside the three-day window the whole panel is a
                                single link to the arrival screen (no popup); the
                                secrets never come down to this card or /api/trips
                                (hasCode/hasWifi are booleans). Outside it, or with a
                                check-in method / neither, it's a plain line. */}
                            <div className="py-6 first:pt-0 last:pb-0">
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    <KeyRound className="h-3.5 w-3.5" /> Getting in
                                </div>
                                {withinWindow && (arr.hasCode || arr.hasWifi) ? (
                                    <Link
                                        href={`/arrival/${b.id}`}
                                        className="group mt-3 flex items-center gap-3.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 transition hover:border-emerald-300 hover:bg-emerald-50"
                                    >
                                        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-emerald-600 text-white">
                                            <KeyRound className="h-5 w-5" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-semibold text-emerald-900">Access code</span>
                                            <span className="block text-xs text-emerald-700">View it on the arrival screen</span>
                                        </span>
                                        <ArrowRight className="h-5 w-5 flex-none text-emerald-600 transition group-hover:translate-x-0.5" />
                                    </Link>
                                ) : arr.hasCode ? (
                                    <p className="mt-2 text-sm text-slate-500">Your way in appears here a few days before you arrive.</p>
                                ) : arr.checkInMethod ? (
                                    <div className="mt-2">
                                        <div className="text-sm font-medium text-slate-900">{checkInMethodTitle(arr.checkInMethod)}</div>
                                        {checkInBlurb(arr.checkInMethod) && <div className="text-sm text-slate-600">{checkInBlurb(arr.checkInMethod)}</div>}
                                    </div>
                                ) : (
                                    <p className="mt-2 text-sm text-slate-500">{hostName} will let you know how to get in — send a message if you&apos;re not sure.</p>
                                )}
                            </div>

                            {/* Where you'll be — address, directions, and the area map */}
                            <div className="py-6 first:pt-0 last:pb-0">
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    <MapPin className="h-3.5 w-3.5" /> Where you&apos;ll be
                                </div>
                                <div className="mt-2">
                                    {arr.addressLines.length
                                        ? arr.addressLines.map((line, i) => (
                                            <div key={i} className={i === 0 ? 'text-sm font-medium text-slate-900' : 'text-sm text-slate-600'}>{line}</div>
                                        ))
                                        : <div className="text-sm text-slate-500">Ask {hostName} for the address in the messages.</div>}
                                </div>
                                {/* The three words live inside the Get directions
                                    picker (Apple Maps / Google Maps / what3words). */}
                                {!hasCoords && directionsUrl && (
                                    <p className="mt-2 text-xs text-slate-400">No pin saved for this cottage yet — directions use the address.</p>
                                )}
                                {(directionsUrl || arr.appleDirectionsUrl || arr.what3words || arr.addressString) && (
                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                        <DirectionsPicker compact apple={arr.appleDirectionsUrl} google={directionsUrl} what3words={arr.what3words} />
                                        {arr.addressString && <CopyField value={arr.addressString} label="Copy address" />}
                                    </div>
                                )}
                                {/* A full-width map with a house pin at the property,
                                    Airbnb-style. Keyless OpenStreetMap tiles. */}
                                {hasCoords && (
                                    <div className="mt-3">
                                        <PropertyMap
                                            variant="card"
                                            latitude={arr.lat as number}
                                            longitude={arr.lng as number}
                                            area={listing?.location ? publicArea(listing.location) : undefined}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* The last bit — the host's own words for what sat-nav gets wrong */}
                            {arr.arrivalDirections && (
                                <div className="py-6 first:pt-0 last:pb-0">
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                                            <CornerDownRight className="h-3.5 w-3.5" /> The last bit
                                        </div>
                                        <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-amber-950">{arr.arrivalDirections}</p>
                                    </div>
                                </div>
                            )}

                            {/* Check-in / checkout — a fact to read, not a door. */}
                            <div className="py-6 first:pt-0 last:pb-0">
                                <CheckInOutTimes
                                    surface="trips"
                                    mode="static"
                                    checkInDate={b.check_in}
                                    checkOutDate={b.check_out}
                                    checkInTime={arr.checkInTime}
                                    checkOutTime={arr.checkOutTime}
                                    checkInEndTime={arr.checkInEndTime}
                                />
                            </div>

                            {/* Parking, only if the host said */}
                            {arr.parking && (
                                <div className="py-6 first:pt-0 last:pb-0">
                                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        <Car className="h-3.5 w-3.5" /> Parking
                                    </div>
                                    <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{arr.parking}</p>
                                </div>
                            )}

                        </div>

                        {/* The offline promise — the screen a guest opens before
                            setting off down a track with no signal. */}
                        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
                            <CloudOff className="h-3.5 w-3.5" /> Signal&apos;s patchy out here — open this before you set off and it stays put.
                        </p>
                    </div>
                )}

                {/* If something's not right — the out-of-hours backstop. The
                    host's own number is in the host block above, so this points at
                    support rather than repeating it. */}
                {upcomingConfirmed && arr && (
                    <div className="mt-8 rounded-2xl border border-slate-200 p-6 sm:p-7">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            <LifeBuoy className="h-3.5 w-3.5" /> If something&apos;s not right
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                            Locked out, a boiler that won&apos;t fire, a lost key at 9pm — {hostFirstName} is local and usually quickest to reach (their number&apos;s in the host details above). If you can&apos;t get hold of them, we&apos;ll step in: email{' '}
                            <a href="mailto:support@gallowaygetaways.co.uk" className="font-semibold text-emerald-700 hover:text-emerald-800">support@gallowaygetaways.co.uk</a> and a real person here will help.
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

                {b.sharedWithMe && (
                    <p className="text-xs text-slate-400 mt-3">
                        You were added to this trip. Whoever booked it looks after
                        the payment and any changes.
                    </p>
                )}

                {!b.sharedWithMe && b.payment_status === 'deposit_paid'
                    && Number(b.balance_amount || 0) > 0
                    && b.status !== 'cancelled'
                    && b.status !== 'declined' && (
                    <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
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

                    // Whether cancelling actually costs the guest money — the rule
                    // that drives the colour: green when it's free or fully
                    // refunded, red only when they'd lose something.
                    const costs = paidSoFar > 0 && refund < paidSoFar;
                    const orders = ordersByBooking[b.id] || [];
                    // The standing policy in plain words — shown above the button
                    // as the terms, distinct from the live "where you stand now"
                    // line below it.
                    const words = cancellationWords(listing?.cancellation_policy);

                    if (confirmingId !== b.id) {
                        // The position, under the Cancel link — a fact. Three
                        // states: green for the free window, red when cancelling
                        // would cost money, plain slate when there's simply
                        // nothing to lose (nothing paid, or a full refund).
                        const tone =
                            cancel.kind === 'free' ? 'text-emerald-700'
                                : costs ? 'text-red-700'
                                    : 'text-slate-500';
                        const text =
                            cancel.kind === 'free' && cancel.freeUntilKey
                                ? 'Free to cancel until ' + ukLongDate(cancel.freeUntilKey) + '.'
                                : paidSoFar <= 0
                                    ? 'You haven’t paid for this stay yet, so there’s nothing to lose by cancelling.'
                                    : refund >= paidSoFar
                                        ? 'You’d get your full £' + paidSoFar.toFixed(2) + ' back if you cancel.'
                                        : refund > 0
                                            ? '£' + refund.toFixed(2) + ' of the £' + paidSoFar.toFixed(2) + ' you’ve paid comes back — the rest stays with the host.'
                                            : 'Non-refundable — the £' + paidSoFar.toFixed(2) + ' you’ve paid stays with the host if you cancel.';

                        return (
                            // Set apart from the actions above by a divider —
                            // cancelling is the opposite intention to "add the
                            // people coming with you" and should not sit flush
                            // against it.
                            <div className="mt-8 border-t border-slate-100 pt-6">
                                {/* Cancellation policy, in words — the terms, with
                                    a link to the full page. */}
                                <p className="flex items-start gap-1.5 text-xs text-slate-500">
                                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
                                    <span>
                                        <span className="font-semibold text-slate-700">{words.tier} cancellation</span> — {words.summary}{' '}
                                        <Link href="/cancellation-policy" className="font-medium text-slate-600 underline hover:text-slate-800">Full terms</Link>
                                    </span>
                                </p>
                                {/* Cancel is the most consequential control on the
                                    card — a real outlined button, not underlined
                                    text. The live position sits beneath it. */}
                                <button
                                    type="button"
                                    onClick={() => setConfirmingId(b.id)}
                                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                                >
                                    <XCircle className="h-4 w-4" /> Cancel booking
                                </button>
                                <p className={'text-xs mt-2 ' + tone}>
                                    {text}
                                </p>
                            </div>
                        );
                    }

                    return (
                        <div className="mt-4">
                            <CancelBookingConfirm
                                bookingId={b.id}
                                checkIn={b.check_in}
                                policy={listing?.cancellation_policy}
                                amountPaid={b.amount_paid}
                                amountRefunded={b.amount_refunded}
                                cleaningFee={(b as any).cleaning_fee}
                                orders={orders}
                                onKeep={() => setConfirmingId(null)}
                                onCancelled={() => {
                                    setBookings((prev) => prev.map((x) => x.id === b.id ? { ...x, status: 'cancelled', balance_amount: 0 } : x));
                                    setConfirmingId(null);
                                }}
                            />
                        </div>
                    );
                })()}

                {/* Coming back — a guest who had a good week is the cheapest
                    booking we'll ever get, so the card should ask for the next
                    one. Real: the Book again link to the listing. Placeholder:
                    the returning-guest offer. */}
                {!b.sharedWithMe && (
                    <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6 sm:p-7">
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                                <Heart className="h-3.5 w-3.5" /> Coming back
                            </div>
                            <PlaceholderTag />
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-emerald-900">
                            Had a good week? Book {listing?.title || 'this place'} again direct and skip the fees — returning guests get [10% off] their next stay.
                        </p>
                        <div className="mt-3">
                            <Link href={homeHref} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800">
                                Book again <ArrowRight className="h-4 w-4" />
                            </Link>
                        </div>
                        <p className="mt-2 text-xs text-emerald-700/70">
                            The offer is placeholder. To make it real: a host-set returning-guest discount (e.g. <span className="font-mono">listings.returning_guest_discount</span>) or a personal rebook code, applied at checkout.
                        </p>
                    </div>
                )}

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

                {/* The guest experiences for this stay — what's booked and a way
                    to browse more. Per booking, but quiet when the marketplace is
                    closed (the "coming soon" line is said once at page level) and
                    quiet when there's nothing to show. */}
                {upcomingConfirmed && (
                    <div className="mt-8">
                        <GuestExperiences
                            bookingId={b.id}
                            checkIn={b.check_in}
                            checkOut={b.check_out}
                            town={listing?.location ? publicArea(listing.location) : undefined}
                            hideClosedTeaser
                        />
                    </div>
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
