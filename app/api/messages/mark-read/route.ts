import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { markThreadRead, type ThreadKind } from '@/lib/threadReads';
import { orderThreadContext } from '@/lib/orderThreads';
import { enquiryThreadContext } from '@/lib/enquiryThreads';

export const dynamic = 'force-dynamic';

// Marks a thread read for this person — a booking, an experience order or a
// job (enquiry). Sent with { bookingId } (as it always was) or { kind, id }.
//
// Called when they choose a conversation (clicking it, even one the page had
// already put on screen for them), from "Mark as read", and when they send in
// one. It writes BOTH read markers the list checks: read_at on what was
// addressed to them, and — for the owner or a co-host — their own place in
// the thread (lib/threadReads). Before 20/10/2026 only the first existed, and
// a co-host had no marker at all to write or to read back.
//
// Scoped to recipient_id and to their own read position, so opening (or
// replying in) a conversation can only ever clear your own unread flags —
// never anybody else's.
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

        const body = (await request.json()) || {};
        const kind: ThreadKind = body.bookingId ? 'booking' : body.kind;
        const id: string = body.bookingId || body.id;

        if (!id || (kind !== 'booking' && kind !== 'order' && kind !== 'enquiry')) {
            return NextResponse.json({ ok: false, error: 'Missing thread' }, { status: 400 });
        }

        const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            { auth: { persistSession: false } }
        );

        // Only a thread they can see. The read position below is theirs alone,
        // but a position on someone else's booking is not theirs to hold.
        const allowed = kind === 'booking'
            ? await maySeeBooking(admin, user.id, id)
            : kind === 'order'
                ? !!(await orderThreadContext(admin, id, user.id))
                : !!(await enquiryThreadContext(admin, id, user.id));
        if (!allowed) {
            return NextResponse.json({ ok: false }, { status: 403 });
        }

        await markThreadRead(admin, user.id, kind, id);

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('[messages/mark-read]', err && err.message);
        return NextResponse.json({ ok: false });
    }
}

// The guest, the owner, a companion on the trip, or a co-host with messages —
// the same people the thread route lets in.
async function maySeeBooking(admin: any, uid: string, bookingId: string): Promise<boolean> {
    const { data: b } = await admin.from('bookings').select('guest_id, host_id, listing_id').eq('id', bookingId).maybeSingle();
    if (!b) return false;
    if (b.guest_id === uid || b.host_id === uid) return true;
    const { data: companion } = await admin.from('booking_guests').select('id')
        .eq('booking_id', bookingId).eq('user_id', uid).eq('status', 'active').maybeSingle();
    if (companion) return true;
    return !!(await checkListing(uid, b.listing_id, 'can_messages'));
}
