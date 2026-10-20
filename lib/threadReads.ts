// What counts as unread, for whom — one rule for the inbox list, the badge and
// the menu dot.
//
// Two ways a message can be waiting for someone:
//
//   1. It was addressed to them (recipient_id) and they have not opened it
//      (read_at is null). The guest and the owner, as it has always been.
//   2. They are on the TEAM side of the thread — the owner or a co-host of the
//      property, or of the business on an experience or a trade — and it is
//      newer than how far they have read (thread_reads). This is what lets a
//      co-host see the guest's question, and the owner's reply, as new: a
//      co-host is never the recipient of anything.
//
// And one way it never can: something they sent themselves. That holds even
// when a message is addressed to its own sender, which happens on a stay the
// owner booked at their own property (guest and host are one account, and
// recipient_id cannot be empty). 20/10/2026: Liam's own message on such a stay
// showed as unread to him — bold, in the badge and the menu dot.
//
// Automated messages (the check-in message, door-code updates) are the host
// side's own words going out, so they are never new to the team.

/** Before this, nobody on a team had a read position; anything older counts as
 *  read, so the day this landed nobody's inbox lit up with history. */
export const TEAM_READS_FROM = '2026-10-20T00:00:00Z';

export type ThreadKind = 'booking' | 'order' | 'enquiry';

export interface MessageForCount {
    sender_id: string | null;
    recipient_id: string | null;
    read_at: string | null;
    created_at: string;
    automated?: boolean | null;
}

function after(a: string, b: string): boolean {
    // Parsed, not compared as strings: Postgres and JS write offsets differently.
    return new Date(a).getTime() > new Date(b).getTime();
}

/**
 * Whether this message is one this person has still to read.
 *
 * `team` says they are on the host's or the business's side of the thread;
 * `readTo` is their thread_reads position there, if they have one.
 */
export function isUnreadFor(
    m: MessageForCount,
    uid: string,
    team: boolean,
    readTo?: string | null
): boolean {
    if (m.sender_id === uid) return false;
    if (m.recipient_id === uid) return !m.read_at;
    if (!team || m.automated) return false;
    return after(m.created_at, readTo || TEAM_READS_FROM);
}

/**
 * Whether this message is one that arrives FOR this person at all, read or not
 * — what brings an archived conversation back to the inbox.
 */
export function isInboundFor(m: MessageForCount, uid: string, team: boolean): boolean {
    if (m.sender_id === uid) return false;
    if (m.recipient_id === uid) return true;
    return team && !m.automated;
}

export function threadKey(kind: ThreadKind, id: string): string {
    return kind + ':' + id;
}

/** This person's read positions, keyed 'booking:<id>' / 'order:<id>' / 'enquiry:<id>'. */
export async function readPositionsFor(admin: any, uid: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    try {
        const { data } = await admin
            .from('thread_reads')
            .select('thread_kind, thread_id, read_at')
            .eq('user_id', uid);
        (data || []).forEach((r: any) => { out[threadKey(r.thread_kind, r.thread_id)] = r.read_at; });
    } catch {
        // No positions is the same as none recorded yet: never fail an inbox.
    }
    return out;
}

/**
 * Marks a whole thread read for one person: everything addressed to them, and
 * their team read position moved to now. Called when they open it AND when
 * they send in it — replying is reading, however the thread came to be open.
 *
 * The caller has already checked they may see the thread. Never throws.
 */
export async function markThreadRead(admin: any, uid: string, kind: ThreadKind, id: string): Promise<void> {
    const now = new Date().toISOString();
    try {
        await admin
            .from('messages')
            .update({ read_at: now })
            .eq(kind + '_id', id)
            .eq('recipient_id', uid)
            .is('read_at', null);
    } catch {
        // fall through to the position, which still clears the team side
    }
    try {
        await admin
            .from('thread_reads')
            .upsert({ user_id: uid, thread_kind: kind, thread_id: id, read_at: now }, { onConflict: 'user_id,thread_kind,thread_id' });
    } catch {
        // never stop a send or an open over a read position
    }
}

/**
 * Puts a team read position back to just before the newest message from
 * someone else, so that message shows as unread again. Returns whether there
 * was such a message. Never throws.
 */
export async function markThreadUnreadForTeam(admin: any, uid: string, kind: ThreadKind, id: string): Promise<boolean> {
    try {
        const { data: last } = await admin
            .from('messages')
            .select('created_at, sender_id, recipient_id')
            .eq(kind + '_id', id)
            .neq('sender_id', uid)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (!last) return false;
        const before = new Date(new Date(last.created_at).getTime() - 1).toISOString();
        await admin
            .from('thread_reads')
            .upsert({ user_id: uid, thread_kind: kind, thread_id: id, read_at: before }, { onConflict: 'user_id,thread_kind,thread_id' });
        return true;
    } catch {
        return false;
    }
}
