import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { contactNumberVisible } from '@/lib/stayWindow';
import { displayName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// One call for everything the two right-hand panes need: the conversation,
// who it's with, and the booking behind it.
//
// Done here rather than in the browser because a co-host is neither party on
// these rows, and because what a companion may see has to be decided
// server-side — see the money fields below.
export async function GET(
    req: NextRequest,
    { params }: { params: { bookingId: string } }
) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { session } } = await supabase.auth.getSession();

    if (!session || !session.user) {
        return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
    }

    const uid = session.user.id;
    const bookingId = params.bookingId;

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const { data: booking } = await admin
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .maybeSingle();

    if (!booking) {
        return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }

    const isGuest = booking.guest_id === uid;
    const isHost = booking.host_id === uid;

    let isCompanion = false;
    let isCoHost = false;

    if (!isGuest && !isHost) {
        const { data: companion } = await admin
            .from('booking_guests')
            .select('id')
            .eq('booking_id', bookingId)
            .eq('user_id', uid)
            .eq('status', 'active')
            .maybeSingle();

        isCompanion = !!companion;

        if (!isCompanion) {
            const access = await checkListing(uid, booking.listing_id, 'can_messages');
            isCoHost = !!access;
        }
    }

    if (!isGuest && !isHost && !isCompanion && !isCoHost) {
        return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });
    }

    const { data: listing } = await admin
        .from('listings')
        .select('id, title, location, images, check_in_time, check_in_end_time, check_out_time, check_in_method')
        .eq('id', booking.listing_id)
        .maybeSingle();

    // The person on the other side of the conversation. For anyone on the
    // host's side that's the guest; for the guest it's the host.
    const otherId = isGuest ? booking.host_id : booking.guest_id;

    const { data: otherProfile } = await admin
        .from('profiles')
        .select('id, full_name, preferred_name, show_full_name, phone, avatar_url')
        .eq('id', otherId)
        .maybeSingle();

    const { data: messages } = await admin
        .from('messages')
        .select('id, sender_id, body, created_at, read_at')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: true });

    // Money is for the two people whose money it is. A companion was added to
    // a trip; they were not shown the price and must not be here either.
    const showMoney = isGuest || isHost || isCoHost;

    // Being one of the two people on a booking is not on its own a reason to
    // be handed the other one's phone number: the same rule the reservation
    // card and the booking screen use applies here, and it did not before, so
    // this panel was still showing a guest's number on a stay that had been
    // cancelled months ago. The number is not sent at all when it is not to be
    // shown — a value that reaches the browser has been given out, whatever
    // the screen does with it afterwards.
    const phoneOnFile = (otherProfile && otherProfile.phone) || null;
    const phoneAllowed = isGuest || isHost || isCoHost;
    const phoneNow =
        phoneAllowed && contactNumberVisible(booking, listing && listing.check_out_time);

    // Said rather than left blank, so a host looking for a number knows it is
    // coming rather than assuming the guest never gave one.
    const phoneHeld = phoneAllowed && phoneOnFile && !phoneNow
        ? (booking.status === 'cancelled' || booking.status === 'declined'
            ? 'closed'
            : 'early')
        : null;

    return NextResponse.json({
        ok: true,
        role: isGuest ? 'guest' : isHost ? 'host' : isCoHost ? 'co_host' : 'companion',
        canSeePhone: phoneAllowed,
        other: {
            id: otherId,
            name: displayName(otherProfile, isGuest ? 'Host' : 'Guest'),
            phone: phoneNow ? phoneOnFile : null,
            // 'early' — there is a number, but it is not close enough to
            // arrival. 'closed' — the booking is cancelled or was declined.
            phoneHeld: phoneHeld,
            avatar: (otherProfile && otherProfile.avatar_url) || null,
        },
        listing: listing || null,
        booking: {
            id: booking.id,
            check_in: booking.check_in,
            check_out: booking.check_out,
            guests: booking.guests,
            adults: booking.adults,
            children: booking.children,
            pets: booking.pets,
            status: booking.status,
            created_at: booking.created_at,
            free_cancel_until: booking.free_cancel_until,
            cancellation_policy: booking.cancellation_policy,
            total_price: showMoney ? booking.total_price : null,
            amount_paid: showMoney ? booking.amount_paid : null,
            balance_amount: showMoney ? booking.balance_amount : null,
            balance_due_date: showMoney ? booking.balance_due_date : null,
            payment_status: showMoney ? booking.payment_status : null,
        },
        messages: messages || [],
    });
}
