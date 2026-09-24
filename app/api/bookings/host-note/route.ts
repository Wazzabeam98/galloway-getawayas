import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// The host's private notes on a booking — an APPEND-ONLY log.
//
// The notes live in booking_host_notes, which has NO anon/authenticated grants —
// a guest cannot read them from PostgREST, and nor can a co-host touch them
// directly. This route is the whole surface, and it gates on can_bookings: the
// owner, or a co-host granted bookings for that listing. It reads the booking
// with the service key first only to learn WHICH listing to check, then checks
// the permission in code before writing through the service role.
//
// POST only ever INSERTs a new stamped entry; there is no update and no delete,
// so once a note is saved it stands. Empty notes are rejected — an add with
// nothing in it is not a note.

const MAX = 2000;

async function gate(bookingId: string) {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession() — getSession() trusts an unsigned cookie.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 }) };
    if (!bookingId) return { error: NextResponse.json({ ok: false, error: 'Missing booking.' }, { status: 400 }) };

    const admin = adminClient();
    const { data: booking } = await admin.from('bookings').select('id, listing_id').eq('id', bookingId).maybeSingle();
    if (!booking) return { error: NextResponse.json({ ok: false, error: 'No such booking.' }, { status: 404 }) };

    const access = await checkListing(user.id, booking.listing_id, 'can_bookings');
    if (!access) return { error: NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 }) };

    return { uid: user.id, booking, admin };
}

export async function GET(request: Request) {
    try {
        const bookingId = new URL(request.url).searchParams.get('booking') || '';
        const g = await gate(bookingId);
        if (g.error) return g.error;
        const { data } = await g.admin
            .from('booking_host_notes')
            .select('host_note, created_at')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: true });
        return NextResponse.json({ ok: true, notes: data || [] });
    } catch (err: any) {
        await logError('[booking-host-note GET]', { message: String(err && err.message) }, { path: '/api/bookings/host-note' });
        return NextResponse.json({ ok: false, error: 'Could not read notes.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    let bookingId = '';
    try {
        const body = await request.json().catch(() => ({}));
        bookingId = (body && body.bookingId) || '';
        const g = await gate(bookingId);
        if (g.error) return g.error;

        const raw = typeof body.note === 'string' ? body.note : '';
        const note = raw.trim().slice(0, MAX);
        if (!note) return NextResponse.json({ ok: false, error: 'Write something to add.' }, { status: 400 });

        // Add-only: a new stamped row each time. Never an update or a delete.
        const { data, error } = await g.admin
            .from('booking_host_notes')
            .insert({ booking_id: bookingId, host_note: note, created_by: g.uid })
            .select('host_note, created_at')
            .single();

        if (error) {
            // Never the note itself — it is private, and error_log is readable at
            // /admin/errors. Only the booking id and the database's own message.
            await logError('booking-host-note-save', { bookingId, message: error.message }, { path: '/api/bookings/host-note' });
            return NextResponse.json({ ok: false, error: 'Could not save.' }, { status: 500 });
        }
        return NextResponse.json({ ok: true, note: data });
    } catch (err: any) {
        await logError('booking-host-note-save', { bookingId, message: String(err && err.message) }, { path: '/api/bookings/host-note' });
        return NextResponse.json({ ok: false, error: 'Could not save.' }, { status: 500 });
    }
}
