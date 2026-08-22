import { listingIdsFor } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// How many booking requests are sitting waiting for this host to answer.
//
// A guest's money is held from the moment they book, so a request nobody has
// noticed is the one thing on here that costs somebody something while it is
// ignored. This feeds the dot on the menu, the same way unread messages do.
//
// Counted with the service key against the listings this person may handle
// bookings for: a co-host is not the host_id on a booking row, so asking as
// them returns nothing and the badge would quietly never appear.
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { session } } = await supabase.auth.getSession();

    if (!session || !session.user) {
        return NextResponse.json({ pending: 0 });
    }

    const allowed = await listingIdsFor(session.user.id, 'can_bookings');

    if (allowed.length === 0) {
        return NextResponse.json({ pending: 0 });
    }

    // 'pending' only. 'pending_payment' is a guest part-way through checkout
    // with nothing for the host to do, and badging it would have a host
    // opening the page to find an empty list.
    const { count } = await adminClient()
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .in('listing_id', allowed)
        .eq('status', 'pending');

    return NextResponse.json({ pending: count || 0 });
}
