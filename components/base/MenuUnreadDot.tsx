'use client';

import { MenuIcon } from 'lucide-react';
import useBadgeCounts, { adminPendingTotal } from './useBadgeCounts';

// The hamburger with a dot on it when something is waiting.
//
// The numbers live inside the menu, on the Messages and Bookings lines, which
// are no use to anyone who has not opened the menu. This is the bit you can
// see from any page: a dot, no count, because the count is one click away and
// a two-digit badge on a 20px icon is a smudge.
//
// One dot, not two. Two dots on an icon this size is a smudge as well, and a
// host does not need to know which kind of thing is waiting before opening the
// menu that tells them. One colour too: the dot means "something is waiting",
// and a host should not have to learn a palette to read a 10px circle.
export default function MenuUnreadDot({
    enabled = true,
    host = false,
    provider = false,
    admin = false,
}: {
    enabled?: boolean;
    host?: boolean;
    // A trade: light the dot for enquiries waiting on them too, the same way it
    // lights for a host's booking requests.
    provider?: boolean;
    // An admin: light the dot when anything is waiting for review (a holiday let,
    // an experience or a trade), so "something needs me" shows from any page.
    admin?: boolean;
}) {
    const counts = useBadgeCounts(enabled);
    const unread = enabled ? counts.unread : 0;
    const pending = enabled && host ? counts.pending : 0;
    const requests = enabled && provider ? counts.requests : 0;
    const adminWaiting = enabled && admin ? adminPendingTotal(counts.admin) : 0;

    const waiting = unread > 0 || pending > 0 || requests > 0 || adminWaiting > 0;

    const label = () => {
        const parts: string[] = [];
        if (adminWaiting > 0) {
            parts.push(`${adminWaiting} waiting for review`);
        }
        if (pending > 0) {
            parts.push(`${pending} booking request${pending === 1 ? '' : 's'} to answer`);
        }
        if (requests > 0) {
            parts.push(`${requests} request${requests === 1 ? '' : 's'} to answer`);
        }
        if (unread > 0) {
            parts.push(`${unread} unread message${unread === 1 ? '' : 's'}`);
        }
        return parts.length ? `Menu, ${parts.join(', ')}` : 'Menu';
    };

    return (
        <span className='relative flex'>
            <MenuIcon className='w-5 h-5' />
            {waiting && (
                <span
                    // A white ring so the dot reads as separate from the icon
                    // rather than as part of the top bar of the hamburger.
                    className='absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-white bg-emerald-700'
                    aria-hidden='true'
                />
            )}
            <span className='sr-only'>{label()}</span>
        </span>
    );
}
