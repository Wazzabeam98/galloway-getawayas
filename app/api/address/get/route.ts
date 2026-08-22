import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import ServerEnv from '@/config/ServerEnv';
import { mapAddress } from '@/lib/address';

export const dynamic = 'force-dynamic';

// The second half of the getAddress.io flow: swap the id from a suggestion for
// the full address. Server-side for the same reason as the autocomplete route
// — the key travels in the query string.
//
// The mapping from getAddress's fields to the form's boxes happens here rather
// than in the browser, so there is one place to read when a field lands in the
// wrong slot. That was the old bug: the mapping was spread through a .map(),
// a click handler and two fallbacks.

export async function GET(request: Request) {
    try {
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

        const id = (new URL(request.url).searchParams.get('id') || '').trim();

        if (!id) {
            return NextResponse.json({ ok: false, error: 'Missing address id' }, { status: 400 });
        }

        const url =
            `https://api.getAddress.io/get/${encodeURIComponent(id)}` +
            `?api-key=${encodeURIComponent(ServerEnv.GETADDRESS_API_KEY)}`;

        const response = await fetch(url, { cache: 'no-store' });

        if (!response.ok) {
            console.error('getAddress get failed', response.status);
            return NextResponse.json(
                { ok: false, error: 'Could not load that address.' },
                { status: 502 }
            );
        }

        return NextResponse.json({ ok: true, address: mapAddress(await response.json()) });
    } catch (err) {
        console.error('address get error', err);
        return NextResponse.json(
            { ok: false, error: 'Could not load that address.' },
            { status: 500 }
        );
    }
}
