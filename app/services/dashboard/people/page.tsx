import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminClient } from '@/lib/supabaseAdmin';
import { accessibleProviders, isFullProviderAccess } from '@/lib/providerAccess';
import { displayName } from '@/lib/utils';
import PeopleManager, { ManagedListing, Person } from '@/components/PeopleManager';

export const dynamic = 'force-dynamic';

export const metadata = {
    title: 'Co-hosts',
    robots: { index: false, follow: false },
};

// Co-hosts for a business — an experience or a trade — the same page a host
// gets at /dashboard/people, on provider_access instead of listing_access. Who
// may open it and hand out access: the owner, or a full-access co-host. Only the
// owner may create another full-access co-host (the route enforces it).
export default async function BusinessPeoplePage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getUser();
    if (!auth || !auth.user) redirect('/');
    const uid = auth.user.id;

    const manageable = (await accessibleProviders(uid)).filter((a) => isFullProviderAccess(a));
    const ids = manageable.map((a) => a.providerId);
    if (ids.length === 0) redirect('/services/dashboard');

    const admin = adminClient();
    const { data: rows } = await admin
        .from('service_providers')
        .select('id, business_name, owner_id')
        .in('id', ids)
        .order('business_name');

    const { data: accessRows } = await admin
        .from('provider_access')
        .select('id, provider_id, user_id, email, status, can_calendar, can_messages, can_bookings, can_listing, can_earnings')
        .in('provider_id', ids)
        .neq('status', 'revoked')
        .order('invited_at', { ascending: false });

    const profileIds = Array.from(new Set([
        ...(rows || []).map((r: any) => r.owner_id),
        ...(accessRows || []).map((r: any) => r.user_id).filter(Boolean),
    ]));
    const { data: profiles } = profileIds.length
        ? await admin.from('profiles').select('id, full_name, first_name, last_name, preferred_name, show_full_name').in('id', profileIds)
        : { data: [] as any[] };
    const nameOf: Record<string, string> = {};
    (profiles || []).forEach((p: any) => { nameOf[p.id] = displayName(p, ''); });

    const listings: ManagedListing[] = (rows || []).map((r: any) => ({
        id: r.id,
        kind: 'provider',
        title: r.business_name || 'Your business',
        viewerIsOwner: r.owner_id === uid,
        primaryHost: {
            name: nameOf[r.owner_id] || (r.owner_id === uid ? 'You' : 'The owner'),
            isYou: r.owner_id === uid,
        },
    }));

    // PeopleManager keys a person on `listing_id`; for a business that is the
    // provider id.
    const people: Person[] = (accessRows || []).map((r: any) => ({
        id: r.id,
        listing_id: r.provider_id,
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
                A co-host helps run your business. You choose exactly what each one can do. A
                co-host given every permission is a full-access co-host — an equal, able to do
                everything bar your payout details, your subscription and billing, closing the
                account, and who the primary host is.
            </p>

            <PeopleManager listings={listings} people={people} />
        </div>
    );
}
