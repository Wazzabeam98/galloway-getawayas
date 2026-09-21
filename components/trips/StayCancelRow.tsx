'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, ChevronRight } from 'lucide-react';
import CancelBookingConfirm from '@/components/CancelBookingConfirm';

// "Cancel reservation" as a quiet chevron row that expands the shared
// CancelBookingConfirm panel in place — the stay-side counterpart to the
// experience page's OrderCancel row, so the two reservation pages carry the same
// action in the same style. The confirm panel states the refund, names any
// experiences the stay-cancel takes with it and calls the cancel route itself;
// once done we refresh the server page so it re-renders in its cancelled state.
//
// The row class is passed in (the same ROW token the page's other action rows
// use) so this cannot drift into a second row style.
export default function StayCancelRow({
    bookingId, checkIn, policy, amountPaid, amountRefunded, cleaningFee, orders = [],
    className, panelClassName,
}: {
    bookingId: string;
    checkIn: string;
    policy: string | null | undefined;
    amountPaid: number | null | undefined;
    amountRefunded: number | null | undefined;
    cleaningFee?: number | null;
    orders?: { item_name: string | null; service_date: string }[];
    className: string;
    panelClassName?: string;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);

    return (
        <>
            <button type="button" onClick={() => setOpen((o) => !o)} className={className}>
                <span className="flex items-center gap-3"><Ban className="h-4 w-4 flex-none text-slate-400" /> Cancel reservation</span>
                <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
            </button>
            {open && (
                <div className={panelClassName}>
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
            )}
        </>
    );
}
