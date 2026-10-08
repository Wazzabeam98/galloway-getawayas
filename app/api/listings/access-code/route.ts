import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { logError } from '@/lib/logError';
import { revealSecret, sealSecret } from '@/lib/listingSecrets';
import { normaliseReleaseHours, DEFAULT_CODE_RELEASE_HOURS } from '@/lib/bookingWindows';

export const dynamic = 'force-dynamic';

// The door code for a listing.
//
// The only way in or out of `listing_access_codes`. That table has no grants
// for `anon` or `authenticated`, so a browser cannot read or write it directly
// however the query is phrased — this route is the whole surface, and it
// checks `can_listing` before either.
//
// It is never returned to a guest. A guest receives the code exactly once, in
// the check-in message the scheduled sender writes for them, and that message
// is between the two of them like any other.

async function permitted(listingId: string) {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession() — getSession() trusts an unsigned
    // cookie, so a forged one impersonates any user. getUser() verifies
    // the token against the auth server. Matches the admin/services routes.
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return { error: 'Not signed in', status: 401, uid: '' };
    if (!listingId) return { error: 'Which listing?', status: 400, uid: '' };

    const access = await checkListing(user.id, listingId, 'can_listing');
    if (!access) return { error: 'Not your listing', status: 403, uid: '' };

    return { error: null, status: 200, uid: user.id };
}

export async function GET(request: Request) {
    try {
        const listingId = new URL(request.url).searchParams.get('listing') || '';
        const check = await permitted(listingId);

        if (check.error) {
            return NextResponse.json({ ok: false, error: check.error }, { status: check.status });
        }

        const { data } = await adminClient()
            .from('listing_access_codes')
            .select('code, updated_at, release_hours')
            .eq('listing_id', listingId)
            .maybeSingle();

        // Stored sealed (lib/secretBox); opened here, for the host, only.
        const code = data ? await revealSecret(data.code, { table: 'listing_access_codes', id: listingId }, 'listings/access-code') : null;
        return NextResponse.json({
            ok: true,
            code: code || '',
            updated_at: (data && data.updated_at) || null,
            // The host's own release window; a listing with no code yet answers
            // with the default so the control has something to show.
            release_hours: data ? normaliseReleaseHours(data.release_hours) : DEFAULT_CODE_RELEASE_HOURS,
        });
    } catch (err: any) {
        await logError('[listings/access-code GET] ' + ((err && err.message) || 'failed'), err, {
            path: 'listings/access-code',
        });
        return NextResponse.json({ ok: false, error: 'Could not read the code' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(function () { return {}; });
        const listingId: string = (body && body.listing) || '';
        const code: string = String((body && body.code) || '').trim();
        // The release window is the host's choice; the SAME rule the browser
        // applies runs here too, so a value the UI would not offer can never
        // reach the row by another route. Anything off the list becomes 24.
        const releaseHours = normaliseReleaseHours(body && body.release_hours);

        const check = await permitted(listingId);
        if (check.error) {
            return NextResponse.json({ ok: false, error: check.error }, { status: check.status });
        }

        const admin = adminClient();

        // Clearing it is a legitimate thing to want — a lock replaced, a
        // property sold on. Removing the row rather than storing an empty
        // string keeps "no code set" a single state, which is what the sender
        // checks before holding a message back.
        if (!code) {
            await admin.from('listing_access_codes').delete().eq('listing_id', listingId);
            return NextResponse.json({ ok: true, code: '' });
        }

        if (code.length > 40) {
            return NextResponse.json(
                { ok: false, error: 'That is longer than any door code — check it.' },
                { status: 400 }
            );
        }

        const { error } = await admin
            .from('listing_access_codes')
            .upsert(
                {
                    listing_id: listingId,
                    // Encrypted before it is stored: a copy of the database
                    // shows ciphertext, never the code.
                    code: sealSecret(code, { table: 'listing_access_codes', id: listingId }),
                    // When the code is handed over — the host's security to set.
                    release_hours: releaseHours,
                    updated_at: new Date().toISOString(),
                    // A door code is a credential. Being able to say who set
                    // it, and when, is part of being able to answer for it.
                    updated_by: check.uid,
                },
                { onConflict: 'listing_id' }
            );

        if (error) {
            await logError('[listings/access-code] could not save', error, {
                path: 'listings/access-code',
            });
            return NextResponse.json({ ok: false, error: 'Could not save the code' }, { status: 500 });
        }

        return NextResponse.json({ ok: true, code: code, release_hours: releaseHours });
    } catch (err: any) {
        await logError('[listings/access-code POST] ' + ((err && err.message) || 'failed'), err, {
            path: 'listings/access-code',
        });
        return NextResponse.json({ ok: false, error: 'Could not save the code' }, { status: 500 });
    }
}
