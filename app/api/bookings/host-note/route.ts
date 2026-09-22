import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// The host's private note on a booking (bookings.host_note).
//
// The note lives in booking_host_notes, which has NO anon/authenticated grants —
// a guest cannot read it from PostgREST, and nor can a co-host touch it directly.
// This route is the whole surface, and it gates on can_bookings: the owner, or a
// co-host granted bookings for that listing. It reads the booking with the
// service key first only to learn WHICH listing to check, then checks the
// permission in code before writing through the service role.
//
// The note is host-private by design; it is never returned to a guest anywhere.

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

export async function POST(request: Request) {
    let bookingId = '';
    try {
        const body = await request.json().catch(() => ({}));
        bookingId = (body && body.bookingId) || '';
        const g = await gate(bookingId);
        if (g.error) return g.error;

        const raw = typeof body.note === 'string' ? body.note : '';
        const note = raw.trim().slice(0, MAX);

        // Empty clears it to null, so a host can wipe a note they no longer want.
        // One row per booking, upserted on the booking id.
        const { error } = await g.admin
            .from('booking_host_notes')
            .upsert({
                booking_id: bookingId,
                host_note: note || null,
                updated_at: new Date().toISOString(),
                updated_by: g.uid,
            }, { onConflict: 'booking_id' });

        if (error) {
            // Never the note itself — it is private, and error_log is readable at
            // /admin/errors. Only the booking id and the database's own message.
            await logError('booking-host-note-save', { bookingId, message: error.message }, { path: '/api/bookings/host-note' });
            return NextResponse.json({ ok: false, error: 'Could not save.' }, { status: 500 });
        }
        return NextResponse.json({ ok: true, note: note || null });
    } catch (err: any) {
        await logError('booking-host-note-save', { bookingId, message: String(err && err.message) }, { path: '/api/bookings/host-note' });
        return NextResponse.json({ ok: false, error: 'Could not save.' }, { status: 500 });
    }
}
