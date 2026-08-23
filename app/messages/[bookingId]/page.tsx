// One conversation, on its own, is not a screen any more.
//
// This used to be the whole messages experience for a guest: a mobile-width
// column stranded in the middle of a desktop page, with the thread and
// nothing else. Hosts had long since moved to /messages, which puts the list,
// the conversation and the booking behind it side by side — and a guest wants
// the dates, the balance and the check-in time beside the thread every bit as
// much as a host wants the guest's.
//
// So there is one messages screen now, and this address opens it on the
// conversation asked for. It is kept rather than deleted because it is in
// every message email already sent, in the Message host and Message guest
// buttons, and in whatever anyone has bookmarked.
//
// The draft carries through: 'Ask the guest to cancel' on the booking screen
// sends the host here with the awkward part already written, and /messages
// picks the same parameter up and puts it in the composer without sending it.
import { redirect } from 'next/navigation';

export default function ConversationPage({
    params,
    searchParams,
}: {
    params: { bookingId: string };
    searchParams: { draft?: string | string[] };
}) {
    const raw = searchParams && searchParams.draft;
    const draft = typeof raw === 'string' ? raw : '';

    redirect(
        '/messages?b=' + encodeURIComponent(params.bookingId) +
        (draft ? '&draft=' + encodeURIComponent(draft) : '')
    );
}
