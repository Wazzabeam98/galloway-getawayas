import { NextResponse } from 'next/server';
import ServerEnv from '@/config/ServerEnv';
import { upstreamDetail } from '@/lib/address';
import { withinLimits, callerAddress, GLOBAL_KEY } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Suggestions as the guest (or host) types. This exists as a server route for one
// reason: Ideal Postcodes takes the API key as a query-string parameter, so
// calling it from the browser would put the key in the network tab.
//
// Returns only { id, address } per suggestion. The id is what /api/address/get
// exchanges for the full address.
//
// NO SIGN-IN. A guest can order food or book a comes-to-you chef without an
// account, and they need to search for their address like everyone else. Every
// call still spends a lookup from a paid allowance, so an open endpoint is
// somebody else's bill — the guard against that is the rate limit below, not a
// sign-in wall. IP slows a single abuser; the site-wide cap is the load-bearing
// half, because it bounds the total spend however the calls are spread.
//
// HARD FILTER TO DUMFRIES & GALLOWAY. postcode_area=dg tells Ideal Postcodes to
// return only DG addresses, so a search that would otherwise surface an English
// street never appears in the list. This is a postcode-area filter, not the
// authoritative region test: a handful of DG postcodes reach into Cumbria, so
// the council-area "is it really in D&G" check still runs on the CHOSEN address
// in /api/address/get. (It is one-directional — a genuine D&G address that sits
// in a bordering area like CA/KA won't be suggested — which is the trade Liam
// asked for: only offer DG.)
export async function GET(request: Request) {
    try {
        // Open to signed-out guests, so a paid lookup is rate-limited instead of
        // gated on identity. Per-IP slows one caller; the site-wide cap bounds
        // the total draw on the allowance no matter how the calls are spread.
        const verdict = await withinLimits([
            { bucket: 'address-autocomplete:all', key: GLOBAL_KEY, max: 1500, windowMinutes: 60 },
            { bucket: 'address-autocomplete:ip', key: callerAddress(request.headers), max: 150, windowMinutes: 60 },
        ]);
        if (!verdict.ok) {
            return NextResponse.json(
                { ok: false, error: 'Too many address searches in a short time. Try again shortly, or enter your address by hand.' },
                { status: 429 }
            );
        }

        if (!ServerEnv.IDEAL_POSTCODES_API_KEY) {
            return NextResponse.json(
                {
                    ok: false,
                    // A guest or host reads this, not a developer. Naming the
                    // missing environment variable told the one person who could
                    // not act on it, and told them the site was broken rather
                    // than that there is a way round. The variable name still
                    // reaches /admin/errors, where somebody can do something
                    // about it.
                    error: 'We can\u2019t look up addresses just now. Enter yours by hand instead \u2014 nothing else changes.',
                },
                { status: 503 }
            );
        }

        const term = (new URL(request.url).searchParams.get('q') || '').trim();

        // The client debounces and holds off until three characters, but the
        // route cannot assume it was reached by the client.
        if (term.length < 3) {
            return NextResponse.json({ ok: true, suggestions: [] });
        }

        const url =
            'https://api.ideal-postcodes.co.uk/v1/autocomplete/addresses'
            + `?query=${encodeURIComponent(term)}`
            + `&api_key=${encodeURIComponent(ServerEnv.IDEAL_POSTCODES_API_KEY)}`
            // Hard filter: only Dumfries & Galloway (DG) addresses are suggested.
            // An empty result therefore means "nothing in D&G matched", which is
            // what the client says. The council-area gate on the chosen address
            // (/api/address/get) still catches the few DG postcodes over the
            // Cumbrian border.
            + '&postcode_area=dg';

        const response = await fetch(url, { cache: 'no-store' });

        if (!response.ok) {
            const detail = await upstreamDetail(response, ServerEnv.IDEAL_POSTCODES_API_KEY);
            console.error('address autocomplete failed', detail);
            // The real status, not a friendly mask — a rejected key, a spent
            // allowance and an outage need telling apart from the browser.
            return NextResponse.json({ ok: false, error: detail }, { status: 502 });
        }

        // Ideal Postcodes: { result: { hits: [{ id, suggestion, udprn }] } }.
        const data = await response.json();
        const hits = (data && data.result && Array.isArray(data.result.hits)) ? data.result.hits : [];

        return NextResponse.json({
            ok: true,
            // Keep our own { id, address } contract so the client is unchanged.
            suggestions: hits
                .filter((s: any) => s && s.id && s.suggestion)
                .map((s: any) => ({ id: String(s.id), address: String(s.suggestion) })),
        });
    } catch (err) {
        console.error('address autocomplete error', err);
        return NextResponse.json(
            { ok: false, error: 'Address search is unavailable just now.' },
            { status: 500 }
        );
    }
}
