import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { accessibleListings } from '@/lib/access';
import { normaliseReleaseHours, normaliseReleaseAtTime } from '@/lib/bookingWindows';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// When each of a host's properties releases its door code, for the message
// editor's warning.
//
// A {lockbox_code} message scheduled to send before the code is released is
// held back by the sender until the code is live, so the editor warns the host
// rather than letting them believe the code will go out when the message is
// timed. Working that out needs the per-listing release setting, which lives on
// listing_access_codes — a grant-less, service-role-only table a browser cannot
// read — so it comes back through here, release timing only and never the code
// itself, for the host's OWN listings that actually have a code set.
export async function GET() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(): the signature is verified against the
        // auth server, so the id below cannot be a forged cookie's.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const admin = adminClient();

        // Their own properties only — the editor lists a host's own templates and
        // listings, and a co-host neither owns the templates nor sets the codes.
        const access = await accessibleListings(user.id);
        const ownedIds = access.filter((a) => a.isOwner).map((a) => a.listingId);
        if (ownedIds.length === 0) {
            return NextResponse.json({ ok: true, listings: [] });
        }

        // Release timing is on the code's row; only listings that have a code
        // can hold a {lockbox_code} message, so only those are returned.
        const [{ data: codes }, { data: listings }] = await Promise.all([
            admin.from('listing_access_codes')
                .select('listing_id, release_hours, release_at_time')
                .in('listing_id', ownedIds),
            admin.from('listings')
                .select('id, title, check_in_time, check_out_time')
                .in('id', ownedIds),
        ]);

        const listingById: Record<string, any> = {};
        (listings || []).forEach((l: any) => { listingById[l.id] = l; });

        const out = (codes || []).map((c: any) => {
            const l = listingById[c.listing_id] || {};
            return {
                listing_id: c.listing_id,
                title: l.title || 'Untitled listing',
                // Normalised with the same rules the save route applies, so the
                // editor judges exactly the values the sender will read.
                release_hours: normaliseReleaseHours(c.release_hours),
                release_at_time: normaliseReleaseAtTime(c.release_at_time),
                check_in_time: l.check_in_time || null,
                check_out_time: l.check_out_time || null,
            };
        });

        return NextResponse.json({ ok: true, listings: out });
    } catch (err: any) {
        await logError('[message-templates/code-timing] ' + ((err && err.message) || 'failed'), err, {
            path: 'message-templates/code-timing',
        });
        return NextResponse.json({ ok: false, error: 'Could not read your code timing' }, { status: 500 });
    }
}
