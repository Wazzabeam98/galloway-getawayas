import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import ServerEnv from '@/config/ServerEnv';
import { mapAddress, upstreamDetail } from '@/lib/address';
import { adminDistrictForPostcode, DG_ADMIN_DISTRICT } from '@/lib/postcodeGeocode';

export const dynamic = 'force-dynamic';

// The second half of the lookup: swap the id from a suggestion for the full
// address (Ideal Postcodes). Server-side for the same reason as the autocomplete
// route — the key travels in the query string.
//
// The mapping from the provider's fields to the form's boxes happens here rather
// than in the browser, so there is one place to read when a field lands in the
// wrong slot. That was the old bug: the mapping was spread through a .map(),
// a click handler and two fallbacks.
//
// THIS IS ALSO THE REGION GATE. The autocomplete only BIASES to D&G; the real
// "is this address in Dumfries & Galloway" test is the council area, checked
// here on the resolved postcode via postcodes.io. An address outside D&G comes
// back with { ok: false, outOfRegion: true, district } so the form can say so
// plainly rather than silently accepting it.

export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the auth
        // cookie — it never checks the signature — so the id below would be
        // whatever the caller wrote in it. getUser() asks the auth server,
        // which verifies the token and that the session has not been revoked.
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        if (!ServerEnv.IDEAL_POSTCODES_API_KEY) {
            return NextResponse.json(
                {
                    ok: false,
                    // Same wording as /address/autocomplete, and for the same
                    // reason: the person reading it is a host, not whoever can
                    // set the variable.
                    error: 'We can\u2019t look up addresses just now. Enter yours by hand instead \u2014 nothing else changes.',
                },
                { status: 503 }
            );
        }

        const id = (new URL(request.url).searchParams.get('id') || '').trim();

        if (!id) {
            return NextResponse.json({ ok: false, error: 'Missing address id' }, { status: 400 });
        }

        const url =
            'https://api.ideal-postcodes.co.uk/v1/autocomplete/addresses/'
            + `${encodeURIComponent(id)}/gbr`
            + `?api_key=${encodeURIComponent(ServerEnv.IDEAL_POSTCODES_API_KEY)}`;

        const response = await fetch(url, { cache: 'no-store' });

        if (!response.ok) {
            const detail = await upstreamDetail(response, ServerEnv.IDEAL_POSTCODES_API_KEY);
            console.error('address get failed', detail);
            return NextResponse.json({ ok: false, error: detail }, { status: 502 });
        }

        // Ideal Postcodes returns the resolved address under `result`.
        const body = await response.json();
        const address = mapAddress((body && body.result) || {});

        // THE REGION GATE. The council area of the resolved postcode is the real
        // "is it in D&G" test — not the postcode prefix. postcodes.io returns the
        // admin_district; anything but Dumfries and Galloway is refused, with the
        // district named so the form can say where it actually is. A postcode we
        // can't place (null) is refused too rather than guessed into the region.
        const district = await adminDistrictForPostcode(address.postcode);
        if (!district || district.toLowerCase() !== DG_ADMIN_DISTRICT.toLowerCase()) {
            return NextResponse.json({
                ok: false,
                outOfRegion: true,
                district: district || null,
            }, { status: 200 });
        }

        return NextResponse.json({ ok: true, address });
    } catch (err) {
        console.error('address get error', err);
        return NextResponse.json(
            { ok: false, error: 'Could not load that address.' },
            { status: 500 }
        );
    }
}
