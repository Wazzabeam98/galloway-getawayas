// Co-host invitations still waiting on the signed-in person — so an invitation
// can't be missed when the email lands in junk and no push arrives. Shown the
// way Airbnb shows them: a banner on the dashboard and the home page, and a
// line in the menu with its dot, each with Accept and Decline.
//
// An invitation is theirs when it was sent to their sign-in address — the same
// test the accept route applies (the invite is bound to the address it went
// to), so nothing shown here can then be refused there.

export type PendingInvite = {
    token: string;
    listingId: string;
    listingTitle: string;
    role: 'co_host' | 'staff';
    inviterFirst: string;
    invitedAt: string;
};

export async function pendingInvitesFor(admin: any, email: string | null | undefined): Promise<PendingInvite[]> {
    const address = String(email || '').trim().toLowerCase();
    if (!address) return [];
    const { data: rows } = await admin
        .from('listing_access')
        .select('invite_token, listing_id, role, invited_by, invited_at, email')
        .eq('status', 'invited')
        .ilike('email', address.replace(/[\\%_]/g, '\\$&'))
        .order('invited_at', { ascending: false })
        .limit(20);
    const invites = (rows || []).filter((r: any) => r.invite_token && String(r.email || '').toLowerCase() === address);
    if (invites.length === 0) return [];

    const listingIds = Array.from(new Set(invites.map((r: any) => r.listing_id)));
    const inviterIds = Array.from(new Set(invites.map((r: any) => r.invited_by).filter(Boolean)));
    const [{ data: listings }, { data: inviters }] = await Promise.all([
        admin.from('listings').select('id, title').in('id', listingIds),
        inviterIds.length
            ? admin.from('profiles').select('id, first_name, preferred_name').in('id', inviterIds)
            : Promise.resolve({ data: [] }),
    ]);
    const titles: Record<string, string> = {};
    (listings || []).forEach((l: any) => { titles[l.id] = l.title; });
    const names: Record<string, string> = {};
    (inviters || []).forEach((p: any) => { names[p.id] = (p.preferred_name || p.first_name || '').trim(); });

    // One per listing: the newest, if an owner sent it more than once.
    const seen = new Set<string>();
    const out: PendingInvite[] = [];
    for (const r of invites) {
        if (seen.has(r.listing_id) || !titles[r.listing_id]) continue;
        seen.add(r.listing_id);
        out.push({
            token: r.invite_token,
            listingId: r.listing_id,
            listingTitle: titles[r.listing_id],
            role: r.role === 'staff' ? 'staff' : 'co_host',
            inviterFirst: names[r.invited_by] || 'The owner',
            invitedAt: r.invited_at,
        });
    }
    return out;
}
