import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';

// Closing an account ANONYMISES it — it never deletes the profile or auth row,
// because bookings/payments/payouts/orders are RESTRICT-linked to them and must
// survive as financial/audit records (see
// 20260924181742_anonymise_own_account.sql). This route does the two things the
// database function can't: it removes the person's images from the public
// storage bucket, and it authenticates the caller before scrubbing.
//
// Order: gather the storage paths, scrub the account (which guards against live
// bookings and raises if any exist — so a blocked erasure touches nothing),
// then remove the images with the paths gathered before the columns were nulled.

const BUCKET = process.env.NEXT_PUBLIC_S3_BUCKET || 'listings';

export async function POST() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
        }
        const uid = user.id;
        const admin = adminClient();

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

        // 2. Scrub the account. Runs the live-bookings guard first, so if the
        //    user still has upcoming/pending bookings this raises and NOTHING —
        //    including their images — is touched.
        const { error: rpcError } = await supabase.rpc('anonymise_own_account');
        if (rpcError) {
            return NextResponse.json({ error: rpcError.message }, { status: 400 });
        }

        // 3. Remove the images. The account is already anonymised, so a storage
        //    error is logged, not surfaced as a failure — the erasure stands.
        if (paths.size) {
            const { error: rmError } = await admin.storage.from(BUCKET).remove(Array.from(paths));
            if (rmError) {
                await logError('anonymise: storage removal failed', rmError, { path: '/api/account/delete' });
            }
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('anonymise: account closure failed', err, { path: '/api/account/delete' });
        return NextResponse.json({ error: 'Something went wrong closing your account. Please contact support.' }, { status: 500 });
    }
}
