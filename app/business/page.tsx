import HostFork from '@/components/business/HostFork';

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

export default function BusinessPage() {
    return <HostFork />;
}
