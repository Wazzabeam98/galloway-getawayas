'use client';

import { usePathname } from 'next/navigation';

// The full-page takeover routes — the fork and the two sign-up wizards. Each
// paints its own fixed inset-0 shell with its own top bar, so the global site
// header (and footer) must not be there at all: relying on the takeover to
// cover them is fragile — one browser that doesn't, or a moment before hydration
// paints the overlay, and the site chrome shows through and the takeover reads
// like an ordinary page with a form on it. This keeps the chrome out of the DOM
// entirely on those routes.
//
// Matches the route and anything under it, so /services/join and its children
// (and query strings, which usePathname drops) are all covered.
export const TAKEOVER_ROUTES = ['/services/join', '/business', '/addhome'];

export function isTakeoverRoute(pathname: string): boolean {
    return TAKEOVER_ROUTES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// Renders the global chrome (its children) everywhere except the takeover
// routes, where it renders nothing.
export default function ChromeGate({ children }: { children: React.ReactNode }) {
    const pathname = usePathname() || '';
    if (isTakeoverRoute(pathname)) return null;
    return <>{children}</>;
}
