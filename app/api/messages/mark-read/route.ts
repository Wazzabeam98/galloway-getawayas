import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Marks everything in a thread that was addressed to this person as read.
//
// Scoped to recipient_id, so opening a conversation can only ever clear your
// own unread flags — never the other person's.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the auth
        // cookie — it never checks the signature — so the id below would be
        // whatever the caller wrote in it. getUser() asks the auth server,
        // which verifies the token and that the session has not been revoked.
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ ok: false }, { status: 401 });
        }

        const body = await request.json();
        const bookingId: string = body && body.bookingId;

        if (!bookingId) {
            return NextResponse.json({ ok: false, error: 'Missing booking' }, { status: 400 });
        }

        const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            { auth: { persistSession: false } }
        );

        await admin
            .from('messages')
            .update({ read_at: new Date().toISOString() })
            .eq('booking_id', bookingId)
            .eq('recipient_id', user.id)
            .is('read_at', null);

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[messages/mark-read]', err && err.message);
        return NextResponse.json({ ok: false });
    }
}
