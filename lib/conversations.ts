// Whether a conversation counts as archived for one person.
//
// Archiving means "done with this for now", not "stop telling me". A message
// arriving afterwards brings the conversation back to the inbox and it counts
// as unread again — a guest asking about next week's stay must never sit in a
// folder nobody looks at.
//
// So archived is worked out rather than stored: it holds only while the
// person's archived_at is set and nothing has been sent to them since. That
// means the un-archiving needs no write of its own, and there is no trigger
// on message insert that could be missed. Archiving again just moves
// archived_at forward past those messages.
//
// lastInboundAt is the newest message addressed to this person in the
// conversation, read or unread. Read messages count: one that arrived after
// they archived it already brought the conversation back, whether or not
// they have since opened it.

export function isArchived(
    archivedAt: string | null | undefined,
    lastInboundAt: string | null | undefined
): boolean {
    if (!archivedAt) return false;
    if (!lastInboundAt) return true;

    // Parsed rather than compared as strings. Both come out of Postgres in the
    // same shape today, but a string comparison quietly gives the wrong answer
    // the day one of them arrives with a different timezone offset.
    return new Date(lastInboundAt).getTime() <= new Date(archivedAt).getTime();
}

// Whether a conversation is waiting on this person for an answer.
//
// The rule on its own is simply "the newest message in the thread was not
// mine". That is the honest signal, and it is also why the count needed
// something more: a thread that ends "thanks!" needs no answer, so nothing
// will ever clear it, and a needs-reply count that includes half a dozen of
// those is a count people learn to ignore.
//
// So "no reply needed" is an acknowledgement rather than a dismissal, and it
// is worked out the same way archiving is: it holds only while nothing newer
// has been said. A guest who follows "thanks!" with a real question puts the
// thread straight back in the count, with nothing to write and no trigger on
// message insert that could be missed.
//
// Compared against the newest message rather than the newest one addressed to
// this person, because a co-host is not the recipient_id on anything — those
// messages are addressed to the owner — and would otherwise have no timestamp
// to compare against at all.
export function needsReply(
    lastMessage: { sender_id: string; created_at: string } | null | undefined,
    userId: string,
    noReplyNeededAt?: string | null
): boolean {
    if (!lastMessage) return false;
    if (lastMessage.sender_id === userId) return false;
    if (!noReplyNeededAt) return true;

    // Parsed rather than compared as strings, for the reason given above.
    return new Date(lastMessage.created_at).getTime() > new Date(noReplyNeededAt).getTime();
}
