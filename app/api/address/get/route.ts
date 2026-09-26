import { NextResponse } from 'next/server';
import ServerEnv from '@/config/ServerEnv';
import { mapAddress, upstreamDetail } from '@/lib/address';
import { adminDistrictForPostcode, DG_ADMIN_DISTRICT } from '@/lib/postcodeGeocode';
import { withinLimits, callerAddress, GLOBAL_KEY } from '@/lib/rateLimit';

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
// THIS IS THE REGION GATE. The autocomplete hard-filters suggestions to the DG
// postcode area; the authoritative "is this address in Dumfries & Galloway" test
// is the council area, checked here on the resolved postcode via postcodes.io. An
// address outside D&G comes back with { ok: false, outOfRegion: true, district }
// so the form can say so plainly rather than silently accepting it — this catches
// the few DG-area postcodes that reach over the Cumbrian border.
//
// NO SIGN-IN, same as /api/address/autocomplete: a guest orders without an
// account, so a paid lookup is protected by the rate limit below rather than a
// sign-in wall.

export async function GET(request: Request) {
    try {
        const verdict = await withinLimits([
            { bucket: 'address-get:all', key: GLOBAL_KEY, max: 600, windowMinutes: 60 },
            { bucket: 'address-get:ip', key: callerAddress(request.headers), max: 60, windowMinutes: 60 },
        ]);
        if (!verdict.ok) {
            return NextResponse.json(
                { ok: false, error: 'Too many address lookups in a short time. Try again shortly, or enter your address by hand.' },
                { status: 429 }
            );
        }

        if (!ServerEnv.IDEAL_POSTCODES_API_KEY) {
            return NextResponse.json(
                {
                    ok: false,
                    // Same wording as /address/autocomplete, and for the same
                    // reason: the person reading it is a guest or host, not
                    // whoever can set the variable.
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
