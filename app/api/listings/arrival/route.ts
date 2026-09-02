import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// The arrival details for a listing — the approach directions, parking, wifi and
// what3words. listing_arrival has no browser grants (the wall is the grant, not a
// policy), so this route is the ONLY way in or out. It gates on the same
// can_listing permission the rest of the listing editor uses, via checkListing —
// owner, or a co-host granted the listing permission. The read and write go
// through the service key because a co-host is not host_id on the row, so RLS
// would otherwise hide it; the permission is checked HERE, first, in code.
//
// The DOOR CODE is deliberately NOT here: it lives in listing_access_codes and is
// read/written through /api/listings/access-code, its own long-standing secure
// route. This one never touches it.

const FIELDS = ['arrival_directions', 'parking_info', 'wifi_name', 'wifi_password', 'what3words'] as const;

async function gate(listingId: string) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 }) };
    const access = await checkListing(user.id, listingId, 'can_listing');
    if (!access) return { error: NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 }) };
    return { uid: user.id };
}

export async function GET(request: Request) {
    const listingId = new URL(request.url).searchParams.get('listing') || '';
    if (!listingId) return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
    const g = await gate(listingId);
    if (g.error) return g.error;
    const admin = adminClient();
    const { data } = await admin.from('listing_arrival').select(FIELDS.join(', ')).eq('listing_id', listingId).maybeSingle();
    return NextResponse.json({ ok: true, arrival: data || {} });
}

export async function POST(request: Request) {
    let listingId = '';
    try {
        const body = await request.json().catch(() => ({}));
        listingId = (body && body.listingId) || '';
        if (!listingId) return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        const g = await gate(listingId);
        if (g.error) return g.error;

        // Only the whitelisted fields, and only the ones the caller actually
        // SENT. A key that is absent from the body is left untouched; a key that
        // is present writes its value (empty string clears it to null). This is
        // a partial update on purpose: the editor sends one field at a time when
        // its GET failed or raced, and a full-replace would blank the wifi
        // password the caller never meant to touch — silently, with nothing in
        // the log. So absence means "leave alone", never "set to null".
        const row: any = { listing_id: listingId, updated_at: new Date().toISOString() };
        for (const f of FIELDS) {
            if (!(f in body)) continue;
            const v = typeof body[f] === 'string' ? body[f].trim().slice(0, 2000) : '';
            row[f] = v || null;
        }

        const admin = adminClient();
        const { error } = await admin.from('listing_arrival').upsert(row, { onConflict: 'listing_id' });
        if (error) {
            // NEVER the body — it holds the wifi password and the approach
            // directions, and error_log is readable at /admin/errors. Only the
            // listing id and the database's own message, which name no secret.
            await logError('listing-arrival-save', { listingId, message: error.message }, { path: '/api/listings/arrival' });
            return NextResponse.json({ ok: false, error: 'Could not save.' }, { status: 500 });
        }
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('listing-arrival-save', { listingId, message: String(err && err.message) }, { path: '/api/listings/arrival' });
        return NextResponse.json({ ok: false, error: 'Could not save.' }, { status: 500 });
    }
}
