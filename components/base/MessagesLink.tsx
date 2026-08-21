'use client';

import Link from 'next/link';
import useUnreadCount from './useUnreadCount';

// The menu itself is rendered on the server, so the count is fetched here
// rather than blocking every page render on a database query.
export default function MessagesLink({ className }: { className?: string }) {
    const unread = useUnreadCount();

    return (
        <Link href="/messages" className={'flex items-center gap-2 ' + (className || '')}>
            <span>Messages</span>
            {unread > 0 && (
                <span className="text-xs font-bold text-white bg-emerald-700 rounded-full px-2 py-0.5 leading-none">
                    {unread > 99 ? '99+' : unread}
                </span>
            )}
        </Link>
    );
}
