'use client';

import { usePathname } from 'next/navigation';
import { isTakeoverRoute } from '@/components/base/ChromeGate';

// Which footer a page gets.
//
// The full-page takeover routes (the fork and the sign-up wizards) get NO
// footer — they paint their own fixed inset-0 shell, and a footer rendered
// behind it only shows through where the overlay doesn't cover, making the
// takeover read like an ordinary page. Everywhere else gets the full footer.
//
// Both footers are passed in as elements rather than imported here, so the
// full one stays a server component and none of its markup ships as JavaScript
// to every other page. `minimal` is kept for any route that wants the legal
// line only; none use it today, so the takeover routes render nothing.
const MINIMAL_ON: string[] = [];

export default function FooterSwitch({
    full,
    minimal,
}: {
    full: React.ReactNode;
    minimal: React.ReactNode;
}) {
    const pathname = usePathname() || '';
    if (isTakeoverRoute(pathname)) return null;
    return <>{MINIMAL_ON.indexOf(pathname) === -1 ? full : minimal}</>;
}
