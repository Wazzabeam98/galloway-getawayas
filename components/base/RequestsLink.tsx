'use client';

import Link from 'next/link';
import useBadgeCounts from './useBadgeCounts';

// The Enquiries line in a trade's menu, with the number of enquiries still to
// answer. Same shape and same green badge as BookingsLink and MessagesLink — a
// trade learns one badge, not a new one — so an enquiry waiting on them shows on
// the menu exactly the way a booking waiting on a host does.
//
// A guest-experience provider's "Reservations" line uses it too (label), with
// their booking requests still to confirm (lib/badgeCounts providerRequestsFor).
export default function RequestsLink({ className, label = 'Enquiries' }: { className?: string; label?: string }) {
    const { requests } = useBadgeCounts();

    return (
        <Link href="/services/dashboard" className={'flex items-center gap-2 ' + (className || '')}>
            <span>{label}</span>
            {requests > 0 && (
                <span className="text-xs font-bold text-white bg-emerald-700 rounded-full px-2 py-0.5 leading-none">
                    {requests > 99 ? '99+' : requests}
                </span>
            )}
        </Link>
    );
}
