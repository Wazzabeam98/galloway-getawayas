import { redirect } from 'next/navigation';

// Private to the person it belongs to, so never a search result. Said here
// rather than left to robots.txt: a crawler that finds the URL can still read
// a noindex, and without one this page had neither a canonical nor a noindex.
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

// A provider's messages now live in the one three-pane inbox at /messages, which
// includes their order and job threads and shows the reservation card beside each
// one. This flat list is folded into it; kept as a redirect for old links.
export default function ProviderMessagesRedirect() {
    redirect('/messages');
}
