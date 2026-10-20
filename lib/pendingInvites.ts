// Co-host invitations still waiting on the signed-in person — so an invitation
// can't be missed when the email lands in junk and no push arrives. Shown the
// way Airbnb shows them: a banner on the dashboard and the home page, and a
// line in the menu with its dot, each with Accept and Decline.
//
// An invitation is theirs when it was sent to their sign-in address — the same
// test the accept route applies (the invite is bound to the address it went
// to), so nothing shown here can then be refused there. Holiday lets and
// businesses (experiences and trades) alike — one system (lib/cohostTargets).

import { LISTING_TARGET, PROVIDER_TARGET, type CohostTarget } from './cohostTargets';

export type PendingInvite = {
    token: string;
    // A holiday let's invitation, or a business's (an experience or a trade).
    kind: 'listing' | 'provider';
    listingId: string;
    listingTitle: string;
    role: 'co_host' | 'staff';
    inviterFirst: string;
    invitedAt: string;
};

async function invitesIn(admin: any, address: string, target: CohostTarget): Promise<PendingInvite[]> {
    const { data: rows } = await admin
        .from(target.table)
        .select('invite_token, role, invited_by, invited_at, email, ' + target.fk)
        .eq('status', 'invited')
        .ilike('email', address.replace(/[\\%_]/g, '\\$&'))
        .order('invited_at', { ascending: false })
        .limit(20);
    const invites = (rows || []).filter((r: any) => r.invite_token && String(r.email || '').toLowerCase() === address);
    if (invites.length === 0) return [];

    const parentIds = Array.from(new Set(invites.map((r: any) => r[target.fk])));
    const inviterIds = Array.from(new Set(invites.map((r: any) => r.invited_by).filter(Boolean)));
    const [{ data: parents }, { data: inviters }] = await Promise.all([
        admin.from(target.parent).select('id, ' + target.titleCol).in('id', parentIds),
        inviterIds.length
            ? admin.from('profiles').select('id, first_name, preferred_name').in('id', inviterIds)
            : Promise.resolve({ data: [] }),
    ]);
    const titles: Record<string, string> = {};
    (parents || []).forEach((l: any) => { titles[l.id] = l[target.titleCol]; });
    const names: Record<string, string> = {};
    (inviters || []).forEach((p: any) => { names[p.id] = (p.preferred_name || p.first_name || '').trim(); });

    // One per listing (or business): the newest, if an owner sent it more than once.
    const seen = new Set<string>();
    const out: PendingInvite[] = [];
    for (const r of invites) {
        const id = r[target.fk];
        if (seen.has(id) || !titles[id]) continue;
        seen.add(id);
        out.push({
            token: r.invite_token,
            kind: target.kind,
            listingId: id,
            listingTitle: titles[id],
            role: r.role === 'staff' ? 'staff' : 'co_host',
            inviterFirst: names[r.invited_by] || 'The owner',
            invitedAt: r.invited_at,
        });
    }
    return out;
}

export async function pendingInvitesFor(admin: any, email: string | null | undefined): Promise<PendingInvite[]> {
    const address = String(email || '').trim().toLowerCase();
    if (!address) return [];
    const [lets, businesses] = await Promise.all([
        invitesIn(admin, address, LISTING_TARGET),
        invitesIn(admin, address, PROVIDER_TARGET),
    ]);
    return lets.concat(businesses).sort((a, b) => String(b.invitedAt).localeCompare(String(a.invitedAt)));
}
