import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import ServerEnv from '@/config/ServerEnv';
import { upstreamDetail } from '@/lib/address';

export const dynamic = 'force-dynamic';

// Suggestions as the host types. This exists as a server route for one reason:
// getAddress.io takes the API key as a query-string parameter, so calling it
// from the browser would put the key in the network tab.
//
// Returns only { id, address } per suggestion. The id is what /api/address/get
// exchanges for the full address.
export async function GET(request: Request) {
    try {
        // Signed in only. Every call spends a lookup from a paid allowance, so
        // an open endpoint here is somebody else's bill.
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the auth
        // cookie — it never checks the signature — so the id below would be
        // whatever the caller wrote in it. getUser() asks the auth server,
        // which verifies the token and that the session has not been revoked.
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        if (!ServerEnv.GETADDRESS_API_KEY) {
            return NextResponse.json(
                {
                    ok: false,
                    // A host reads this, not a developer. Naming the missing
                    // environment variable told the one person who could not
                    // act on it, and told them the site was broken rather than
                    // that there is a way round. The variable name still
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
            `https://api.getAddress.io/autocomplete/${encodeURIComponent(term)}` +
            `?api-key=${encodeURIComponent(ServerEnv.GETADDRESS_API_KEY)}&top=20`;

        const response = await fetch(url, { cache: 'no-store' });

        if (!response.ok) {
            const detail = await upstreamDetail(response, ServerEnv.GETADDRESS_API_KEY);
            console.error('getAddress autocomplete failed', detail);
            // The real status, not a friendly mask — a rejected key, a spent
            // allowance and an outage need telling apart from the browser.
            return NextResponse.json({ ok: false, error: detail }, { status: 502 });
        }

        const data = await response.json();
        const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];

        return NextResponse.json({
            ok: true,
            suggestions: suggestions
                .filter((s: any) => s && s.id && s.address)
                .map((s: any) => ({ id: String(s.id), address: String(s.address) })),
        });
    } catch (err) {
        console.error('address autocomplete error', err);
        return NextResponse.json(
            { ok: false, error: 'Address search is unavailable just now.' },
            { status: 500 }
        );
    }
}
