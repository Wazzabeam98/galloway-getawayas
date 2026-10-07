import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isAdmin, recordAdminAction, cleanReason, setListingHiddenAsAdmin } from '@/lib/adminAudit';
import { deleteListingForGood, listingsWithPaidRecords } from '@/lib/listingRemoval';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

const BUCKET = process.env.NEXT_PUBLIC_S3_BUCKET || 'listings';

// An owner removing somebody's listing from /admin/listings.
//
// ONE BUTTON, TWO OUTCOMES, AND THE SERVER CHOOSES. The rule is the host
// Delete's (lib/listingRemoval): a listing that has never taken money is
// deleted for good, photos and all; one with a paid booking or paid experience
// order is taken down with the ordinary admin hide instead, so no booking or
// payment record is lost. The screen shows which one will happen before the
// confirm, but it is this route that decides — a booking paid between the
// screen loading and the click turns a delete into a hide, never the other way.
//
// Body: { listingId, reason, expect: 'delete' | 'hide' }. `expect` is what the
// owner was shown and confirmed. If the answer has changed since, nothing
// happens and the screen is told, rather than doing something they did not
// agree to.
export async function POST(request: Request) {
    let adminId: string | undefined;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession() — an unsigned cookie must not be
        // trusted to delete anything.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }
        adminId = user.id;
        if (!(await isAdmin(user.id))) {
            return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });
        }

        const body = await request.json().catch(() => null);
        const listingId: string = body && body.listingId;
        const reason = cleanReason(body && body.reason);
        const expect = body && body.expect;

        if (!listingId || typeof listingId !== 'string') {
            return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        }
        if (!reason) {
            return NextResponse.json(
                { ok: false, error: 'Give a reason — it goes in the log against your name.' },
                { status: 400 }
            );
        }
        if (expect !== 'delete' && expect !== 'hide') {
            return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 });
        }

        const admin = adminClient();
        const { data: listing, error: readError } = await admin
            .from('listings')
            .select('id, host_id, title, status, images')
            .eq('id', listingId)
            .maybeSingle();
        if (readError) throw readError;
        if (!listing) {
            return NextResponse.json({ ok: false, error: 'That listing no longer exists.' }, { status: 404 });
        }

        const paid = await listingsWithPaidRecords(admin, [listingId]);
        const action = paid.has(listingId) ? 'hide' : 'delete';

        if (action !== expect) {
            return NextResponse.json({
                ok: false,
                changed: true,
                error: action === 'hide'
                    ? 'A booking has been paid on this listing since the page loaded, so it can only be taken down now. Nothing was changed.'
                    : 'This listing no longer has a paid booking, so it would be deleted. Nothing was changed — reload and try again.',
            }, { status: 409 });
        }

        if (action === 'hide') return hide(user.id, listing, reason);

        const outcome = await deleteListingForGood(admin, listing, {
            bucket: BUCKET,
            log: (what, err) => logError('admin/listings/remove: ' + what, err, {
                path: 'api/admin/listings/remove', userId: user.id,
            }),
        });

        // A paid booking landed between the check and the delete (the foreign
        // key refused). The listing is still there; nothing was deleted.
        if (outcome === 'must_hide') {
            return NextResponse.json({
                ok: false,
                changed: true,
                error: 'A booking was paid on this listing a moment ago, so it was not deleted. Reload — it can be taken down instead.',
            }, { status: 409 });
        }
        if (outcome === 'gone') {
            return NextResponse.json({ ok: false, error: 'That listing no longer exists.' }, { status: 404 });
        }

        // listing_id is null: the row it would point at is gone. The id and
        // title go in detail, so the trail still says what was removed.
        await recordAdminAction({
            adminId: user.id,
            action: 'listing_deleted',
            listingId: null,
            hostId: listing.host_id,
            reason,
            detail: {
                listing_id: listing.id,
                title: listing.title,
                status: listing.status,
                photos: Array.isArray(listing.images) ? listing.images.length : 0,
            },
        });

        return NextResponse.json({ ok: true, outcome: 'deleted' });
    } catch (err: any) {
        console.error('[admin/listings/remove]', err && err.message);
        await logError('admin/listings/remove: a listing could not be removed', err, {
            path: 'api/admin/listings/remove',
            userId: adminId,
        });
        return NextResponse.json({ ok: false, error: 'Could not remove that listing. Please try again.' }, { status: 500 });
    }
}

async function hide(adminId: string, listing: any, reason: string) {
    if (listing.status === 'hidden') {
        return NextResponse.json({ ok: true, outcome: 'hidden', unchanged: true });
    }
    const result = await setListingHiddenAsAdmin(adminId, listing, true, reason, { via: 'remove' });
    if ('error' in result) {
        return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, outcome: 'hidden' });
}
