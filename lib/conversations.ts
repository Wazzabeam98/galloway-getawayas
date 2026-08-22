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
