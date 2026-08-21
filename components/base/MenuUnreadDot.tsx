'use client';

import { MenuIcon } from 'lucide-react';
import useUnreadCount from './useUnreadCount';

// The hamburger with a dot on it when a message is waiting.
//
// The number lives inside the menu, on the Messages line, which is no use to
// anyone who has not opened the menu. This is the bit you can see from any
// page: a dot, no count, because the count is one click away and a two-digit
// badge on a 20px icon is a smudge.
export default function MenuUnreadDot({ enabled = true }: { enabled?: boolean }) {
    const unread = useUnreadCount(enabled);

    return (
        <span className='relative flex'>
            <MenuIcon className='w-5 h-5' />
            {unread > 0 && (
                <span
                    // A white ring so the dot reads as separate from the icon
                    // rather than as part of the top bar of the hamburger.
                    className='absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-700 ring-2 ring-white'
                    aria-hidden='true'
                />
            )}
            <span className='sr-only'>
                {unread > 0
                    ? `Menu, ${unread} unread ${unread === 1 ? 'message' : 'messages'}`
                    : 'Menu'}
            </span>
        </span>
    );
}
