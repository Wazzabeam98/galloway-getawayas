import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isAdmin, recordAdminAction } from '@/lib/adminAudit';
import { revalidateListing } from '@/lib/revalidatePublic';

export const dynamic = 'force-dynamic';

// An owner tagging a listing Luxury, or taking the tag off (/admin/listings).
//
// Airbnb Luxe's shape: a mark we give, never one a host claims. So it is only
// here — is_admin checked on the server against the signed-in user, the write
// made with the service role. listings.is_luxury has no browser write grant,
// and the listings_luxury_authority trigger refuses a browser insert or change
// (20261021172642), so there is nowhere else it CAN be set. Logged in the
// moderation trail like every other owner action on someone else's listing.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(): the id must be verified by the auth server.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!(await isAdmin(user.id))) return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });

        const body = await request.json().catch(() => ({}));
        const listingId = String((body && body.listingId) || '');
        const luxury = !!(body && body.luxury);
        if (!listingId) return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });

        const admin = adminClient();
        const { data: listing } = await admin.from('listings').select('id, host_id, title, is_luxury').eq('id', listingId).maybeSingle();
        if (!listing) return NextResponse.json({ ok: false, error: 'No such listing' }, { status: 404 });
        if (listing.is_luxury === luxury) return NextResponse.json({ ok: true, luxury, unchanged: true });

        const { error } = await admin.from('listings').update({ is_luxury: luxury }).eq('id', listingId);
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

        await recordAdminAction({
            adminId: user.id,
            action: 'listing_edited',
            listingId,
            hostId: listing.host_id,
            reason: luxury ? 'Tagged Luxury' : 'Luxury tag removed',
            detail: { is_luxury: luxury, title: listing.title },
        });
        // The badge and the filter are on the public grids and the page.
        revalidateListing(listingId);
        return NextResponse.json({ ok: true, luxury });
    } catch (err: any) {
        console.error('[admin/listings/luxury]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not change that' }, { status: 500 });
    }
}
