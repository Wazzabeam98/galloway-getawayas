import HostFork from '@/components/business/HostFork';
import { guestExperiencesOpen } from '@/lib/serviceOrders';

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
// Guest experiences are held until the host terms are back from the solicitor.
// GUEST_EXPERIENCES_OPEN already locks the guest-facing side (browsing and
// booking), but NOT this front door — so today someone can start the twelve-
// screen guest-experience sign-up and finish it into a listing that can never
// take bookings. Reading the same flag HERE (it is server-only, so a server
// component reads it and hands the answer to the client fork) greys that one
// tile with a "coming soon" line. It is a front-door change only: the flow
// behind it is untouched, and flipping the flag brings the tile back in one
// step, no code change.

export default function BusinessPage() {
    return <HostFork guestExperiencesOpen={guestExperiencesOpen()} />;
}
