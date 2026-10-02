'use client';

import Link from 'next/link';
import useBadgeCounts from './useBadgeCounts';

// The Enquiries line in a trade's menu, with the number of enquiries still to
// answer. Same shape and same green badge as BookingsLink and MessagesLink — a
// trade learns one badge, not a new one — so an enquiry waiting on them shows on
// the menu exactly the way a booking waiting on a host does.
export default function RequestsLink({ className }: { className?: string }) {
    const { requests } = useBadgeCounts();

    return (
        <Link href="/services/dashboard" className={'flex items-center gap-2 ' + (className || '')}>
            <span>Enquiries</span>
            {requests > 0 && (
                <span className="text-xs font-bold text-white bg-emerald-700 rounded-full px-2 py-0.5 leading-none">
                    {requests > 99 ? '99+' : requests}
                </span>
            )}
        </Link>
    );
}
