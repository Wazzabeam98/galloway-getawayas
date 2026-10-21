'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, CalendarDays, Phone } from 'lucide-react';
import BookingActions from '@/components/BookingActions';
import UpcomingTripClient from '@/components/UpcomingTripClient';

// The host-mode "Your next reservations" block on the home page, fetched on the
// client so the edge-cached HTML carries no takings, guest names or phone
// numbers. Every money figure and permission gate is decided server-side in
// /api/home/host-reservations; this only lays it out. Mirrors the old server
// component (components/HostReservations.tsx). When the viewer has switched to
// hosting but no longer has any property, it shows the guest trip card instead,
// exactly as the server component did.

type Reservation = {
    id: string;
    status: string;
    title: string;
    location: string | null;
    image: string | null;
    headline: string;
    arrivalShort: string;
    days: number;
    nights: number;
    guests: number | null;
    guestName: string;
    checkInUk: string;
    checkOutUk: string;
    showMoney: boolean;
    canAnswer: boolean;
    earns: string;
    grossDue: string;
    feeAmount: string;
    rate: number;
    paysOnUk: string;
    stillOwed: number;
    stillOwedGBP: string;
    balanceLate: boolean;
    balanceDueUk: string | null;
    unread: number;
    phone: string | null;
    totalPrice: number;
    amountPaid: number;
    amountRefunded: number;
};

