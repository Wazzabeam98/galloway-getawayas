import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

// Called by the error pages when something breaks in a browser.
//
// Deliberately open — an error can happen to someone who isn't signed in, and
// those are exactly the ones worth knowing about. It writes to a table nobody
// but an owner can read, and the fields are capped so a flood of junk can't
// fill the database.
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const message = String((body && body.message) || 'Unknown error').slice(0, 500);
        const detail = body && body.detail ? String(body.detail).slice(0, 4000) : null;
        const path = body && body.path ? String(body.path).slice(0, 500) : null;
        const digest = body && body.digest ? String(body.digest).slice(0, 100) : null;

        // Who it happened to, if they were signed in. Helps enormously when
        // someone reports a problem and you're trying to find their error.
        let userId: string | null = null;
        try {
            const supabase = createRouteHandlerClient({ cookies });
            const { data: { session } } = await supabase.auth.getSession();
            userId = (session && session.user && session.user.id) || null;
        } catch {
            // Not signed in, or no session. Still worth recording.
        }

        const admin = adminClient();

        await admin.from('error_log').insert({
            source: 'client',
            message: message,
            detail: detail,
            path: path,
            digest: digest,
            user_id: userId,
            user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
        });

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        // Never let the error reporter become another error the guest sees.
        console.error('[errors/report]', err && err.message);
        return NextResponse.json({ ok: false });
    }
}
