import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            { auth: { persistSession: false } }
        );

        const { data: profile } = await admin
            .from('profiles')
            .select('is_admin')
            .eq('id', session.user.id)
            .maybeSingle();

        if (!profile || profile.is_admin !== true) {
            return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });
        }

        const body = await request.json();
        const id: string = body && body.id;

        if (!id) {
            return NextResponse.json({ ok: false, error: 'Missing error' }, { status: 400 });
        }

        const { error } = await admin
            .from('error_log')
            .update({ resolved: !!(body && body.resolved) })
            .eq('id', id);

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[errors/resolve]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not update' },
            { status: 500 }
        );
    }
}
