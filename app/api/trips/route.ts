import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Trips this person booked, plus trips they've been added to by someone else.
//
// The money fields are stripped from a shared trip before it leaves the
// server. Hiding them in the page would be a curtain, not a wall.
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession() — getSession() trusts an unsigned
    // cookie, so a forged one impersonates any user. getUser() verifies
    // the token against the auth server. Matches the admin/services routes.
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ trips: [] });
    }

    const uid = user.id;

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const { data: own } = await admin
        .from('bookings')
        .select('*')
        .eq('guest_id', uid)
        .order('check_in', { ascending: false });

    const { data: sharedRows } = await admin
        .from('booking_guests')
        .select('booking_id')
        .eq('user_id', uid)
        .eq('status', 'active');

    const sharedIds = (sharedRows || []).map((r: any) => r.booking_id);

    const { data: shared } = sharedIds.length
        ? await admin
            .from('bookings')
            .select('id, listing_id, host_id, guest_id, check_in, check_out, guests, status')
            .in('id', sharedIds)
            .order('check_in', { ascending: false })
        : { data: [] };

    const trips: any[] = [];

    (own || []).forEach((b: any) => {
        trips.push({ ...b, sharedWithMe: false });
    });

    (shared || []).forEach((b: any) => {
        if (trips.some((t) => t.id === b.id)) return;

        trips.push({
            id: b.id,
            listing_id: b.listing_id,
            host_id: b.host_id,
            check_in: b.check_in,
            check_out: b.check_out,
            guests: b.guests,
            status: b.status,
            // Deliberately absent: total_price, amount_paid, balance_amount,
            // payment_status, and everything else about the money.
            sharedWithMe: true,
        });
    });

    trips.sort((a, b) => (a.check_in < b.check_in ? 1 : -1));

    return NextResponse.json({ trips: trips });
}
