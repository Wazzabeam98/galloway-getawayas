'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, CalendarDays } from 'lucide-react';
import ListingImage from '@/components/ListingImage';
import CheckInOutTimes from '@/components/arrival/CheckInOutTimes';
import CopyField from '@/components/arrival/CopyField';
import DirectionsPicker from '@/components/arrival/DirectionsPicker';
import TripGroup from '@/components/TripGroup';
import HomeCancelPanel from '@/components/HomeCancelPanel';

// The "Your upcoming trip" card on the home page, fetched on the client so the
// page's HTML stays the same for everyone and is edge-cached. All the data —
// and crucially the arrival-secret entitlement gate — is computed server-side
// in /api/home/upcoming-trip; this component only lays it out. It mirrors the
// old server component (components/UpcomingTrip.tsx) one-for-one, so the card
// reads identically. Renders nothing for a signed-out visitor or a guest with
// no live stay.

type Trip = {
    bookingId: string;
    listingId: string;
    status: string;
    headline: string;
    title: string;
    areaLabel: string | null;
    images: string[] | null;
    checkIn: string;
    checkOut: string;
    checkInUk: string;
    checkOutUk: string;
    checkInTime: string | null;
    checkOutTime: string | null;
    nights: number;
    partyLabel: string;
    guests: number | null;
    directions: { google: string | null; apple: string | null } | null;
    what3words: string | null;
    addressToCopy: string | null;
    showGroup: boolean;
    seats: any[];
    profiles: Record<string, any>;
    cancel: null | {
        checkIn: string;
        policy: string | null;
        customDays: number | null;
        nonRefundable: boolean;
        amountPaid: number | null;
        amountRefunded: number | null;
        cleaningFee: number | null;
        orders: { item_name: string | null; service_date: string }[];
        freeUntilKey: string;
        freeDaysLeft: number;
    };
};

export default function UpcomingTripClient() {
    const [trip, setTrip] = useState<Trip | null>(null);

    useEffect(() => {
        let live = true;
        fetch('/api/home/upcoming-trip', { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d && d.trip) setTrip(d.trip as Trip); })
            .catch(() => { /* leave it empty */ });
        return () => { live = false; };
    }, []);

    if (!trip) return null;

    const homeHref = '/homes/' + trip.listingId;
    const hasAside = Boolean(trip.directions?.google || trip.directions?.apple || trip.what3words || trip.addressToCopy);

    return (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14">
            <div className="mb-6 border-b border-stone-200 pb-4">
                <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                    {trip.status === 'pending' ? 'Your booking request' : 'Your upcoming trip'}
                </h2>
                <p className="text-stone-600 text-sm md:text-base mt-1">
                    {trip.status === 'pending'
                        ? 'Waiting for your host to confirm'
                        : 'Everything you need for the stay is in here'}
                </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                <div className="md:flex md:items-start md:gap-8">
                    <div className="mb-6 md:mb-0 md:w-1/4 md:flex-none">
                        <Link href={homeHref}
                            className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-stone-200 md:aspect-square">
                            <ListingImage
                                images={trip.images}
                                alt={trip.title}
                                sizes="(max-width: 768px) 100vw, 33vw"
                                className="object-cover transition duration-300 group-hover:scale-105"
                                priority
                            />
                        </Link>
                    </div>
                    <div className="md:min-w-0 md:flex-1">
                        <div className="text-4xl md:text-5xl font-bold text-stone-900 tracking-tight">{trip.headline}</div>

                        <div className="mt-6 space-y-1">
                            <Link href={homeHref} className="text-lg font-semibold text-stone-900 hover:underline">
                                {trip.title}
                            </Link>
                            {trip.areaLabel && (
                                <div className="text-stone-500">{trip.areaLabel}</div>
                            )}
                        </div>
                        <div className="mt-5 pt-5 border-t border-stone-100 text-stone-700">
                            <div className="font-medium">
                                {trip.checkInUk} &rarr; {trip.checkOutUk}
                            </div>
                            <div className="text-sm text-stone-500 mt-1">
                                {trip.nights} {trip.nights === 1 ? 'night' : 'nights'}
                                {trip.partyLabel ? ' · ' + trip.partyLabel : ''}
                            </div>
                        </div>

                        {trip.showGroup && (
                            <div className="mt-4">
                                <TripGroup
                                    bookingId={trip.bookingId}
                                    guests={trip.guests}
                                    cottage={trip.title}
                                    when={trip.checkInUk + ' → ' + trip.checkOutUk}
                                    initialSeats={trip.seats as any}
                                    initialProfiles={trip.profiles as any}
                                />
                            </div>
                        )}
                    </div>
                </div>
                <div>
                    <div className="mt-5">
                        <CheckInOutTimes
                            surface="home"
                            mode="split"
                            checkInDate={trip.checkIn}
                            checkOutDate={trip.checkOut}
                            checkInTime={trip.checkInTime}
                            checkOutTime={trip.checkOutTime}
                            aside={hasAside ? (
                                <div className="flex h-full flex-col justify-center">
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        <DirectionsPicker
                                            apple={trip.directions?.apple ?? null}
                                            google={trip.directions?.google ?? null}
                                            what3words={trip.what3words}
                                        />
                                        {trip.addressToCopy && (
                                            <CopyField value={trip.addressToCopy} label="Copy address" block />
                                        )}
                                    </div>
                                </div>
                            ) : null}
                        />
                    </div>

                    {trip.cancel && (
                        <HomeCancelPanel
                            bookingId={trip.bookingId}
                            checkIn={trip.cancel.checkIn}
                            policy={trip.cancel.policy}
                            customDays={trip.cancel.customDays}
                            nonRefundable={trip.cancel.nonRefundable}
                            amountPaid={trip.cancel.amountPaid}
                            amountRefunded={trip.cancel.amountRefunded}
                            cleaningFee={trip.cancel.cleaningFee}
                            orders={trip.cancel.orders}
                            freeUntilKey={trip.cancel.freeUntilKey}
                            freeDaysLeft={trip.cancel.freeDaysLeft}
                        />
                    )}

                    <div className="flex flex-wrap gap-3 mt-8">
                        <Link href={'/trips/' + trip.bookingId}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition">
                            <CalendarDays className="w-4 h-4" /> Your trip
                        </Link>
                        <Link href={'/messages/' + trip.bookingId}
                            className="inline-flex items-center gap-2 px-6 py-3 border border-stone-300 hover:border-stone-900 text-stone-800 text-sm font-semibold rounded-xl transition">
                            <MessageSquare className="w-4 h-4" /> Message your host
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
}
