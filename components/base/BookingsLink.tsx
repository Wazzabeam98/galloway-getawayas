'use client';

import Link from 'next/link';
import usePendingCount from './usePendingCount';

// The Bookings line in the menu, with the number of requests waiting on an
// answer. Same shape as MessagesLink, deliberately — a host learns one badge,
// not two.
//
// onlyWhenWaiting is for the travel-mode menu. A host who has switched to
// looking at their own holidays still gets the dot on the hamburger, because a
// held payment does not care which mode they are browsing in — but the menu
// they open has no Bookings line in it, so the dot would have nothing to
// explain itself with. This puts one there for as long as there is something
// to answer, and nothing the rest of the time.
export default function BookingsLink({
    className,
    onlyWhenWaiting = false,
}: {
    className?: string;
    onlyWhenWaiting?: boolean;
}) {
    const pending = usePendingCount();

    if (onlyWhenWaiting && pending === 0) return null;

    return (
        <Link href="/dashboard/bookings" className={'flex items-center gap-2 ' + (className || '')}>
            <span>Bookings</span>
            {pending > 0 && (
                <span className="text-xs font-bold text-white bg-emerald-700 rounded-full px-2 py-0.5 leading-none">
                    {pending > 99 ? '99+' : pending}
                </span>
            )}
        </Link>
    );
}
