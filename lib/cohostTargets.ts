// The two things a person can be a co-host OF: a holiday let (listing_access)
// or a service business — a guest experience or a trade (provider_access). The
// invite, accept, decline, manage and pending-invite routes are one system, so
// they read the differences from here rather than growing a second copy.

export type CohostKind = 'listing' | 'provider';

export interface CohostTarget {
    kind: CohostKind;
    // The grant table and its column pointing at the thing.
    table: 'listing_access' | 'provider_access';
    fk: 'listing_id' | 'provider_id';
    // The thing itself, who owns it, and what it is called.
    parent: 'listings' | 'service_providers';
    ownerCol: 'host_id' | 'owner_id';
    titleCol: 'title' | 'business_name';
    // The unique index that refuses a second live grant to one address.
    uniqueIndex: string;
    // Where the owner manages co-hosts, and where a co-host lands on accepting.
    peopleUrl: string;
    homeUrl: string;
    // Words for the emails and the invitation page.
    noun: string;          // "property" / "business"
    fallbackTitle: string; // "a property" / "a business"
    footer: string;        // why the owner is receiving an email
}

export const LISTING_TARGET: CohostTarget = {
    kind: 'listing',
    table: 'listing_access',
    fk: 'listing_id',
    parent: 'listings',
    ownerCol: 'host_id',
    titleCol: 'title',
    uniqueIndex: 'listing_access_unique_person',
    peopleUrl: '/dashboard/people',
    homeUrl: '/dashboard',
    noun: 'property',
    fallbackTitle: 'a property',
    footer: 'You’re receiving this because you host on Galloway Getaways.',
};

export const PROVIDER_TARGET: CohostTarget = {
    kind: 'provider',
    table: 'provider_access',
    fk: 'provider_id',
    parent: 'service_providers',
    ownerCol: 'owner_id',
    titleCol: 'business_name',
    uniqueIndex: 'provider_access_unique_person',
    peopleUrl: '/services/dashboard/people',
    homeUrl: '/services/dashboard',
    noun: 'business',
    fallbackTitle: 'a business',
    footer: 'You’re receiving this because you run a business on Galloway Getaways.',
};

export function cohostTarget(kind: unknown): CohostTarget {
    return kind === 'provider' ? PROVIDER_TARGET : LISTING_TARGET;
}

// Find an invitation by its token in either table. Tokens are random uuids, so
// one can only ever be in one of them.
export async function inviteByToken(admin: any, token: string, columns: string): Promise<{ target: CohostTarget; invite: any } | null> {
    if (!token) return null;
    for (const target of [LISTING_TARGET, PROVIDER_TARGET]) {
        const { data } = await admin
            .from(target.table)
            .select(columns + ', ' + target.fk)
            .eq('invite_token', token)
            .maybeSingle();
        if (data) return { target, invite: { ...data, parent_id: data[target.fk] } };
    }
    return null;
}
