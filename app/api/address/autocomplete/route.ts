import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import ServerEnv from '@/config/ServerEnv';

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
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        if (!ServerEnv.GETADDRESS_API_KEY) {
            return NextResponse.json(
                { ok: false, error: 'Address lookup is not configured.' },
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
            // Deliberately vague to the browser — an upstream body could carry
            // the key back out. The detail goes to the server log instead.
            console.error('getAddress autocomplete failed', response.status);
            return NextResponse.json(
                { ok: false, error: 'Address search is unavailable just now.' },
                { status: 502 }
            );
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
