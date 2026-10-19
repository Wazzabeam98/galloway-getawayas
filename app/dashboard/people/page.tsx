import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminClient } from '@/lib/supabaseAdmin';
import { accessibleListings, isFullAccess } from '@/lib/access';
import { displayName } from '@/lib/utils';
import PeopleManager, { ManagedListing, Person } from '@/components/PeopleManager';

export const dynamic = 'force-dynamic';

// Who may open this page and hand out access: the owner, or a full-access
// co-host — the owner's equal. Only the owner may still create another
// full-access co-host (the route enforces it); the page tells each manager which
// listings are theirs to own so it never offers more than that.
export default async function PeoplePage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getUser();

    if (!auth || !auth.user) redirect('/');
    const uid = auth.user.id;

    const access = await accessibleListings(uid);
    const manageable = access.filter((a) => isFullAccess(a));
    const manageableIds = manageable.map((a) => a.listingId);

    const admin = adminClient();

    const { data: listingRows } = manageableIds.length
        ? await admin.from('listings').select('id, title, host_id').in('id', manageableIds).order('title')
        : { data: [] as any[] };

    // Everyone who already has access to those listings, the owner aside.
    const { data: accessRows } = manageableIds.length
        ? await admin
              .from('listing_access')
              .select('id, listing_id, user_id, email, status, can_calendar, can_messages, can_bookings, can_listing, can_earnings')
              .in('listing_id', manageableIds)
              .neq('status', 'revoked')
              .order('invited_at', { ascending: false })
        : { data: [] as any[] };

    // Names for the people (owners and linked co-hosts) in one read.
    const profileIds = Array.from(
        new Set([
            ...(listingRows || []).map((l: any) => l.host_id),
            ...(accessRows || []).map((r: any) => r.user_id).filter(Boolean),
        ])
    );
    const { data: profiles } = profileIds.length
        ? await admin.from('profiles').select('id, full_name, first_name, last_name, preferred_name, show_full_name').in('id', profileIds)
        : { data: [] as any[] };
    const nameOf: Record<string, string> = {};
    (profiles || []).forEach((p: any) => { nameOf[p.id] = displayName(p, ''); });

    const ownerIsViewer = (hostId: string) => hostId === uid;

    const listings: ManagedListing[] = (listingRows || []).map((l: any) => ({
        id: l.id,
        title: l.title || 'Untitled listing',
        viewerIsOwner: ownerIsViewer(l.host_id),
        primaryHost: {
            name: ownerIsViewer(l.host_id) ? (nameOf[l.host_id] || 'You') : (nameOf[l.host_id] || 'The owner'),
            isYou: ownerIsViewer(l.host_id),
        },
    }));

    const people: Person[] = (accessRows || []).map((r: any) => ({
        id: r.id,
        listing_id: r.listing_id,
        name: (r.user_id && nameOf[r.user_id]) || r.email,
        email: r.email,
        isYou: r.user_id === uid,
        status: r.status,
        can_calendar: !!r.can_calendar,
        can_messages: !!r.can_messages,
        can_bookings: !!r.can_bookings,
        can_listing: !!r.can_listing,
        can_earnings: !!r.can_earnings,
    }));

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Co-hosts</h1>
            <p className="text-sm text-slate-500 mb-8">
                A co-host helps run a property. The owner chooses exactly what each one can do. A
                co-host given every permission is a full-access co-host — an equal, able to do
                everything bar the owner&apos;s payout details, deleting the listing, and who the
                primary host is.
            </p>

            <PeopleManager listings={listings} people={people} />
        </div>
    );
}
