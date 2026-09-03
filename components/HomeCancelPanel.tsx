'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import CancelBookingConfirm from '@/components/CancelBookingConfirm';
import { ukLongDate } from '@/lib/dayKey';

// The home card's cancel: two steps, one page. "Free to cancel until [date]"
// reads as a fact; pressing it opens the SAME confirm the trips card uses, in
// place — no navigation to /trips and no landing on top of a red button. Backing
// out closes it; cancelling refreshes the card into its cancelled state.
export default function HomeCancelPanel({
    bookingId,
    checkIn,
    policy,
    amountPaid,
    amountRefunded,
    cleaningFee,
    orders,
    freeUntilKey,
    freeDaysLeft,
}: {
    bookingId: string;
    checkIn: string;
    policy: string | null | undefined;
    amountPaid: number | null | undefined;
    amountRefunded: number | null | undefined;
    cleaningFee?: number | null;
    orders: { item_name: string | null; service_date: string }[];
    freeUntilKey: string;
    freeDaysLeft: number;
}) {
    const [open, setOpen] = useState(false);
    const router = useRouter();

    if (open) {
        return (
            <div className="mt-5">
                <CancelBookingConfirm
                    bookingId={bookingId}
                    checkIn={checkIn}
                    policy={policy}
                    amountPaid={amountPaid}
                    amountRefunded={amountRefunded}
                    cleaningFee={cleaningFee}
                    orders={orders}
                    onKeep={() => setOpen(false)}
                    onCancelled={() => { setOpen(false); router.refresh(); }}
                />
            </div>
        );
    }

    return (
        <div className="mt-5 text-sm">
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={'underline underline-offset-2 hover:no-underline ' + (freeDaysLeft <= 3 ? 'text-amber-700' : 'text-emerald-700')}
            >
                Free to cancel until {ukLongDate(freeUntilKey)}
            </button>
            {freeDaysLeft <= 3 && (
                <span className="text-stone-500">
                    {' '}&middot;{' '}
                    {freeDaysLeft === 0 ? 'last day' : freeDaysLeft === 1 ? '1 day left' : freeDaysLeft + ' days left'}
                </span>
            )}
        </div>
    );
}
