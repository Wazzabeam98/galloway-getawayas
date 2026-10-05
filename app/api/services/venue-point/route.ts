// The sign-up wizard saves the provider row from the browser, where nothing can
// geocode or write a platform column. So once it has saved, it asks this route to
// bring the "Where you'll be" map point in line with the address it just wrote
// (lib/venuePoint.ts). Owner-only; best effort — the wizard ignores the answer.
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { refreshVenuePoint } from '@/lib/venuePoint';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser, not getSession: the identity is verified, not read from a cookie.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Sign in first' }, { status: 401 });

        const body = await req.json().catch(() => ({}));
        const providerId = String(body?.providerId || '');
        if (!providerId) return NextResponse.json({ ok: false, error: 'No listing' }, { status: 400 });

        const admin = adminClient();
        const { data: p } = await admin
            .from('service_providers')
            .select('id, owner_id, audience')
            .eq('id', providerId)
            .maybeSingle();
        if (!p || p.owner_id !== user.id || p.audience !== 'guest') {
            return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
        }

        const outcome = await refreshVenuePoint(admin, providerId);
        return NextResponse.json({ ok: true, outcome });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: 'Could not update the map point' }, { status: 500 });
    }
}
