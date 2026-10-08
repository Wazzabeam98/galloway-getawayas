import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';
import { getImageUrl, firstName as firstNameOf } from '@/lib/utils';
import { contactNumberVisible, stayHasEnded, stayHasStarted } from '@/lib/stayWindow';
import { refundDue } from '@/lib/cancellation';
import { reservationPanel } from '@/lib/hostReservation';

export const dynamic = 'force-dynamic';

// One of our own reservations for the host calendar's side panel — what the
// booking page shows at the top, reduced to a panel: who, when, how many, what
// they paid, the phone once released, the message thread and the same
// Manage-reservation actions.
//
// The same walls as app/dashboard/bookings/[id]: the booking is read with the
// service key (a co-host is not host_id, so RLS would hide it) and access is
// decided by checkListing straight after. Seeing the calendar (can_calendar)
// is enough for the dates and the name already on the bar; the detail needs
// can_bookings and the money can_earnings — enforced in reservationPanel
// before anything is returned. getUser(), not getSession(): this hands out a
// guest's phone number.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

    const admin = adminClient();
    const { data: booking } = await admin
        .from('bookings')
        .select('id, listing_id, guest_id, check_in, check_out, status, payment_status, guests, adults, children, pets, total_price, amount_paid, amount_refunded, cleaning_fee')
        .eq('id', params.id)
        .maybeSingle();

    // One answer for "no such booking" and "not yours", so the route cannot be
    // used to find out which booking ids exist.
    const notFound = NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    if (!booking) return notFound;

    const access = await checkListing(user.id, booking.listing_id, 'can_calendar');
    if (!access) return notFound;

    const [{ data: listing }, { data: profile }] = await Promise.all([
        admin.from('listings')
            .select('id, title, images, check_out_time, cancellation_policy, max_guests, amenities')
            .eq('id', booking.listing_id)
            .maybeSingle(),
        admin.from('profiles')
            .select('id, full_name, preferred_name, show_full_name, avatar_url')
            .eq('id', booking.guest_id)
            .maybeSingle(),
    ]);

    const guestName = firstNameOf(profile, 'Guest');
    const guestFirst = guestName.split(' ')[0] || 'there';
    const now = new Date();

    // Only fetched for someone who will be shown it.
    let phone: string | null = null;
    let openChange: any = null;
    if (access.can_bookings) {
        if (contactNumberVisible(booking, listing?.check_out_time, now)) {
            const { data: priv } = await admin
                .from('profile_private')
                .select('phone')
                .eq('id', booking.guest_id)
                .maybeSingle();
            phone = (priv && priv.phone) || null;
        }
        const { data: change } = await admin
            .from('booking_change_requests')
            .select('id, initiated_by, status')
            .eq('booking_id', booking.id)
            .in('status', ['pending', 'awaiting_guest_payment'])
            .maybeSingle();
        openChange = change || null;
    }

    const paid = Number(booking.amount_paid || 0);
    const refunded = Number(booking.amount_refunded || 0);

    const panel = reservationPanel({
        booking,
        listing: {
            title: listing?.title,
            image: listing?.images?.[0] ? getImageUrl(listing.images[0]) : null,
            max_guests: listing?.max_guests,
            petsAllowed: Array.isArray(listing?.amenities) && listing!.amenities.indexOf('Pets allowed') !== -1,
        },
        guest: {
            name: guestName,
            first: guestFirst,
            avatarUrl: profile?.avatar_url ? getImageUrl(String(profile.avatar_url)) : null,
        },
        access,
        phone,
        started: stayHasStarted(booking.check_in, now),
        ended: stayHasEnded(booking.check_out, listing?.check_out_time, now),
        // The very function the refund routes run — the same figure the
        // booking page quotes in its ask-to-cancel message.
        guestWouldGet: refundDue({
            amountPaid: paid,
            alreadyRefunded: refunded,
            cleaningFee: booking.cleaning_fee,
            checkIn: booking.check_in,
            policy: listing?.cancellation_policy,
        }),
        openChange,
    });

    return NextResponse.json({ ok: true, reservation: panel });
}
