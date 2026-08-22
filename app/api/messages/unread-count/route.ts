import { isArchived } from '@/lib/conversations';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Just the number, for the badge in the menu.
//
// Kept separate from the threads route on purpose: that one builds the whole
// inbox, and the menu is on every page.
//
// Archived conversations are left out, so this agrees with the list. The
// common case costs exactly what it used to — one counting query — because
// almost nobody has anything archived, and the extra work only happens when
// they do.
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { session } } = await supabase.auth.getSession();

    if (!session || !session.user) {
        return NextResponse.json({ unread: 0 });
    }

    const uid = session.user.id;

    const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', uid)
        .is('read_at', null);

    const total = count || 0;

    if (total === 0) {
        return NextResponse.json({ unread: 0 });
    }

    const { data: archivedPrefs } = await supabase
        .from('conversation_prefs')
        .select('booking_id, archived_at')
        .eq('user_id', uid)
        .not('archived_at', 'is', null);

    if (!archivedPrefs || archivedPrefs.length === 0) {
        return NextResponse.json({ unread: total });
    }

    const archivedIds = archivedPrefs.map((p: any) => p.booking_id);

    // Every message addressed to this person in those conversations, read ones
    // included. A read message that arrived after they archived it has already
    // brought the conversation back, and once it is back its older unread
    // messages have to be counted again too.
    const { data: inbound } = await supabase
        .from('messages')
        .select('booking_id, created_at, read_at')
        .eq('recipient_id', uid)
        .in('booking_id', archivedIds);

    const lastInbound: Record<string, string> = {};
    const unreadPer: Record<string, number> = {};

    (inbound || []).forEach((m: any) => {
        if (!lastInbound[m.booking_id] || m.created_at > lastInbound[m.booking_id]) {
            lastInbound[m.booking_id] = m.created_at;
        }
        if (!m.read_at) {
            unreadPer[m.booking_id] = (unreadPer[m.booking_id] || 0) + 1;
        }
    });

    let hidden = 0;
    archivedPrefs.forEach((p: any) => {
        if (isArchived(p.archived_at, lastInbound[p.booking_id])) {
            hidden += unreadPer[p.booking_id] || 0;
        }
    });

    return NextResponse.json({ unread: Math.max(0, total - hidden) });
}
