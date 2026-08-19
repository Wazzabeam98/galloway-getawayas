import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';

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

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const listingId: string = body && body.listingId;
        const patch = (body && body.patch) || {};

        if (!listingId) {
            return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        }

        const access = await checkListing(session.user.id, listingId, 'can_listing');

        if (!access) {
            return NextResponse.json(
                { ok: false, error: 'You don\u2019t have permission to edit this listing.' },
                { status: 403 }
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

        const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            { auth: { persistSession: false } }
        );

        const { error } = await admin.from('listings').update(safe).eq('id', listingId);

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[listings/save]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not save' },
            { status: 500 }
        );
    }
}
