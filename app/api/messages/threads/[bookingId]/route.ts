import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { contactNumberVisible } from '@/lib/stayWindow';
import { firstName, getImageUrl } from '@/lib/utils';
import { groupLabel } from '@/lib/bookingDisplay';

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
    // getUser(), not getSession() — getSession() trusts an unsigned
    // cookie, so a forged one impersonates any user. getUser() verifies
    // the token against the auth server. Matches the admin/services routes.
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
    }

    const uid = user.id;
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
        .select('id, title, location, images, check_in_time, check_in_end_time, check_out_time, check_in_method, cancellation_policy, max_guests, amenities')
        .eq('id', booking.listing_id)
        .maybeSingle();

    // The person on the other side of the conversation. For anyone on the
    // host's side that's the guest; for the guest it's the host.
    const otherId = isGuest ? booking.host_id : booking.guest_id;

    const { data: otherProfile } = await admin
        .from('profile_private')
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

    // The reservation-pane header, in the SAME shape the experience threads use
    // (ReservationHeader): a stay and an experience read as one product. The host
    // side sees the guest large with the listing photo tucked into the corner and
    // "Isla's group of 2"; the guest/companion side sees the listing large with
    // its initial, mirroring how a guest sees the business on an experience thread.
    const onHostSide = isHost || isCoHost;
    // The guest's PUBLIC profile for the header name + avatar — the same source
    // the experience thread and the host booking page use, so the heading reads
    // "Isla's group of 2", not the profile_private fallback "Guest". FIRST name
    // only (never displayName): the counterparty must not be shown a surname —
    // the display-names guard enforces this route stays clear of displayName.
    const { data: guestPublic } = onHostSide
        ? await admin.from('profiles').select('full_name, preferred_name, show_full_name, avatar_url').eq('id', booking.guest_id).maybeSingle()
        : { data: null };
    const guestFirstForHeader = firstName(guestPublic, 'Guest');
    const guestAvatar = onHostSide && guestPublic && guestPublic.avatar_url
        ? getImageUrl(String(guestPublic.avatar_url)) : null;
    const listingPhoto = listing && Array.isArray(listing.images) && listing.images[0]
        ? getImageUrl(String(listing.images[0])) : null;
    const listingTitle = (listing && listing.title) || 'your stay';
    const header = onHostSide
        ? {
            avatarUrl: guestAvatar,
            initial: (guestFirstForHeader || 'G').slice(0, 1).toUpperCase(),
            photoUrl: listingPhoto,
            heading: groupLabel(guestFirstForHeader, booking.guests),
            // The guest's public first name, so the Manage sheet and its money
            // flow name the same person the heading does ("Isla"), not the
            // profile_private fallback the conversation falls back to.
            personFirst: guestFirstForHeader,
        }
        : {
            avatarUrl: null,
            initial: listingTitle.slice(0, 1).toUpperCase(),
            photoUrl: null,
            heading: listingTitle,
            personFirst: firstName(otherProfile, 'Host'),
        };

    return NextResponse.json({
        ok: true,
        role: isGuest ? 'guest' : isHost ? 'host' : isCoHost ? 'co_host' : 'companion',
        header,
        canSeePhone: phoneAllowed,
        other: {
            id: otherId,
            name: firstName(otherProfile, isGuest ? 'Host' : 'Guest'),
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
            // free_cancel_until is no longer sent: the pane computes the
            // cancellation position live from check_in + the listing's policy.
            cancellation_policy: listing && listing.cancellation_policy,
            total_price: showMoney ? booking.total_price : null,
            amount_paid: showMoney ? booking.amount_paid : null,
            // Fed to the Manage-reservation flows: the refund figure the host's
            // Send-money sheet and either side's Cancel confirm compute from
            // net paid. Money, so withheld from a companion the same as the rest.
            amount_refunded: showMoney ? booking.amount_refunded : null,
            cleaning_fee: showMoney ? booking.cleaning_fee : null,
            balance_amount: showMoney ? booking.balance_amount : null,
            balance_due_date: showMoney ? booking.balance_due_date : null,
            payment_status: showMoney ? booking.payment_status : null,
        },
        messages: messages || [],
    });
}
