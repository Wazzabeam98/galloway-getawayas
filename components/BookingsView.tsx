'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getImageUrl, capitializeFirst } from '@/lib/utils';
import BookingActions from '@/components/BookingActions';
import { CalendarClock, History } from 'lucide-react';
import { rateFor, netOfFee } from '@/lib/fees';

interface Booking {
    id: string;
    listing_id: string;
    guest_id: string;
    check_in: string;
    check_out: string;
    guests: number;
    total_price: number;
    status: string;
    commission_rate?: number | null;
}

interface ListingInfo {
    title: string;
    images: string[] | null;
    commission_rate?: number | null;
}

const statusStyles: Record<string, string> = {
    confirmed: 'bg-green-100 text-green-800',
    declined: 'bg-slate-100 text-slate-500',
    cancelled: 'bg-slate-100 text-slate-500',
};

export default function BookingsView({
    bookings,
    listingMap,
    guestNameMap,
    reviewedBookingIds,
}: {
    bookings: Booking[];
    listingMap: Record<string, ListingInfo>;
    guestNameMap: Record<string, string>;
    reviewedBookingIds: string[];
}) {
    const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
    const today = new Date();
    const reviewedSet = new Set(reviewedBookingIds);

    const isUpcoming = (b: Booking) =>
        (b.status === 'pending' || b.status === 'confirmed') && new Date(b.check_in) >= today;

    const upcoming = bookings.filter(isUpcoming);
    const past = bookings.filter((b) => !isUpcoming(b));

    const list = tab === 'upcoming' ? upcoming : past;

    const BookingRow = ({ booking }: { booking: Booking }) => {
        const listing = listingMap[booking.listing_id];
        // The rate agreed when the booking was made wins. Older bookings
        // predating that were all on the listing's rate.
        const commission = booking.commission_rate !== null && booking.commission_rate !== undefined
            ? Number(booking.commission_rate)
            : rateFor(listing);
        const guestName = guestNameMap[booking.guest_id] || 'Guest';
        const showConfirmDecline = booking.status === 'pending';
        const showCancel = booking.status === 'confirmed' && new Date(booking.check_in) >= today;
        const isReviewable = booking.status === 'confirmed' && new Date(booking.check_out) < today;
        const alreadyReviewed = reviewedSet.has(booking.id);

        return (
            <div className="border rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-200 flex-shrink-0">
                        {listing?.images?.[0] && (
                            <img src={getImageUrl(listing.images[0])} alt={listing.title} className="w-full h-full object-cover" />
                        )}
                    </div>
                    <div>
                        <div className="font-semibold text-slate-900">{listing?.title || 'Listing'}</div>
                        <div className="text-sm text-slate-600">
                            {capitializeFirst(guestName)} · {booking.check_in} → {booking.check_out} · {booking.guests} guest{booking.guests > 1 ? 's' : ''}
                        </div>
                        <div className="text-sm text-slate-700 mt-0.5">
                            <span className="font-semibold text-slate-900">
                                £{netOfFee(Number(booking.total_price), commission).toFixed(2)}
                            </span>
                            <span className="text-slate-500"> to you</span>
                            <span className="text-slate-400">
                                {' '}&middot; £{Number(booking.total_price).toFixed(2)} guest total
                                {commission > 0 ? ', less ' + commission + '% fee' : ', no fee'}
                            </span>
                        </div>
                        {isReviewable ? (
                            alreadyReviewed ? (
                                <span className="text-xs text-slate-400">You've reviewed this guest</span>
                            ) : (
                                <Link href="/dashboard/reviews" className="text-xs font-semibold text-emerald-700 underline hover:text-emerald-800">
                                    Leave a review
                                </Link>
                            )
                        ) : (
                            <Link href={`/messages/${booking.id}`} className="text-xs font-semibold text-slate-500 underline hover:text-slate-800">
                                Message guest
                            </Link>
                        )}
                    </div>
                </div>

                {showConfirmDecline ? (
                    <BookingActions bookingId={booking.id} />
                ) : (
                    <div className="flex items-center gap-3">
                        <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize ${statusStyles[booking.status] || 'bg-slate-100 text-slate-600'}`}>
                            {booking.status}
                        </span>
                        {showCancel && <BookingActions bookingId={booking.id} mode="confirmed" />}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div>
            <div className="flex gap-3 mb-8">
                <button
                    type="button"
                    onClick={() => setTab('past')}
                    className={`flex-1 flex flex-col items-center gap-2 p-5 rounded-2xl border-2 transition ${tab === 'past' ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                >
                    <History className="w-6 h-6 text-slate-700" />
                    <span className="font-semibold text-sm text-slate-900">Past bookings</span>
                    <span className="text-xs text-slate-500">{past.length} booking{past.length !== 1 ? 's' : ''}</span>
                </button>
                <button
                    type="button"
                    onClick={() => setTab('upcoming')}
                    className={`flex-1 flex flex-col items-center gap-2 p-5 rounded-2xl border-2 transition ${tab === 'upcoming' ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                >
                    <CalendarClock className="w-6 h-6 text-slate-700" />
                    <span className="font-semibold text-sm text-slate-900">Upcoming bookings</span>
                    <span className="text-xs text-slate-500">{upcoming.length} booking{upcoming.length !== 1 ? 's' : ''}</span>
                </button>
            </div>

            {list.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">
                        {tab === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'}
                    </h3>
                    <p className="text-slate-500 mt-1">
                        {tab === 'upcoming' ? 'New requests and confirmed stays will show up here.' : 'Completed, declined and cancelled bookings will show up here.'}
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {list.map((b) => <BookingRow key={b.id} booking={b} />)}
                </div>
            )}
        </div>
    );
}
