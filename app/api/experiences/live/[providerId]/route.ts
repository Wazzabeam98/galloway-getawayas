import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadLiveProvider } from '@/lib/experiencesData';
import { viewerCanReply } from '@/lib/experienceReviews';
import { loadStayWindows } from '@/lib/packageNotice';
import { londonDayKey } from '@/lib/dayKey';
import { revalidateExperiencePage } from '@/lib/revalidatePublic';

export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

// The per-viewer and up-to-the-minute half of the public experience page, which
// is edge-cached and the same for everyone (components/marketplace/
// ExperienceViewer.tsx reads this after load):
//
//   * signedIn / canReply / packageStays — who is looking. canReply is the
//     owner or a co-host with messages; packageStays are the viewer's OWN paid
//     stays as dates only (lib/packageNotice), never anyone else's.
//   * availability — the live calendar, shaped by the same loader as the page
//     (lib/experiencesData loadLiveProvider), so seats left are current even when
//     the cached page is a few minutes old. Public data: it is exactly what the
//     page itself shows any visitor. Null when the provider isn't live.
//
// Never cached: per-viewer.
export async function GET(_req: Request, { params }: { params: { providerId: string } }) {
    const providerId = String(params.providerId || '');
    const admin = adminClient();

    const supabase = createRouteHandlerClient({ cookies });
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user || null;

    const p = await loadLiveProvider(admin, providerId, guestExperiencesOpen());
    const availability = p
        ? {
              sessions: p.sessions,
              declaredSessions: p.declaredSessions,
              everScheduled: p.everScheduled,
              slotAvailability: p.slotAvailability,
              slotBlocks: p.slotBlocks,
              partialBlocks: p.partialBlocks,
              bookedDates: p.bookedDates,
          }
        : null;

    if (!user) {
        return NextResponse.json({ ok: true, signedIn: false, canReply: false, packageStays: [], availability }, { headers: PRIVATE });
    }

    // The owner is read directly (not from p) so the reply box also works on a
    // paused provider's page, which isn't live.
    let ownerId: string | null = p ? p.ownerId : null;
    if (!ownerId) {
        const { data: row } = await admin.from('service_providers').select('owner_id').eq('id', providerId).maybeSingle();
        ownerId = (row && row.owner_id) || null;
    }
    const [canReply, packageStays] = await Promise.all([
        viewerCanReply(admin, providerId, ownerId, user.id).catch(() => false),
        loadStayWindows(admin, user.id, londonDayKey()).catch(() => []),
    ]);

    return NextResponse.json({ ok: true, signedIn: true, canReply, packageStays, availability }, { headers: PRIVATE });
}

// Refresh this experience's cached page now — after the provider posts a reply to
// a review (written straight from the browser under the reviews policy, so no
// server write route sees it). Owner / co-host with messages only.
export async function POST(_req: Request, { params }: { params: { providerId: string } }) {
    const providerId = String(params.providerId || '');
    const supabase = createRouteHandlerClient({ cookies });
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return NextResponse.json({ ok: false }, { status: 401, headers: PRIVATE });

    const admin = adminClient();
    const { data: row } = await admin.from('service_providers').select('owner_id').eq('id', providerId).maybeSingle();
    const allowed = await viewerCanReply(admin, providerId, (row && row.owner_id) || null, auth.user.id).catch(() => false);
    if (!allowed) return NextResponse.json({ ok: false }, { status: 403, headers: PRIVATE });

    revalidateExperiencePage(providerId);
    return NextResponse.json({ ok: true }, { headers: PRIVATE });
}
