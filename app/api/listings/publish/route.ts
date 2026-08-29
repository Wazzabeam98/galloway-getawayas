import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Publishing a listing, which is the one thing a host may no longer do by
// writing the row.
//
// A listing's status used to be set straight from the browser — app/addhome
// wrote status='published' over the REST API. That made the review queue in
// 20260828143000 defeatable before it shipped: anyone could PATCH their own
// listing to published, or insert one already live, skipping any approval.
// 20260829020000 closes that at the database — a browser role may create a
// draft and may never change status — and this route is where publishing goes
// instead.
//
// getUser(), not getSession(): the identity must be verified against the auth
// server, not read from a cookie the caller could write. This route is the
// authority on who owns the listing, so it cannot trust a forgeable id.
//
// WHERE THE REVIEW GATE WILL LIVE. When listings start waiting for approval,
// this is the single place that changes: 'published' becomes 'pending_review',
// and app/api/admin/listings/decide moves it the rest of the way. Nothing else
// needs to know.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const listingId: string = body && body.listingId;

        if (!listingId) {
            return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: listing } = await admin
            .from('listings')
            .select('id, host_id, title, price_per_night, status')
            .eq('id', listingId)
            .maybeSingle();

        if (!listing) {
            return NextResponse.json({ ok: false, error: 'No such listing' }, { status: 404 });
        }

        // Only the owner publishes their own listing. Checked against the
        // verified user id, so a forged cookie cannot publish someone else's.
        if (listing.host_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
        }

        // The same completeness the database constraint enforces
        // (listings_published_are_complete), checked here so the host gets a
        // sentence rather than a raw 23514.
        const title = (listing.title || '').trim();
        const price = Number(listing.price_per_night || 0);
        if (!title || price <= 0) {
            return NextResponse.json(
                { ok: false, error: 'A listing needs a name and a price before it can go live.' },
                { status: 400 }
            );
        }

        const { error } = await admin
            .from('listings')
            .update({ status: 'published' })
            .eq('id', listingId);

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, status: 'published' });
    } catch (err: any) {
        console.error('[listings/publish]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not publish that' },
            { status: 500 }
        );
    }
}
