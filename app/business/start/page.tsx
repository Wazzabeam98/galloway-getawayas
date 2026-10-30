import type { Metadata } from 'next';
import HostFork from '@/components/business/HostFork';
import { businessSignupsOpen } from '@/lib/serviceOrders';

// "What would you like to host?" — the three-tile fork, now one step in, behind
// the landing page's Get started button the way Airbnb's picker sits behind
// airbnb.co.uk/host/homes. It used to BE /business, which left the page meant
// to rank for "list a holiday let in Dumfries & Galloway" with 38 words on it;
// Google crawled it and declined to index it (Search Console, Oct 2026).
//
// The flag and the held "coming soon" state are unchanged — see HostFork.
//
// A step in a flow, not a search result: noindex, but follow.
export const metadata: Metadata = {
    title: 'What would you like to host?',
    robots: { index: false, follow: true },
};

// Read on every request, never frozen into a build (see register-interest).
export const dynamic = 'force-dynamic';

export default function BusinessStartPage() {
    return <HostFork signupsOpen={businessSignupsOpen()} />;
}
