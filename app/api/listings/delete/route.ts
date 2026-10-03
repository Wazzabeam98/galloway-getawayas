import { logError } from '@/lib/logError';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { HAS_BOOKINGS_MESSAGE, listingsWithRecords, photosToRemove } from '@/lib/listingRemoval';

export const dynamic = 'force-dynamic';

const BUCKET = process.env.NEXT_PUBLIC_S3_BUCKET || 'listings';

// Deleting a listing for good. Only one that has never had a booking — see
// lib/listingRemoval for the rule and why. Anything booked is hidden instead,
// through /api/listings/visibility.
//
// Owner only. A co-host can hide a listing (that can be undone); deleting it
// cannot be, so it is never delegated — the same line lib/access draws.
//
// Order: refuse if there is any booking, delete the row (the database refuses
// too if one has landed since — bookings.listing_id is ON DELETE RESTRICT),
// and only then remove the photos, so a refused delete never loses an image.
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

        const booked = await listingsWithRecords(admin, [listingId]);
        if (booked.has(listingId)) {
            return NextResponse.json({ ok: false, mustHide: true, error: HAS_BOOKINGS_MESSAGE }, { status: 409 });
        }

        const { data: gone, error: deleteError } = await admin
            .from('listings')
            .delete()
            .eq('id', listingId)
            .eq('host_id', user.id)
            .select('id');

        if (deleteError) {
            // 23503: a booking (or order) arrived between the check and the
            // delete, and the foreign key refused. Same answer as above.
            if (deleteError.code === '23503') {
                return NextResponse.json({ ok: false, mustHide: true, error: HAS_BOOKINGS_MESSAGE }, { status: 409 });
            }
            throw deleteError;
        }
        if (!gone || !gone.length) {
            return NextResponse.json({ ok: false, error: 'That listing no longer exists.' }, { status: 404 });
        }

        // The listing is gone. What follows is tidying: a failure is logged,
        // never reported as a failed delete.

        // Message templates name their listings in an array, not a foreign key,
        // so nothing cascades there — take this id out of the host's own.
        const { data: templates, error: tplError } = await admin
            .from('message_templates')
            .select('id, listing_ids')
            .contains('listing_ids', [listingId]);
        if (tplError) {
            await logError('listings/delete: templates could not be read to drop the deleted listing', tplError, {
                path: 'api/listings/delete', userId: user.id,
            });
        }
        for (const t of templates || []) {
            const next = (t.listing_ids || []).filter((x: string) => x !== listingId);
            const { error } = await admin.from('message_templates').update({ listing_ids: next }).eq('id', t.id);
            if (error) {
                await logError('listings/delete: a template still names the deleted listing', error, {
                    path: 'api/listings/delete', userId: user.id,
                });
            }
        }

        // The photos. The bucket has no DELETE policy for hosts, so this is the
        // service role, and only for paths no other listing still uses.
        const own: string[] = Array.isArray(listing.images)
            ? listing.images.filter((p: unknown) => typeof p === 'string' && p)
            : [];
        if (own.length) {
            const { data: sharing } = await admin
                .from('listings')
                .select('images')
                .overlaps('images', own);
            const elsewhere: string[] = [];
            (sharing || []).forEach((l: any) => (l.images || []).forEach((p: string) => elsewhere.push(p)));

            const paths = photosToRemove(own, elsewhere);
            if (paths.length) {
                const { error: rmError } = await admin.storage.from(BUCKET).remove(paths);
                if (rmError) {
                    await logError('listings/delete: the deleted listing’s photos could not be removed', rmError, {
                        path: 'api/listings/delete', userId: user.id,
                    });
                }
            }
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
