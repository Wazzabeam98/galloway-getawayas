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

        const body = await request.json();
        const token: string = body && body.token;

        if (!token) {
            return NextResponse.json({ ok: false, error: 'Missing invitation' }, { status: 400 });
        }

        const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            { auth: { persistSession: false } }
        );

        const { data: invite } = await admin
            .from('booking_guests')
            .select('id, booking_id, email, status')
            .eq('invite_token', token)
            .maybeSingle();

        if (!invite || invite.status === 'removed') {
            return NextResponse.json(
                { ok: false, error: 'That invitation is no longer valid.' },
                { status: 404 }
            );
        }

        // Invited to a person, not to whoever opens the link — otherwise a
        // forwarded email would let a stranger see where someone is staying.
        const signedInEmail = (session.user.email || '').toLowerCase();

        if (signedInEmail !== (invite.email || '').toLowerCase()) {
            return NextResponse.json(
                {
                    ok: false,
                    error: 'This invitation was sent to ' + invite.email + '. Sign in with that address to accept it.',
                },
                { status: 403 }
            );
        }

        if (invite.status === 'active') {
            return NextResponse.json({ ok: true, already: true });
        }

        await admin
            .from('booking_guests')
            .update({
                user_id: session.user.id,
                status: 'active',
                accepted_at: new Date().toISOString(),
            })
            .eq('id', invite.id);

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[booking-guests/accept]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not accept the invitation' },
            { status: 500 }
        );
    }
}
