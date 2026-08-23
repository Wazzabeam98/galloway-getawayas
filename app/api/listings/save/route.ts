import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { isAdmin, recordAdminAction, cleanReason, REMOVED_BUCKET } from '@/lib/adminAudit';
import { fromRow, newProblems } from '@/lib/listingRules';

export const dynamic = 'force-dynamic';

// Fields a co-host with listing permission may change. Anything to do with
// money, ownership or whether the place is on the site at all stays with the
// owner, so those names simply aren't in this list.
// Never changeable through here, whoever is asking. Everything else about a
// listing is fair game for someone the owner trusted with editing it — an
// allow-list would silently drop fields as the listing form grows.
const PROTECTED = [
    'id',
    'host_id',
    'status',
    'commission_rate',
    'ical_token',
    'ical_import_url',
    'created_at',
];

const BUCKET = process.env.NEXT_PUBLIC_S3_BUCKET || 'listings';

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the cookie —
        // it never checks the signature — so the id below would be whatever
        // the caller wrote in it, and this route decides both whether a host
        // may edit their own listing and whether an owner may moderate
        // somebody else's. getUser() asks the auth server, which verifies the
        // token and that it has not been revoked.
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const listingId: string = body && body.listingId;
        const patch = (body && body.patch) || {};

        if (!listingId) {
            return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: before } = await admin
            .from('listings')
            .select('*')
            .eq('id', listingId)
            .maybeSingle();

        if (!before) {
            return NextResponse.json({ ok: false, error: 'No such listing' }, { status: 404 });
        }

        // The ordinary path: the owner of the listing, or a co-host they
        // trusted with editing it.
        const access = await checkListing(user.id, listingId, 'can_listing');

        // The moderation path, opted into here rather than inside
        // checkListing() — that helper is used by the earnings, payouts,
        // calendar, messages and bookings routes, and teaching it about admins
        // would hand an owner all of those at once with nothing written down.
        const owner = !access && (await isAdmin(user.id));
        const moderating = owner && before.host_id !== user.id;

        if (!access && !owner) {
            return NextResponse.json(
                { ok: false, error: 'You don’t have permission to edit this listing.' },
                { status: 403 }
            );
        }

        // Editing somebody else's property is not something to do by accident,
        // and the reason is the whole value of the log.
        const reason = cleanReason(body && body.reason);
        if (moderating && !reason) {
            return NextResponse.json(
                { ok: false, error: 'Give a reason — this listing is not yours, and the reason is recorded.' },
                { status: 400 }
            );
        }

        // Strip anything that isn't theirs to change.
        const safe: Record<string, any> = {};
        Object.keys(patch).forEach(function (key) {
            if (PROTECTED.indexOf(key) === -1) safe[key] = patch[key];
        });

        if (Object.keys(safe).length === 0) {
            return NextResponse.json({ ok: false, error: 'Nothing to save.' }, { status: 400 });
        }

        // The last word on whether a listing still meets the standard, said on
        // the server where a browser cannot argue with it. The edit screen asks
        // the same question of the same rules before it gets here; this is what
        // makes the answer binding.
        //
        // A draft is exempt — Save & finish later is the whole point of one.
        // And only rules this patch would newly break count: a listing that has
        // been on the site since before a rule must stay editable, or its host
        // cannot fix a price without first satisfying something that was never
        // asked of them. What it cannot do is get worse.
        if (before.status !== 'draft') {
            const introduced = newProblems(fromRow(before), fromRow({ ...before, ...safe }));

            if (introduced.length > 0) {
                return NextResponse.json(
                    { ok: false, error: introduced[0].message },
                    { status: 400 }
                );
            }
        }

        const { error } = await admin.from('listings').update(safe).eq('id', listingId);

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        if (!moderating) {
            return NextResponse.json({ ok: true });
        }

        // Everything below is the audit trail, and it is worked out here by
        // comparing the row we read to the row that was asked for. The browser
        // does not get to describe what it just did.
        const changed: string[] = [];
        Object.keys(safe).forEach((key) => {
            const wasValue = JSON.stringify((before as any)[key] ?? null);
            const nowValue = JSON.stringify(safe[key] ?? null);
            if (wasValue !== nowValue) changed.push(key);
        });

        const wasImages: string[] = Array.isArray(before.images) ? before.images : [];
        const nowImages: string[] = Array.isArray(safe.images) ? safe.images : wasImages;
        const droppedImages = wasImages.filter((p) => nowImages.indexOf(p) === -1);

        // Moved, not deleted. A host disputing what was taken down can still
        // be shown the file; the bucket it lands in is private, so it is off
        // the public internet either way. Deleting for good stays a separate,
        // deliberate step.
        const moved: string[] = [];
        const failedToMove: string[] = [];

        // Done by hand rather than with storage.move(), which cannot cross
        // buckets in the version of supabase-js this project is on.
        //
        // Copy first, delete second, and only ever in that order. The other way
        // round, a failed upload would mean the photo is gone from both places
        // and the host has nothing to dispute.
        for (const path of droppedImages) {
            try {
                const { data: file, error: downloadError } = await admin.storage
                    .from(BUCKET)
                    .download(path);

                if (downloadError || !file) throw downloadError || new Error('nothing to download');

                const { error: uploadError } = await admin.storage
                    .from(REMOVED_BUCKET)
                    .upload(path, file, { upsert: true, contentType: file.type || undefined });

                if (uploadError) throw uploadError;

                const { error: removeError } = await admin.storage.from(BUCKET).remove([path]);
                if (removeError) throw removeError;

                moved.push(path);
            } catch (err: any) {
                // The row is already saved and the photo is already off the
                // listing. Say so rather than pretending it all worked — a
                // photo still sitting in the public bucket is the one thing
                // the owner most needs to know about.
                failedToMove.push(path);
                console.error('[listings/save] could not move', path, err?.message);
            }
        }

        await recordAdminAction({
            adminId: user.id,
            action: droppedImages.length && changed.length === 1 && changed[0] === 'images'
                ? 'listing_photo_removed'
                : 'listing_edited',
            listingId: listingId,
            hostId: before.host_id,
            reason: reason as string,
            detail: {
                title: before.title,
                changed: changed,
                photosRemoved: droppedImages,
                photosMovedToPrivate: moved,
                photosStillPublic: failedToMove,
            },
        });

        return NextResponse.json({
            ok: true,
            moderated: true,
            photosMoved: moved.length,
            photosStillPublic: failedToMove,
        });
    } catch (err: any) {
        console.error('[listings/save]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not save' },
            { status: 500 }
        );
    }
}
