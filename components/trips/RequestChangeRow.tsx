'use client';

import { useState } from 'react';
import { CalendarDays, Users, ChevronRight, X } from 'lucide-react';
import ChangeReservationFlow from '@/components/dashboard/reservation/ChangeReservationFlow';

// The guest's stay-change actions, as two rows sharing one form (the same one the
// host uses, in the guest's role, so the guest proposes and the host approves):
//   • "Change guest count" — opens the form with the Guests dropdown already
//     expanded and the dates left unchanged.
//   • "Request a change" — opens the same form for dates or guests.
// Same pricing, limits and approval either way; nothing moves until the host agrees.
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
    const [mode, setMode] = useState<null | 'guests' | 'change'>(null);
    return (
        <>
            <button type="button" onClick={() => setMode('guests')} className={className}>
                <span className="flex items-center gap-3"><Users className="h-4 w-4 flex-none text-slate-400" /> Change guest count</span>
                <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
            </button>
            <button type="button" onClick={() => setMode('change')} className={className}>
                <span className="flex items-center gap-3"><CalendarDays className="h-4 w-4 flex-none text-slate-400" /> Request a change</span>
                <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
            </button>

            {mode && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setMode(null)}>
                    <div className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-base font-semibold text-slate-900">{mode === 'guests' ? 'Change guest count' : 'Request a change'}</h2>
                            <button type="button" onClick={() => setMode(null)} className="rounded-lg p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
                        </div>
                        <ChangeReservationFlow
                            key={mode}
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
                            startGuestsOpen={mode === 'guests'}
                            onClose={() => setMode(null)}
                        />
                    </div>
                </div>
            )}
        </>
    );
}
