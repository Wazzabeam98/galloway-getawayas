import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { loadOwnerPreviewProvider } from '@/lib/experiencesData';
import { isAdmin } from '@/lib/adminAudit';
import { loadExperienceReviews, viewerCanReply } from '@/lib/experienceReviews';
import { providerResponsiveness } from '@/lib/hostResponsiveness';
import { loadStayWindows } from '@/lib/packageNotice';
import { londonDayKey } from '@/lib/dayKey';
import OwnerPreviewBanner from '@/components/services/OwnerPreviewBanner';
import { ExperiencePageView } from '@/components/marketplace/ExperiencePageView';
import type { MpProvider } from '@/lib/experiencesData';

// Per request, never cached: this page shows a provider that is NOT approved yet,
// and only to the two people allowed to see it. Kept apart from the edge-cached
// public page (../page.tsx), which only ever redirects here for such a provider
// and never renders it.
export const dynamic = 'force-dynamic';

// Reveals nothing in the <head>: a preview is not for sharing or indexing.
export const metadata = {
    title: 'Preview',
    robots: { index: false, follow: false },
};

// THE OWNER'S PREVIEW, before approval: the provider looking at their own page
// sees exactly what guests will, with a quiet bar saying no one else can yet —
// the same as a host previewing a pending cottage. AN ADMIN REVIEWING IT gets the
// same real guest page (loaded as its owner would see it), so the review queue's
// title opens what guests will get. Anyone else is sent on: to the public page if
// the provider is approved by now, otherwise to browse.
export default async function ExperiencePreviewPage({ params }: { params: { providerId: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    const admin = adminClient();
    const { data: row } = await admin
        .from('service_providers')
        .select('owner_id, status')
        .eq('id', params.providerId)
        .maybeSingle();

    // Approved since (or always): its real page is the public one.
    if (row && row.status === 'approved') redirect(`/experiences/browse/${params.providerId}`);
    if (!user || !row) redirect('/experiences/browse');

    let p: MpProvider | null = null;
    let asAdmin = false;
    if (row.owner_id === user.id) {
        p = await loadOwnerPreviewProvider(admin, params.providerId, user.id);
    } else if (await isAdmin(user.id)) {
        // Server-side check on the viewer's own is_admin.
        p = row.owner_id ? await loadOwnerPreviewProvider(admin, params.providerId, row.owner_id) : null;
        asAdmin = !!p;
    }
    if (!p) redirect('/experiences/browse');

    const status = String(row.status || 'draft');
    const banner = asAdmin
        ? <OwnerPreviewBanner status={status} who="guests" viewer="admin" backHref="/admin/providers#experiences" backLabel="Back to the review queue" />
        : <OwnerPreviewBanner status={status} who="guests" backHref="/services/dashboard/listing" backLabel="Back to your listing" />;

    const [reviews, responsiveness, canReply, packageStays] = await Promise.all([
        loadExperienceReviews(admin, p.id, user.id),
        providerResponsiveness(admin, p.id, p.ownerId),
        viewerCanReply(admin, p.id, p.ownerId, user.id),
        loadStayWindows(admin, user.id, londonDayKey()),
    ]);

    return (
        <ExperiencePageView
            p={p}
            reviews={reviews}
            responsiveness={responsiveness}
            banner={banner}
            preview
            // Worked out here already, so the page fetches nothing after load.
            // No live calendar: this render is itself current.
            viewer={{ signedIn: true, canReply, packageStays, availability: null }}
        />
    );
}
