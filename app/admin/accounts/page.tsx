import Link from 'next/link';
import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { adminName } from '@/lib/utils';
import { londonDayKey, ukDate } from '@/lib/dayKey';
import AdminReactivateAccount from '@/components/admin/AdminReactivateAccount';

export const dynamic = 'force-dynamic';

// Accounts their owners deactivated (app/api/account/deactivate). There was no
// screen for them: bringing one back meant knowing a hidden route. Each row has
// a Reactivate button (components/admin/AdminReactivateAccount), which asks for
// a reason and logs it.
//
// Shown per person: what the deactivation took down, so the confirm can say
// what will and won't come back. Read with the service role — profiles'
// deactivated_at is private to the browser roles.
export default async function AdminAccounts() {
    await requireAdmin();
    const admin = adminClient();

    const { data: rows, error } = await admin
        .from('profiles')
        .select('id, full_name, preferred_name, deactivated_at')
        .not('deactivated_at', 'is', null)
        .is('anonymised_at', null)
        .order('deactivated_at', { ascending: false })
        .limit(200);

    const people = rows || [];
    const ids = people.map((p: any) => p.id);

    // What each person's deactivation took down (still stamped), and any of our
    // own take-downs on their experiences/trades, which reactivation leaves.
    const [{ data: listings }, { data: providers }] = ids.length
        ? await Promise.all([
            admin.from('listings').select('host_id, title').in('host_id', ids).not('deactivated_at', 'is', null),
            admin.from('service_providers').select('owner_id, business_name, audience, plan, admin_hidden_at, deactivated_at').in('owner_id', ids),
        ])
        : [{ data: [] as any[] }, { data: [] as any[] }];

    // Emails come from auth, one admin call for the page.
    const emailById = new Map<string, string>();
    try {
        const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        for (const u of (page && page.users) || []) if (u.email) emailById.set(u.id, u.email);
    } catch {
        // An address we couldn't read shows as blank, not as a broken page.
    }

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 underline">
                &larr; Owner tools
            </Link>
            <h1 className="text-2xl font-bold text-slate-900 mt-4">Deactivated accounts</h1>
            <p className="text-sm text-slate-600 mt-1 mb-8">
                People who switched their account off. Reactivating lets them sign in again; their listings stay
                off the site until they put each one back up themselves.
            </p>

            {error ? (
                <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5 text-sm text-red-900">
                    The accounts could not be read: {error.message}
                </div>
            ) : people.length === 0 ? (
                <p className="text-sm text-slate-500">No deactivated accounts.</p>
            ) : (
                <div className="space-y-4">
                    {people.map((p: any) => {
                        const theirListings = (listings || []).filter((l: any) => l.host_id === p.id).map((l: any) => String(l.title || 'Untitled listing'));
                        const theirProviders = (providers || []).filter((x: any) => x.owner_id === p.id && x.deactivated_at).map((x: any) => String(x.business_name || 'Untitled'));
                        const takenDownByUs = (providers || []).filter((x: any) => x.owner_id === p.id && x.admin_hidden_at).map((x: any) => String(x.business_name || 'Untitled'));
                        // A person with no name on file is shown by their email, not "Unnamed".
                        const name = adminName(p, '') || emailById.get(p.id) || 'Unnamed account';
                        const onPlan = (providers || []).some((x: any) => x.owner_id === p.id && x.deactivated_at && x.plan === 'subscription');
                        return (
                            <div key={p.id} className="border rounded-2xl p-4">
                                <div className="font-semibold text-slate-900">{name}</div>
                                <div className="text-sm text-slate-500">{emailById.get(p.id) || ''}</div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                    Deactivated {ukDate(londonDayKey(new Date(p.deactivated_at)))}
                                    {theirListings.length + theirProviders.length > 0
                                        ? ' · took down ' + [...theirListings, ...theirProviders].join(', ')
                                        : ''}
                                </div>
                                <AdminReactivateAccount
                                    userId={p.id}
                                    name={name}
                                    listings={theirListings}
                                    providers={theirProviders}
                                    takenDownByUs={takenDownByUs}
                                    onSubscriptionPlan={onPlan}
                                />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
