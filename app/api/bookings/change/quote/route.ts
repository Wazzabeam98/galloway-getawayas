import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { changeDelta, round2 } from '@/lib/bookingChange';
import { quoteChangeTotal } from '@/lib/quoteChange';

export const dynamic = 'force-dynamic';

// Re-price a proposed change so the form can show the new total and the delta
// before anyone commits. Same authoritative pricing the create route uses, so
// what the form shows is what will be charged/refunded. Read-only.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const bookingId: string = body && body.bookingId;
        if (!bookingId) return NextResponse.json({ ok: false, error: 'Missing booking' }, { status: 400 });

        const admin = adminClient();
        const { data: booking } = await admin
            .from('bookings').select('id, listing_id, guest_id, total_price').eq('id', bookingId).maybeSingle();
        if (!booking) return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });

        const isGuest = booking.guest_id === user.id;
        const isHost = isGuest ? false : !!(await checkListing(user.id, booking.listing_id, 'can_bookings'));
        if (!isGuest && !isHost) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });

        const total = await quoteChangeTotal(admin, {
            listingId: booking.listing_id,
            newCheckIn: String((body && body.checkIn) || ''),
            newCheckOut: String((body && body.checkOut) || ''),
            newGuests: Math.trunc(Number(body && body.guests)),
            newChildren: Math.trunc(Number(body && body.children) || 0),
            newPets: Math.trunc(Number(body && body.pets) || 0),
        });
        return NextResponse.json({ ok: true, total, delta: changeDelta(round2(Number(booking.total_price || 0)), total) });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: 'Could not price that.' }, { status: 500 });
    }
}
