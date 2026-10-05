'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, Home, LayoutGrid, MessageCircle, PoundSterling, Sun } from 'lucide-react';
import useBadgeCounts from './useBadgeCounts';

// The persistent hosting bar, Airbnb's shape: Today, Calendar, Listings,
// Bookings, Messages and Earnings always in reach while a host is hosting,
// rather than one layer down the account menu. It sits under the main nav and
// shows ONLY in hosting mode for someone who actually hosts — a traveller, and
// a host who has switched to travelling, never see it.
//
// A client component because it reads the current path to light the active tab
// and shares the one /api/badges poll (useBadgeCounts) that already feeds the
// menu, so Bookings and Messages carry the same counts the menu does and the
// two can never disagree.

type Item = {
    href: string;
    label: string;
    icon: typeof Home;
    // How the current path is matched to decide the active tab.
    match: (path: string) => boolean;
    badge?: 'pending' | 'unread';
};

// Today and Listings both live on /dashboard — Today is the top of the page,
// Listings the grid below it (an anchor) — so Today owns the bare /dashboard
// path and Listings lights up on the listing editor instead, where a host
// working on a property actually is.
const ITEMS: Item[] = [
    { href: '/dashboard', label: 'Today', icon: Sun, match: (p) => p === '/dashboard' },
    { href: '/dashboard/calendar', label: 'Calendar', icon: CalendarDays, match: (p) => p.startsWith('/dashboard/calendar') },
    { href: '/dashboard#listings', label: 'Listings', icon: LayoutGrid, match: (p) => p.startsWith('/edit-listing') },
    { href: '/dashboard/bookings', label: 'Bookings', icon: Home, match: (p) => p.startsWith('/dashboard/bookings'), badge: 'pending' },
    { href: '/messages', label: 'Messages', icon: MessageCircle, match: (p) => p.startsWith('/messages'), badge: 'unread' },
    { href: '/dashboard/earnings', label: 'Earnings', icon: PoundSterling, match: (p) => p.startsWith('/dashboard/earnings') },
];

export default function HostNav({ mode, isHost }: { mode: 'host' | 'travel'; isHost: boolean }) {
    const pathname = usePathname() || '';
    const { pending, unread } = useBadgeCounts(isHost && mode === 'host');
    // The badge counts are shared module state, so they can be populated before
    // this hydrates — showing a badge the server didn't render would be a
    // hydration mismatch. Gate the counts on mount: the bar's structure is
    // identical server and client, and the badges appear a tick later.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // Hosting mode only, and only for someone who hosts.
    if (!isHost || mode !== 'host') return null;

    // The listing-preview pages (a host looking at their own place as a guest
    // would) run their own sticky section bar and un-stick the main nav, so a
    // second sticky bar there would float with nothing above it. The hosting
    // bar steps aside on exactly those routes.
    if (pathname.startsWith('/homes/') || pathname.startsWith('/experiences/browse/')) return null;

    const countFor = (badge?: 'pending' | 'unread') => {
        if (!mounted) return 0;
        return badge === 'pending' ? pending : badge === 'unread' ? unread : 0;
    };

    return (
        <nav
            aria-label="Hosting"
            className="w-full border-b bg-white sticky top-20 z-40"
        >
            <div className="max-w-7xl mx-auto px-6 md:px-10">
                <ul className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar">
                    {ITEMS.map((item) => {
                        const active = item.match(pathname);
                        const count = countFor(item.badge);
                        const Icon = item.icon;
                        return (
                            <li key={item.label} className="flex-none">
                                <Link
                                    href={item.href}
                                    aria-current={active ? 'page' : undefined}
                                    className={`relative flex items-center gap-2 whitespace-nowrap border-b-2 px-2 sm:px-3 py-3 text-sm font-semibold transition ${
                                        active
                                            ? 'border-slate-900 text-slate-900'
                                            : 'border-transparent text-slate-500 hover:text-slate-900'
                                    }`}
                                >
                                    <Icon className="w-4 h-4 flex-none" />
                                    <span>{item.label}</span>
                                    {count > 0 && (
                                        <span className="text-[11px] font-bold text-white bg-emerald-700 rounded-full px-1.5 py-0.5 leading-none">
                                            {count > 99 ? '99+' : count}
                                        </span>
                                    )}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </nav>
    );
}
