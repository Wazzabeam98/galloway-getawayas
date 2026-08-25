'use client';

import { usePathname } from 'next/navigation';

// Which footer a page gets.
//
// The sign-up for service providers is five screens of form on a phone, filled
// in by somebody sitting in a van. Ending that with the Guests / Hosting /
// Company link columns adds half a screen of scroll to a page where nobody is
// browsing — so those pages get the legal line and nothing else.
//
// Both footers are passed in as elements rather than imported here, so the
// full one stays a server component and none of its markup ships as JavaScript
// to every other page.
const MINIMAL_ON = ['/services/join'];

export default function FooterSwitch({
    full,
    minimal,
}: {
    full: React.ReactNode;
    minimal: React.ReactNode;
}) {
    const pathname = usePathname() || '';
    return <>{MINIMAL_ON.indexOf(pathname) === -1 ? full : minimal}</>;
}
