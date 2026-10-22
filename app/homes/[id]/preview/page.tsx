import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';
import { isAdmin } from '@/lib/adminAudit';
import HomeView, { PUBLICLY_VISIBLE, type ListingPreview } from '../HomeView';

// Per request, never cached: this page shows a listing that is NOT public yet
// (a draft, or one waiting for approval), and only to the people allowed to see
// it — the owner, a co-host given listing access, or an admin reviewing it. Kept
// apart from the edge-cached public page (../page.tsx), which only ever
// redirects here for such a listing and never renders it.
export const dynamic = 'force-dynamic';

// Reveals nothing in the <head>: a preview is not for sharing or indexing.
export const metadata = {
    title: 'Preview',
    robots: { index: false, follow: false },
};

// Anyone else is sent to the home page, without a word about the listing. A
// listing that has gone public since goes to its real page instead — never the
// other way, because the public page sends a non-public listing back here.
export default async function ListingPreviewPage({ params }: { params: { id: string } }) {
    const { data: row } = await adminClient()
        .from('listings')
        .select('host_id, status, deactivated_at')
        .eq('id', params.id)
        .maybeSingle();

    if (row && !row.deactivated_at && PUBLICLY_VISIBLE.indexOf(row.status) !== -1) {
        redirect(`/homes/${params.id}`);
    }

    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !row || row.deactivated_at) redirect('/');

    let viewer: ListingPreview['viewer'] | null = null;
    if (row.host_id === user.id) {
        viewer = 'owner';
    } else if (await checkListing(user.id, params.id, 'can_listing')) {
        // A co-host (or staff) with listing access — the same grant that opens
        // the editor for them.
        viewer = 'cohost';
    } else if (await isAdmin(user.id)) {
        // Server-side check on the viewer's own is_admin: the review queue's
        // title opens what guests will get.
        viewer = 'admin';
    }
    if (!viewer) redirect('/');

    return <HomeView id={params.id} preview={{ viewer }} />;
}
