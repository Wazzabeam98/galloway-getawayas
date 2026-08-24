'use client';

import TripGroup from '@/components/TripGroup';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { getImageUrl, capitializeFirst, displayName, formatTime } from '@/lib/utils';
import Link from 'next/link';
import { refundFraction } from '@/lib/cancellation';

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
    const isOver = (b: Booking) =>
        b.status === 'cancelled'
        || b.status === 'declined'
        || new Date(b.check_out) < today;

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
    const todayIso = today.toISOString().split('T')[0];
    const hasCompletedStay = bookings.some(
        (b) => !b.sharedWithMe && b.status === 'confirmed' && b.check_out < todayIso
    );

    // One trip card. It is rendered from two lists now, so it lives in a
    // function rather than inline in a single map.
    const renderTrip = (b: Booking) => {
        const listing = listingMap[b.listing_id];
        const isCompleted = b.status === 'confirmed' && new Date(b.check_out) < today;
        const alreadyReviewed = reviewedBookingIds.has(b.id);

        return (
            // Named so the link from the home page card lands on this trip
            // rather than at the top of a list of them.
            <div key={b.id} id={'trip-' + b.id} className="border rounded-2xl p-5 scroll-mt-6">
                <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-slate-200 flex-shrink-0">
                        {listing?.images?.[0] && (
                            <Image src={getImageUrl(listing.images[0])} alt={listing.title} fill sizes="64px" className="object-cover" />
                        )}
                    </div>
                    <div className="flex-1">
                        <div className="font-semibold text-slate-900">{listing?.title || 'Listing'}</div>
                        <div className="text-sm text-slate-600">
                            Hosted by {capitializeFirst(hostNames[b.host_id] || 'Host')} · {b.check_in} → {b.check_out}
                        </div>
                        {(formatTime(listing?.check_in_time) || formatTime(listing?.check_out_time)) && (
                            <div className="text-xs text-slate-500">
                                {formatTime(listing?.check_in_time)
                                    ? 'Arrive from ' + formatTime(listing?.check_in_time)
                                        + (formatTime(listing?.check_in_end_time)
                                            ? ' until ' + formatTime(listing?.check_in_end_time)
                                            : '')
                                    : ''}
                                {formatTime(listing?.check_in_time) && formatTime(listing?.check_out_time) ? ' · ' : ''}
                                {formatTime(listing?.check_out_time)
                                    ? 'Leave by ' + formatTime(listing?.check_out_time)
                                    : ''}
                            </div>
                        )}
                        {b.sharedWithMe ? (
                            <div className="text-sm text-slate-400">
                                {b.guests ? b.guests + (b.guests === 1 ? ' guest' : ' guests') : 'Shared with you'}
                            </div>
                        ) : (
                            <div className="text-sm font-medium text-slate-700">£{b.total_price}</div>
                        )}
                    </div>
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize flex-shrink-0 ${statusStyles[b.status] || 'bg-slate-100 text-slate-600'}`}>
                        {b.status}
                    </span>
                </div>

                <Link href={`/messages/${b.id}`} className="text-xs font-semibold text-slate-500 underline hover:text-slate-800 mt-3 inline-block">
                    Message host
                </Link>

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
                    const paidSoFar = Number(b.amount_paid || 0) - Number(b.amount_refunded || 0);
                    const fraction = refundFraction(b.check_in, listing?.cancellation_policy);
                    const refund = Math.round(paidSoFar * fraction * 100) / 100;

                    if (confirmingId !== b.id) {
                        return (
                            <div className="mt-3">
                                <button
                                    type="button"
                                    onClick={() => { setConfirmingId(b.id); setCancelError(''); }}
                                    className="text-xs font-semibold text-slate-500 underline hover:text-slate-800"
                                >
                                    Cancel booking
                                </button>
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
                </>
            )}
        </div>
    );
}
