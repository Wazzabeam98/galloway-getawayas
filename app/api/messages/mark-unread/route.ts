import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';
import { markThreadUnreadForTeam } from '@/lib/threadReads';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Puts one conversation back to unread for the person asking.
//
// The mirror of mark-read, and scoped the same way: recipient_id must be them,
// so this can only ever change their own state and never the other person's.
// It needs the service key because messages has no UPDATE policy at all for
// authenticated — the browser cannot write read_at itself.
//
// It clears read_at on the last message sent TO THEM, which is not the same as
// the last message in the thread. If a host marks a conversation unread after
// replying, the thing that should come back unread is the guest's question,
// not the host's own answer — and a conversation can have a companion in it as
// well, so "the other person" is not a safe shortcut either.
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

        const admin = adminClient();

        const { data: last, error: findError } = await admin
            .from('messages')
            .select('id')
            .eq('booking_id', bookingId)
            .eq('recipient_id', user.id)
            // Never their own message, even addressed to themselves (a stay an
            // owner booked at their own place).
            .neq('sender_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (findError) throw findError;

        if (last) {
            const { error: updateError } = await admin
                .from('messages')
                .update({ read_at: null })
                .eq('id', last.id)
                .eq('recipient_id', user.id);

            if (updateError) throw updateError;
        }

        // On the team side — the owner or a co-host — what they read is tracked
        // by their place in the thread (lib/threadReads), and a co-host is never
        // the recipient of anything. Step it back before the newest message from
        // somebody else. Their own place only; never anyone else's.
        const { data: b } = await admin.from('bookings').select('guest_id, host_id, listing_id').eq('id', bookingId).maybeSingle();
        const team = !!b && (b.host_id === user.id
            || (b.guest_id !== user.id && !!(await checkListing(user.id, b.listing_id, 'can_messages'))));
        const teamMarked = team ? await markThreadUnreadForTeam(admin, user.id, 'booking', bookingId) : false;

        // A conversation where nobody else has said anything. There is nothing
        // that could be unread, so say so rather than reporting a success that
        // changed nothing.
        return NextResponse.json({ ok: true, marked: !!last || teamMarked });
    } catch (err: any) {
        console.error('[messages/mark-unread]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not mark as unread' }, { status: 500 });
    }
}
