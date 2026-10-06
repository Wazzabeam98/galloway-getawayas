import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { deletionBlockers } from '@/lib/deactivateAccount';

// Closing an account ANONYMISES it — it never deletes the profile or auth row,
// because bookings/payments/payouts/orders are RESTRICT-linked to them and must
// survive as financial/audit records (see
// 20260924181742_anonymise_own_account.sql). This route does the two things the
// database function can't: it removes the person's images from the public
// storage bucket, and it authenticates the caller before scrubbing.
//
// THE BLOCK. A permanent erasure must refuse for everything a reversible
// deactivation refuses — a listing with other people's live reservations, an
// experience with live orders, a trade with open enquiries, a stay in progress —
// PLUS the person's own upcoming trips. Deactivation cancels-and-refunds those
// trips; deletion is permanent and does not, so a paid future stay must be
// cancelled first rather than left standing behind an erased guest. That whole
// set is account_deletion_blockers (deletionBlockers). We run it here to answer a
// 409 with the per-entity list the account page renders, and the RPC re-runs the
// identical set as its hard guard.
//
// Order: gather the storage paths, scrub the account (which guards against the
// blocker set and raises if anything is live — so a blocked erasure touches
// nothing, and which also unpublishes any listings this user hosts), then remove
// the images with the paths gathered before the columns were nulled. Because the
// scrub unpublishes the listings before this route deletes their photos, no
// listing is ever left public with its images gone.
//
// Avatars and provider images are written with a timestamp in the key
// (avatars/<uid>-<ts>.jpg, providers/...-<uid>-<ts>...), so a column only ever
// names the CURRENT one and older versions pile up. We therefore also sweep the
// avatars/ and providers/ folders for anything carrying this user's id, not just
// the keys still referenced. Listing photos live at the bucket root with no id
// in the key, so those can only come from listings.images (gathered below), and
// admin-removed copies may sit in the private `listings-removed` bucket too.

const BUCKET = process.env.NEXT_PUBLIC_S3_BUCKET || 'listings';
const REMOVED_BUCKET = 'listings-removed';

export async function POST() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
        }
        const uid = user.id;
        const admin = adminClient();

        // 0. The block. Nothing is touched if any listing/experience/trade of
        //    theirs has other people relying on it, if they are mid-stay, or if
        //    they have an upcoming trip of their own. The friendly per-entity list
        //    goes back as 409 so the account page can name what to deal with (and
        //    link each own-trip straight to its cancel page); the scrub RPC re-runs
        //    the same set as its hard guard below.
        const blockers = await deletionBlockers(admin, uid);
        if (blockers.length > 0) {
            return NextResponse.json({ error: 'You still have things to deal with before closing your account.', blocked: blockers }, { status: 409 });
        }

        // 1. Gather every storage object owned by this user, before the scrub
        //    nulls the columns that name them.
        const paths = new Set<string>();
        const add = (v: unknown) => { if (typeof v === 'string' && v.trim()) paths.add(v); };

        const { data: prof } = await admin
            .from('profiles').select('avatar_url').eq('id', uid).maybeSingle();
        add(prof?.avatar_url);

        const { data: prov } = await admin
            .from('service_providers').select('photos, headshot, logo').eq('owner_id', uid).maybeSingle();
        if (prov) {
            if (Array.isArray(prov.photos)) prov.photos.forEach(add);
            add(prov.headshot);
            add(prov.logo);
        }

        const { data: listings } = await admin
            .from('listings').select('images').eq('host_id', uid);
        (listings || []).forEach((l: any) => { if (Array.isArray(l.images)) l.images.forEach(add); });

        // Sweep the id-stamped folders for every version this user ever uploaded,
        // not only the key a column still points at.
        const sweep = async (folder: string, owned: (name: string) => boolean) => {
            try {
                const { data: objs } = await admin.storage.from(BUCKET)
                    .list(folder, { limit: 1000 });
                (objs || []).forEach((o: any) => { if (o?.name && owned(o.name)) paths.add(`${folder}/${o.name}`); });
            } catch (e) {
                await logError('anonymise: storage list failed', e, { path: '/api/account/delete' });
            }
        };
        await sweep('avatars', (name) => name.startsWith(`${uid}-`));
        await sweep('providers', (name) => name.includes(uid));

        // 2. Scrub the account. Re-runs the same blocker set as its hard guard
        //    first, so if anything went live between the pre-check and now this
        //    raises and NOTHING — including their images — is touched.
        const { error: rpcError } = await supabase.rpc('anonymise_own_account');
        if (rpcError) {
            return NextResponse.json({ error: rpcError.message }, { status: 400 });
        }

        // 3. Remove the images. The account is already anonymised, so a storage
        //    error is logged, not surfaced as a failure — the erasure stands.
        //    Listing photos may also have been moved to the private
        //    `listings-removed` bucket by an admin takedown, so clear them there
        //    under the same keys.
        if (paths.size) {
            const keys = Array.from(paths);
            const { error: rmError } = await admin.storage.from(BUCKET).remove(keys);
            if (rmError) {
                await logError('anonymise: storage removal failed', rmError, { path: '/api/account/delete' });
            }
            const { error: rmRemovedError } = await admin.storage.from(REMOVED_BUCKET).remove(keys);
            if (rmRemovedError) {
                await logError('anonymise: removed-bucket removal failed', rmRemovedError, { path: '/api/account/delete' });
            }
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('anonymise: account closure failed', err, { path: '/api/account/delete' });
        return NextResponse.json({ error: 'Something went wrong closing your account. Please contact support.' }, { status: 500 });
    }
}
