'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { getImageUrl, capitializeFirst, displayName } from '@/lib/utils';
import Link from 'next/link';

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

            const { data: bookingRows } = await supabase
                .from('bookings')
                .select('id, listing_id, host_id, check_in, check_out, status, total_price, payment_status, balance_amount, balance_due_date')
                .eq('guest_id', session.user.id)
                .order('check_in', { ascending: false });
            setBookings(bookingRows || []);

            const listingIds = Array.from(new Set((bookingRows || []).map((b) => b.listing_id)));
            if (listingIds.length) {
                const { data: listings } = await supabase.from('listings').select('id, title, images').in('id', listingIds);
                const map: Record<string, any> = {};
                (listings || []).forEach((l) => { map[l.id] = l; });
                setListingMap(map);
            }

            // Arrived from a payment reminder email — go straight to Stripe.
            if (typeof window !== 'undefined') {
                const wanted = new URLSearchParams(window.location.search).get('pay');
                const target = (bookingRows || []).filter(function (b) { return b.id === wanted; })[0];
                if (target && target.payment_status === 'deposit_paid') {
                    payBalance(target.id);
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

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-8">Your trips</h1>

            {bookings.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">No trips yet</h3>
                    <p className="text-slate-500 mt-1">Once you book a stay, it'll show up here.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {bookings.map((b) => {
                        const listing = listingMap[b.listing_id];
                        const isCompleted = b.status === 'confirmed' && new Date(b.check_out) < today;
                        const alreadyReviewed = reviewedBookingIds.has(b.id);

                        return (
                            <div key={b.id} className="border rounded-2xl p-5">
                                <div className="flex items-center gap-4">
                                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-200 flex-shrink-0">
                                        {listing?.images?.[0] && (
                                            <img src={getImageUrl(listing.images[0])} alt={listing.title} className="w-full h-full object-cover" />
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <div className="font-semibold text-slate-900">{listing?.title || 'Listing'}</div>
                                        <div className="text-sm text-slate-600">
                                            Hosted by {capitializeFirst(hostNames[b.host_id] || 'Host')} · {b.check_in} → {b.check_out}
                                        </div>
                                        <div className="text-sm font-medium text-slate-700">£{b.total_price}</div>
                                    </div>
                                    <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize flex-shrink-0 ${statusStyles[b.status] || 'bg-slate-100 text-slate-600'}`}>
                                        {b.status}
                                    </span>
                                </div>

                                <Link href={`/messages/${b.id}`} className="text-xs font-semibold text-slate-500 underline hover:text-slate-800 mt-3 inline-block">
                                    Message host
                                </Link>

                                {b.payment_status === 'deposit_paid'
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
                    })}
                </div>
            )}
        </div>
    );
}
