'use client';

import { useState } from 'react';
import { CalendarDays, ChevronRight, X } from 'lucide-react';
import ChangeReservationFlow from '@/components/dashboard/reservation/ChangeReservationFlow';

// The guest's "Request a change" — opens the same change form the host uses, in
// the guest's role, so the guest can propose new dates or guests and the host
// approves. Nothing moves until the host agrees.
export default function RequestChangeRow({
    bookingId, listingId, listingTitle, listingImage, hostFirst, checkIn, checkOut, adults, childrenCount, pets, maxGuests, petsAllowed, className,
}: {
    bookingId: string;
    listingId: string;
    listingTitle: string;
    listingImage: string | null;
    hostFirst: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    childrenCount: number;
    pets: number;
    maxGuests: number;
    petsAllowed: boolean;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className={className}>
                <span className="flex items-center gap-3"><CalendarDays className="h-4 w-4 flex-none text-slate-400" /> Request a change</span>
                <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
                    <div className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-base font-semibold text-slate-900">Request a change</h2>
                            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
                        </div>
                        <ChangeReservationFlow
                            bookingId={bookingId}
                            listingId={listingId}
                            listingTitle={listingTitle}
                            listingImage={listingImage}
                            role="guest"
                            counterpartyName={hostFirst}
                            checkIn={checkIn}
                            checkOut={checkOut}
                            adults={adults}
                            childrenCount={childrenCount}
                            pets={pets}
                            maxGuests={maxGuests}
                            petsAllowed={petsAllowed}
                            onClose={() => setOpen(false)}
                        />
                    </div>
                </div>
            )}
        </>
    );
}
