import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const admin = adminClient();

        // Checked here on the server every time. The screen hiding itself is
        // presentation; this is what actually decides.
        const { data: profile } = await admin
            .from('profiles')
            .select('is_admin')
            .eq('id', session.user.id)
            .maybeSingle();

        if (!profile || !profile.is_admin) {
            return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });
        }

        const body = await request.json();
        const listingId: string = body && body.listingId;
        const raw = body && body.rate;

        if (!listingId) {
            return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        }

        // An empty value means "no arrangement of its own", which the rest of
        // the site reads as the standard rate.
        let rate: number | null = null;
        if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
            rate = Number(raw);
            if (isNaN(rate) || rate < 0 || rate > 100) {
                return NextResponse.json(
                    { ok: false, error: 'Rate must be between 0 and 100' },
                    { status: 400 }
                );
            }
        }

        const { error } = await admin
            .from('listings')
            .update({ commission_rate: rate })
            .eq('id', listingId);

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, rate: rate });
    } catch (err: any) {
        console.error('[admin/commission]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not save' },
            { status: 500 }
        );
    }
}