export default function HostReservationsClient() {
    const [state, setState] = useState<{ reservations: Reservation[]; fallbackToTrip: boolean } | null>(null);

    useEffect(() => {
        let live = true;
        fetch('/api/home/host-reservations', { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d) setState({ reservations: d.reservations || [], fallbackToTrip: !!d.fallbackToTrip }); })
            .catch(() => { /* leave it empty */ });
        return () => { live = false; };
    }, []);

    if (!state) return null;
    if (state.fallbackToTrip) return <UpcomingTripClient />;
    if (state.reservations.length === 0) return null;

    const { reservations } = state;

    return (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14">
            <div className="mb-6 border-b border-stone-200 pb-4">
                <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                    {reservations.length === 1 ? 'Your next reservation' : 'Your next reservations'}
                </h2>
                <p className="text-stone-600 text-sm md:text-base mt-1">
                    Who is arriving, and when
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {reservations.map((booking) => {
                    const bookingHref = '/dashboard/bookings/' + booking.id;
                    return (
                        <div
                            key={booking.id}
                            className="relative rounded-3xl overflow-hidden border border-stone-200 hover:border-stone-300 transition bg-white flex flex-col"
                        >
                            <Link
                                href={bookingHref}
                                className="absolute inset-0"
                                aria-label={'Open this booking at ' + booking.title}
                            />

                            <div className="p-8 flex-1 flex flex-col">
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-stone-100 flex-shrink-0">
                                        {booking.image && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={booking.image}
                                                alt={booking.title}
                                                className="w-full h-full object-cover"
                                            />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-lg font-semibold text-stone-900 truncate">
                                            {booking.title}
                                        </div>
                                        {booking.location && (
                                            <div className="text-stone-500 text-sm truncate">
                                                {booking.location}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-6 text-3xl md:text-4xl font-bold text-stone-900 tracking-tight">
                                    {booking.headline}
                                    {booking.days > 1 && (
                                        <span className="block text-base font-normal text-stone-500 mt-1 tracking-normal">
                                            {booking.arrivalShort}
                                        </span>
                                    )}
                                </div>

                                <div className="mt-5 pt-5 border-t border-stone-100 text-stone-700">
                                    <div className="font-medium">{booking.guestName}</div>
                                    <div className="text-sm text-stone-500 mt-1">
                                        {booking.checkInUk} &rarr; {booking.checkOutUk}
                                    </div>
                                    <div className="text-sm text-stone-500 mt-1">
                                        {booking.nights} {booking.nights === 1 ? 'night' : 'nights'}
                                        {booking.guests
                                            ? ' · ' + booking.guests + (booking.guests === 1 ? ' guest' : ' guests')
                                            : ''}
                                    </div>
                                </div>

                                {booking.showMoney && (
                                    <div className="relative mt-5 pt-5 border-t border-stone-100">
                                        <div className="text-lg font-semibold text-stone-900">
                                            {booking.earns}
                                            <span className="text-sm font-normal text-stone-500">
                                                {' '}for {booking.nights} {booking.nights === 1 ? 'night' : 'nights'}
                                            </span>
                                        </div>
                                        <div className="text-sm text-stone-500 mt-1">
                                            {booking.status === 'pending'
                                                ? 'If you confirm, it reaches you the day after check-in'
                                                : 'Reaches you ' + booking.paysOnUk + ', the day after check-in'}
                                        </div>

                                        {booking.stillOwed > 0 && (
                                            <div
                                                className={
                                                    'text-sm mt-2 font-medium '
                                                    + (booking.balanceLate ? 'text-amber-700' : 'text-stone-600')
                                                }
                                            >
                                                {booking.stillOwedGBP} of it is still to come
                                                {booking.balanceDueUk
                                                    ? booking.balanceLate
                                                        ? ' — was due ' + booking.balanceDueUk + ', so the charge may have failed'
                                                        : ' — charged ' + booking.balanceDueUk
                                                    : ''}
                                            </div>
                                        )}

                                        <details className="group mt-3">
                                            <summary className="text-sm text-stone-500 underline cursor-pointer list-none w-fit hover:text-stone-800">
                                                <span className="group-open:hidden">Show breakdown</span>
                                                <span className="hidden group-open:inline">Hide breakdown</span>
                                            </summary>
                                            <div className="mt-2 text-sm space-y-1">
                                                <div className="flex justify-between gap-6 text-stone-600">
                                                    <span>Guest pays</span>
                                                    <span>{booking.grossDue}</span>
                                                </div>
                                                <div className="flex justify-between gap-6 text-stone-600">
                                                    <span>Our fee ({booking.rate}%)</span>
                                                    <span>&minus; {booking.feeAmount}</span>
                                                </div>
                                                <div className="flex justify-between gap-6 font-semibold text-stone-900 pt-1 border-t border-stone-100">
                                                    <span>You get</span>
                                                    <span>{booking.earns}</span>
                                                </div>
                                            </div>
                                        </details>
                                    </div>
                                )}

                                {booking.status === 'pending' && (
                                    <div className="relative mt-5">
                                        <div className="text-sm font-semibold text-amber-700">
                                            Waiting for you to confirm
                                        </div>
                                        {booking.canAnswer ? (
                                            <div className="mt-3">
                                                <BookingActions
                                                    bookingId={booking.id}
                                                    totalPrice={booking.totalPrice}
                                                    amountPaid={booking.amountPaid}
                                                    amountRefunded={booking.amountRefunded}
                                                />
                                            </div>
                                        ) : (
                                            <div className="mt-1 text-sm text-stone-500">
                                                Only the owner can answer this one.
                                            </div>
                                        )}
                                    </div>
                                )}

                                {booking.phone && (
                                    <a
                                        href={'tel:' + booking.phone}
                                        className="relative inline-flex items-center gap-2 mt-5 text-sm font-semibold text-stone-900 hover:underline w-fit"
                                    >
                                        <Phone className="w-4 h-4" />
                                        {booking.phone}
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
                                            + (booking.unread > 0
                                                ? 'border-emerald-700 text-emerald-800 hover:bg-emerald-50'
                                                : 'border-stone-300 hover:border-stone-900 text-stone-800')
                                        }
                                    >
                                        <MessageSquare className="w-4 h-4" />
                                        {booking.unread > 0
                                            ? booking.unread === 1
                                                ? '1 unread message'
                                                : booking.unread + ' unread messages'
                                            : 'Message guest'}
                                    </Link>
                                </div>

                                {booking.status === 'confirmed' && booking.canAnswer && booking.days >= 1 && (
                                    <div className="relative mt-4 pt-4 border-t border-stone-100">
                                        <BookingActions
                                            bookingId={booking.id}
                                            mode="confirmed"
                                            allowRefund={false}
                                            totalPrice={booking.totalPrice}
                                            amountPaid={booking.amountPaid}
                                            amountRefunded={booking.amountRefunded}
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
