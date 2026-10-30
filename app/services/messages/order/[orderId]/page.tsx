import { redirect } from 'next/navigation';

// Private to the person it belongs to, so never a search result. Said here
// rather than left to robots.txt: a crawler that finds the URL can still read
// a noindex, and without one this page had neither a canonical nor a noindex.
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

// This standalone single-thread page has been folded into the three-pane
// messages inbox: an order thread now opens at /messages?o=<id> with its
// reservation card on the right, the same as every other Message button. Kept as
// a redirect so old links (emails, bookmarks) still land in the right place.
export default function ProviderOrderThreadRedirect({ params }: { params: { orderId: string } }) {
    redirect('/messages?o=' + params.orderId);
}
