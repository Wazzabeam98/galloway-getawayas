'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, Inbox } from 'lucide-react';
import useBadgeCounts from '@/components/base/useBadgeCounts';

// "Anything needing a reply", on the Today view. Shares the one /api/badges
// poll the menu and the hosting bar already use, so the three can never show
// different numbers. Renders nothing when there is nothing waiting — a host
// with a clear inbox sees no empty strip.
export default function HostTodayAlerts() {
    const { pending, unread } = useBadgeCounts(true);
    // The counts live at module scope and are shared with the hosting bar and
    // menu, so by the time this hydrates another component may already have
    // fetched them — which would make the first client render (a populated
    // strip) differ from the server's (empty), a hydration mismatch. Render
    // nothing until mounted, so the first client paint matches the server; the
    // strip then appears on the next tick. Same reason the hosting bar gates
    // its badges on `mounted`.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    if (!mounted || (!pending && !unread)) return null;

    return (
        <div className="flex flex-wrap gap-3 mb-5">
            {pending > 0 && (
                <Link
                    href="/dashboard/bookings"
                    className="flex items-center gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 transition"
                >
                    <Inbox className="w-4 h-4 flex-none" />
                    {pending === 1 ? '1 booking request to review' : `${pending} booking requests to review`}
                </Link>
            )}
            {unread > 0 && (
                <Link
                    href="/messages"
                    className="flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:border-slate-300 transition"
                >
                    <MessageCircle className="w-4 h-4 flex-none" />
                    {unread === 1 ? '1 unread message' : `${unread} unread messages`}
                </Link>
            )}
        </div>
    );
}
