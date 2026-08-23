import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isAdmin, recordAdminAction, cleanReason } from '@/lib/adminAudit';

export const dynamic = 'force-dynamic';

// An owner taking somebody else's listing off the site, or putting it back.
//
// Separate from /api/listings/visibility, which is the host's own control and
// asks for no reason. This one is moderation: it always writes to
// admin_actions, and it refuses without a reason.
//
// Nothing here touches bookings. Hiding changes one column on listings, so a
// guest who has paid still has their stay and the host still has to honour it.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the cookie
        // — it never checks the signature — so the id this route trusts would
        // be whatever the caller wrote in it. getUser() asks the auth server,
        // which verifies the token and that the session has not been revoked.
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        // Checked here on the server every time. The screen hiding itself is
        // presentation; this is what actually decides.
        if (!(await isAdmin(user.id))) {
            return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });
        }

        const body = await request.json();
        const listingId: string = body && body.listingId;
        const hidden: boolean = !!(body && body.hidden);
        const reason = cleanReason(body && body.reason);

        if (!listingId) {
            return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        }
        if (!reason) {
            return NextResponse.json(
                { ok: false, error: 'Give a reason — it goes in the log against your name.' },
                { status: 400 }
            );
        }

        const admin = adminClient();

        const { data: listing } = await admin
            .from('listings')
            .select('id, host_id, title, status')
            .eq('id', listingId)
            .maybeSingle();

        if (!listing) {
            return NextResponse.json({ ok: false, error: 'No such listing' }, { status: 404 });
        }

        // A draft is half-written, not published. Hiding one would strand it
        // somewhere its host cannot finish it from. Same rule the host route
        // applies to itself.
        if (listing.status === 'draft') {
            return NextResponse.json(
                { ok: false, error: 'That listing is still a draft, so it is not on the site.' },
                { status: 400 }
            );
        }

        const next = hidden ? 'hidden' : 'published';

        if (listing.status === next) {
            return NextResponse.json({ ok: true, status: next, unchanged: true });
        }

        const { error } = await admin
            .from('listings')
            .update({ status: next })
            .eq('id', listingId);

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        await recordAdminAction({
            adminId: user.id,
            action: hidden ? 'listing_hidden' : 'listing_relisted',
            listingId: listingId,
            hostId: listing.host_id,
            reason: reason,
            detail: { title: listing.title, from: listing.status, to: next },
        });

        return NextResponse.json({ ok: true, status: next });
    } catch (err: any) {
        console.error('[admin/listings/visibility]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not change that' },
            { status: 500 }
        );
    }
}
