import { logError } from '@/lib/logError';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    let reporterId: string | null = null;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the auth
        // cookie — it never checks the signature — so the id below would be
        // whatever the caller wrote in it. getUser() asks the auth server,
        // which verifies the token and that the session has not been revoked.
        const { data: { user } } = await supabase.auth.getUser();
        reporterId = (user && user.id) || null;

        if (!user) {
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
            .select('id, booking_id, email, status, user_id, link_sent_at')
            .eq('invite_token', token)
            .maybeSingle();

        if (!invite || invite.status === 'removed') {
            return NextResponse.json(
                { ok: false, error: 'That invitation is no longer valid.' },
                { status: 404 }
            );
        }

        // The link expires when the stay ends, so a leaked or forgotten invite
        // can't sit live for months. Read the booking's check_out and compare on
        // date, not time — a same-day accept on the checkout day still counts.
        const { data: booking } = await admin
            .from('bookings')
            .select('check_out, status')
            .eq('id', invite.booking_id)
            .maybeSingle();

        if (!booking || booking.status === 'cancelled' || booking.status === 'declined') {
            return NextResponse.json(
                { ok: false, error: 'That trip is no longer available.' },
                { status: 404 }
            );
        }

        const today = new Date().toISOString().slice(0, 10);
        if (String(booking.check_out) < today) {
            return NextResponse.json(
                { ok: false, error: 'This invite has expired — the stay has already ended.' },
                { status: 410 }
            );
        }

        // Single use. Once a link is claimed it belongs to whoever claimed it:
        // the same person re-opening it is fine, anyone else gets a dead link.
        // This is what lets us drop the hard email binding below — a claimed
        // link can't be reused, and an unclaimed one can be revoked.
        if (invite.status === 'active') {
            if (invite.user_id === user.id) {
                return NextResponse.json({ ok: true, already: true });
            }
            return NextResponse.json(
                { ok: false, error: 'This link has already been used to join the trip.' },
                { status: 409 }
            );
        }

        // A minted-but-never-shared seat is INERT: its link cannot be claimed
        // until the booker actually hands it out (link_sent_at) or binds it to an
        // email. Opening the sheet mints the links, but they arm only when shared
        // — which closes the window where a link that was created but never sent
        // could be used. This is a "not ready yet" state, not a failure; the
        // invite page shows it gently.
        if (!invite.link_sent_at && !invite.email) {
            return NextResponse.json(
                { ok: false, notReady: true, error: 'This invite isn’t ready yet — ask whoever booked to send you the link.' },
                { status: 409 }
            );
        }

        // Email is an OPTIONAL gate now. When the booker typed an address, the
        // link stays bound to it — a forwarded invite still can't be claimed by
        // a stranger. When they didn't (a share-anywhere link), whoever opens
        // the unclaimed link first claims the seat.
        const signedInEmail = (user.email || '').toLowerCase();
        if (invite.email && signedInEmail !== invite.email.toLowerCase()) {
            return NextResponse.json(
                {
                    ok: false,
                    error: 'This invite was sent to ' + invite.email + '. Sign in with that address to accept it.',
                },
                { status: 403 }
            );
        }

        await admin
            .from('booking_guests')
            .update({
                user_id: user.id,
                status: 'active',
                accepted_at: new Date().toISOString(),
            })
            .eq('id', invite.id);

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[booking-guests/accept]', err && err.message);

        // The console is nobody's alarm. The guest clicked the link and got nothing; nobody else finds out.
        await logError('booking-guests/accept: a guest invitation could not be accepted', err, {
            path: 'api/booking-guests/accept',
            userId: reporterId || undefined,
        });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not accept the invitation' },
            { status: 500 }
        );
    }
}
