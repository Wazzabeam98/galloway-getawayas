import HostFork from '@/components/business/HostFork';
import { businessSignupsOpen } from '@/lib/serviceOrders';

export const metadata = {
    // The root layout appends ' | Galloway Getaways' to every page title.
    title: 'Start hosting',
    description:
        'List a home or holiday let, host a guest experience, or offer a service — '
        + 'the one place to start, for everyone with something to offer in Dumfries & Galloway.',
    alternates: { canonical: '/business' },
};

// The single fork — one page, three tiles — replacing the old two-card "Set up
// a business". It renders as a focused full-screen takeover (see HostFork), so
// the global header does not compete with the one decision. Every "become a
// host / list your property / set up a business" link on the site lands here.
//
// The tiles are a front door; the flows behind them are unchanged:
//   • home / holiday let → /addhome
//   • guest experience   → /services/join?trade=guest
//   • service            → /services/join
//
// All three tiles are held behind a "coming soon" state on PRODUCTION until the
// host/provider terms are back from the solicitor. businessSignupsOpen() (read
// on the SERVER here and handed to the client fork) decides it: held on prod
// until BUSINESS_SIGNUPS_OPEN=true, always open on previews and local so the
// flows stay walkable. It is a front-door change only — the flows behind the
// tiles, and every existing host and tradesman, are untouched — and flipping
// the one flag brings all three tiles back together, no code change.

export default function BusinessPage() {
    return <HostFork signupsOpen={businessSignupsOpen()} />;
}
