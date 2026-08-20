'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// The menu itself is rendered on the server, so the count is fetched here
// rather than blocking every page render on a database query.
export default function MessagesLink({ className }: { className?: string }) {
    const [unread, setUnread] = useState(0);

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            try {
                const res = await fetch('/api/messages/unread-count');
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (!cancelled) setUnread(data.unread || 0);
            } catch (err) {
                // A missing badge is not worth surfacing to anyone.
            }
        };

        check();

        // Someone leaves a tab open all day; a check every couple of minutes
        // keeps the number roughly honest without hammering anything.
        const timer = setInterval(check, 120000);

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, []);

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
