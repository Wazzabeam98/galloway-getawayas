import { logError } from '@/lib/logError';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { HAS_BOOKINGS_MESSAGE, deleteListingForGood } from '@/lib/listingRemoval';

export const dynamic = 'force-dynamic';

const BUCKET = process.env.NEXT_PUBLIC_S3_BUCKET || 'listings';

// Deleting a listing for good. Only one that has never taken money — see
// lib/listingRemoval for the rule and why. A listing with a paid booking is
// hidden instead, through /api/listings/visibility.
//
// Owner only. A co-host can hide a listing (that can be undone); deleting it
// cannot be, so it is never delegated — the same line lib/access draws.
//
// Order: refuse if there is a paid booking; clear the never-paid rows that
// still reference the listing (abandoned/cancelled checkouts that took no
// money), which the foreign key would otherwise refuse the delete over; delete
// the row (the database refuses too if a paid row has landed since —
// bookings.listing_id is ON DELETE RESTRICT); and only then remove the photos,
// so a refused delete never loses an image.
export async function POST(request: Request) {
    let reporterId: string | null = null;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession() — an unsigned cookie must not be trusted
        // to delete anything.
        const { data: { user } } = await supabase.auth.getUser();
        reporterId = (user && user.id) || null;

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        const listingId: string = body && body.listingId;
        if (!listingId || typeof listingId !== 'string') {
            return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        }

        const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            { auth: { persistSession: false } }
        );

        const { data: listing, error: readError } = await admin
            .from('listings')
            .select('id, host_id, images')
            .eq('id', listingId)
            .maybeSingle();
        if (readError) throw readError;

        if (!listing) {
            return NextResponse.json({ ok: false, error: 'That listing no longer exists.' }, { status: 404 });
        }
        if (listing.host_id !== user.id) {
            return NextResponse.json(
                { ok: false, error: 'Only the owner can delete a listing.' },
                { status: 403 }
            );
        }

        // The sequence — paid check, unpaid rows cleared, delete, then the
        // templates and photos — lives in lib/listingRemoval so the owner's
        // Remove (/api/admin/listings/remove) runs exactly the same one.
        const outcome = await deleteListingForGood(admin, listing, {
            bucket: BUCKET,
            ownerId: user.id,
            log: (what, err) => logError('listings/delete: ' + what, err, {
                path: 'api/listings/delete', userId: user.id,
            }),
        });

        if (outcome === 'must_hide') {
            return NextResponse.json({ ok: false, mustHide: true, error: HAS_BOOKINGS_MESSAGE }, { status: 409 });
        }
        if (outcome === 'gone') {
            return NextResponse.json({ ok: false, error: 'That listing no longer exists.' }, { status: 404 });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[listings/delete]', err && err.message);
        await logError('listings/delete: a listing could not be deleted', err, {
            path: 'api/listings/delete',
            userId: reporterId || undefined,
        });
        return NextResponse.json(
            { ok: false, error: 'Could not delete that listing. Please try again.' },
            { status: 500 }
        );
    }
}
