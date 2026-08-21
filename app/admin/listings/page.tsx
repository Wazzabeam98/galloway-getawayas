import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getImageUrl, displayName } from '@/lib/utils';
import { publicArea } from '@/lib/places';
import AdminListingRow from '@/components/admin/AdminListingRow';

export const dynamic = 'force-dynamic';

// Every listing on the site, whoever owns it, with the one control that
// matters in a hurry: take it down.
//
// The editor is where a considered change is made. This page exists because
// "off the public site within a minute" and "open a nine-section form" are not
// the same job.
export default async function AdminListings() {
    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getSession();

    if (!auth || !auth.session || !auth.session.user) notFound();

    const { data: me } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', auth.session.user.id)
        .maybeSingle();

    if (!me || me.is_admin !== true) notFound();

    const myId = auth.session.user.id;
    const admin = adminClient();

    // Service role: bookings and profiles are behind row-level security, and
    // the counts below would come back empty read as the signed-in user.
    const { data: listings } = await admin
        .from('listings')
        .select('id, title, location, images, status, host_id, created_at')
        .order('created_at', { ascending: false });

    const rows = listings || [];
    const hostIds = Array.from(new Set(rows.map((l) => l.host_id)));

    const { data: hosts } = hostIds.length
        ? await admin.from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', hostIds)
        : { data: [] };

    const hostName: Record<string, string> = {};
    (hosts || []).forEach((h: any) => {
        // The owner's own view, so the real name rather than what guests see.
        hostName[h.id] = h.full_name || h.preferred_name || 'Host';
    });

    // Live bookings per listing, so nobody hides a property without knowing
    // there are guests already holding a stay on it.
    const { data: live } = await admin
        .from('bookings')
        .select('listing_id')
        .eq('status', 'confirmed')
        .gte('check_out', new Date().toISOString().split('T')[0]);

    const liveCount: Record<string, number> = {};
    (live || []).forEach((b: any) => {
        liveCount[b.listing_id] = (liveCount[b.listing_id] || 0) + 1;
    });

    const { data: recent } = await admin
        .from('admin_actions')
        .select('id, action, listing_id, reason, created_at, admin_id')
        .order('created_at', { ascending: false })
        .limit(20);

    const published = rows.filter((l) => l.status === 'published');
    const hidden = rows.filter((l) => l.status === 'hidden');
    const drafts = rows.filter((l) => l.status === 'draft');

    return (
        <div className="max-w-4xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">All listings</h1>
            <p className="text-sm text-slate-500 mb-2">
                Every property on the site. Hiding one takes it off search and stops new
                bookings straight away.
            </p>
            <p className="text-sm text-slate-500 mb-8">
                Bookings already made are never touched — a guest who has paid still has
                their stay, and the host still has to honour it.
            </p>

            <div className="flex gap-4 text-sm mb-8">
                <span className="text-slate-800 font-semibold">{published.length} live</span>
                <span className="text-slate-500">{hidden.length} hidden</span>
                <span className="text-slate-500">{drafts.length} draft</span>
            </div>

            <div className="space-y-3">
                {rows.map((l) => (
                    <AdminListingRow
                        key={l.id}
                        id={l.id}
                        title={l.title || 'Untitled listing'}
                        area={publicArea(l.location)}
                        image={l.images && l.images.length ? getImageUrl(l.images[0]) : null}
                        status={l.status}
                        hostName={hostName[l.host_id] || 'Host'}
                        isMine={l.host_id === myId}
                        liveBookings={liveCount[l.id] || 0}
                    />
                ))}
                {!rows.length && (
                    <p className="text-sm text-slate-500">No listings yet.</p>
                )}
            </div>

            <h2 className="text-lg font-bold text-slate-900 mt-12 mb-1">Recent owner actions</h2>
            <p className="text-xs text-slate-500 mb-4">
                Only actions on listings that were not yours. Your own listings go through
                the ordinary host controls.
            </p>

            {(recent || []).length ? (
                <div className="border rounded-2xl divide-y">
                    {(recent || []).map((a: any) => {
                        const listing = rows.find((l) => l.id === a.listing_id);
                        return (
                            <div key={a.id} className="p-4 text-sm">
                                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                    <span className="font-semibold text-slate-900">
                                        {a.action.replace('listing_', '').replace('_', ' ')}
                                        {' — '}
                                        {listing ? listing.title || 'Untitled listing' : 'a since-deleted listing'}
                                    </span>
                                    <span className="text-xs text-slate-400">
                                        {new Date(a.created_at).toLocaleString('en-GB')}
                                    </span>
                                </div>
                                <p className="text-slate-600 mt-1">{a.reason}</p>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="text-sm text-slate-500">Nothing yet.</p>
            )}
        </div>
    );
}
