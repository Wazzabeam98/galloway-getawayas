import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';

export const dynamic = 'force-dynamic';

// Taking a property off the site, or putting it back. Open to the owner and to
// a co-host they trusted with the listing — it changes what guests can see,
// not where any money goes, and it can always be undone.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const listingId: string = body && body.listingId;
        const hidden: boolean = !!(body && body.hidden);

        if (!listingId) {
            return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        }

        const access = await checkListing(session.user.id, listingId, 'can_listing');

        if (!access) {
            return NextResponse.json(
                { ok: false, error: 'You don\u2019t have permission to do that.' },
                { status: 403 }
            );
        }

        const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            { auth: { persistSession: false } }
        );

        // A listing still being written stays a draft — hiding it would strand
        // it somewhere it can't be finished from.
        const { data: listing } = await admin
            .from('listings')
            .select('status')
            .eq('id', listingId)
            .maybeSingle();

        if (!listing || listing.status === 'draft') {
            return NextResponse.json(
                { ok: false, error: 'This listing isn\u2019t published yet.' },
                { status: 400 }
            );
        }

        const { error } = await admin
            .from('listings')
            .update({ status: hidden ? 'hidden' : 'published' })
            .eq('id', listingId);

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, status: hidden ? 'hidden' : 'published' });
    } catch (err: any) {
        console.error('[listings/visibility]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not change that' },
            { status: 500 }
        );
    }
}
