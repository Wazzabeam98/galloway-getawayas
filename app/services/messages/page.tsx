import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// A provider's messages now live in the one three-pane inbox at /messages, which
// includes their order and job threads and shows the reservation card beside each
// one. This flat list is folded into it; kept as a redirect for old links.
export default function ProviderMessagesRedirect() {
    redirect('/messages');
}
