// The two people on an enquiry thread, worked out once.
//
// A thread hangs off an accepted job (and stays after a cancel — that is
// exactly when there is something to sort out). The two participants are the
// enquiry's host and the owner of the provider it was sent to; nobody else,
// which is what the RLS on messages enforces and what this mirrors in code so
// the routes can authorise and name the other side.

export type EnquiryThreadContext = {
    enquiry: any;
    provider: any;
    isHost: boolean;
    isProvider: boolean;
    otherId: string;      // the person the viewer is talking to
    otherName: string;    // a business name when the viewer is the host
    viewerId: string;
};

// Returns the context if `uid` is a participant, else null. `admin` is a
// service-role client.
export async function enquiryThreadContext(
    admin: any,
    enquiryId: string,
    uid: string
): Promise<EnquiryThreadContext | null> {
    const { data: enquiry } = await admin
        .from('service_enquiries')
        .select('id, reference, trade, business_name, summary, status, preferred_date, window_from, window_to, host_id, host_name, provider_id, listing_id, cancelled_by, cancel_reason')
        .eq('id', enquiryId)
        .maybeSingle();
    if (!enquiry) return null;

    const { data: provider } = await admin
        .from('service_providers')
        .select('id, owner_id, business_name, contact_email')
        .eq('id', enquiry.provider_id)
        .maybeSingle();

    const isHost = enquiry.host_id === uid;
    const isProvider = !!provider && provider.owner_id === uid;
    if (!isHost && !isProvider) return null;

    // The host talks to a business; the tradesman talks to a person.
    const otherId = isHost ? (provider ? provider.owner_id : '') : enquiry.host_id;
    const otherName = isHost
        ? String((provider && provider.business_name) || enquiry.business_name || 'The tradesman')
        : String(enquiry.host_name || 'The host');

    return { enquiry, provider, isHost, isProvider, otherId, otherName, viewerId: uid };
}

export type ThreadListItem = {
    enquiryId: string;
    reference: string;
    status: string;
    otherName: string;
    summary: string;
    lastBody: string | null;
    lastAt: string | null;
    unread: number;
    cancelled: boolean;
};

// Every job thread this person can navigate to — the tradesman's home for
// messages that isn't a lost email, and the reason a cancelled job stays
// reachable. Accepted and cancelled jobs where they are the host or own the
// provider, newest activity first, unread on top.
export async function listEnquiryThreadsFor(admin: any, uid: string): Promise<ThreadListItem[]> {
    const { data: mine } = await admin
        .from('service_providers')
        .select('id')
        .eq('owner_id', uid);
    const providerIds = (mine || []).map((p: any) => p.id);

    // Host on it, or owner of the provider it went to.
    let orClause = 'host_id.eq.' + uid;
    if (providerIds.length) orClause += ',provider_id.in.(' + providerIds.join(',') + ')';

    const { data: enquiries } = await admin
        .from('service_enquiries')
        .select('id, reference, trade, business_name, summary, status, host_id, host_name, provider_id')
        .or(orClause)
        .in('status', ['accepted', 'cancelled']);

    const rows = enquiries || [];
    if (!rows.length) return [];

    const ids = rows.map((e: any) => e.id);
    const { data: msgs } = await admin
        .from('messages')
        .select('enquiry_id, body, created_at, recipient_id, read_at')
        .in('enquiry_id', ids)
        .order('created_at', { ascending: false });

    const last: Record<string, any> = {};
    const unread: Record<string, number> = {};
    for (const m of msgs || []) {
        if (!last[m.enquiry_id]) last[m.enquiry_id] = m;
        if (m.recipient_id === uid && !m.read_at) unread[m.enquiry_id] = (unread[m.enquiry_id] || 0) + 1;
    }

    const items: ThreadListItem[] = rows.map((e: any) => {
        const isHost = e.host_id === uid;
        return {
            enquiryId: e.id,
            reference: e.reference,
            status: e.status,
            otherName: isHost ? String(e.business_name || 'The tradesman') : String(e.host_name || 'The host'),
            summary: e.summary,
            lastBody: last[e.id] ? String(last[e.id].body) : null,
            lastAt: last[e.id] ? String(last[e.id].created_at) : null,
            unread: unread[e.id] || 0,
            cancelled: e.status === 'cancelled',
        };
    });

    items.sort((a, b) => {
        if ((b.unread > 0 ? 1 : 0) !== (a.unread > 0 ? 1 : 0)) return (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0);
        const at = a.lastAt || '';
        const bt = b.lastAt || '';
        if (at && bt) return at < bt ? 1 : -1;
        if (at) return -1;
        if (bt) return 1;
        return 0;
    });

    return items;
}
