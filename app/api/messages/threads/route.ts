import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { listingIdsFor } from '@/lib/access';
import { displayName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Conversations this person can see: their own trips, bookings at properties
// they own, and bookings at properties they co-host with permission to handle
// messages.
//
// Done on the server because a co-host is neither the guest nor the host on
// those rows, so row-level security would hide them.
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { session } } = await supabase.auth.getSession();

    if (!session || !session.user) {
        return NextResponse.json({ conversations: [] });
    }

    const uid = session.user.id;

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const messageListings = await listingIdsFor(uid, 'can_messages');

    // Their own bookings, as guest or host.
    const { data: own } = await admin
        .from('bookings')
        .select('id, listing_id, guest_id, host_id, check_in, check_out, created_at')
        .or('guest_id.eq.' + uid + ',host_id.eq.' + uid);

    // Bookings at properties they help with.
    const { data: helping } = messageListings.length
        ? await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_in, check_out, created_at')
            .in('listing_id', messageListings)
        : { data: [] };

    const seen: Record<string, boolean> = {};
    const bookings: any[] = [];

    (own || []).concat(helping || []).forEach((b: any) => {
        if (seen[b.id]) return;
        seen[b.id] = true;
        bookings.push(b);
    });

    bookings.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    if (bookings.length === 0) {
        return NextResponse.json({ conversations: [] });
    }

    const listingIds = Array.from(new Set(bookings.map((b) => b.listing_id)));
    const { data: listings } = await admin
        .from('listings')
        .select('id, title, images, host_id')
        .in('id', listingIds);

    const listingMap: Record<string, any> = {};
    (listings || []).forEach((l: any) => {
        listingMap[l.id] = l;
    });

    // On a booking they only see as a co-host, the person they're talking to
    // is the guest.
    const otherIds = Array.from(
        new Set(
            bookings.map((b) => (b.guest_id === uid ? b.host_id : b.guest_id))
        )
    );

    const { data: profiles } = await admin
        .from('profiles')
        .select('id, full_name, preferred_name, show_full_name')
        .in('id', otherIds);

    const nameMap: Record<string, string> = {};
    (profiles || []).forEach((p: any) => {
        nameMap[p.id] = displayName(p, 'Guest');
    });

    const { data: lastMessages } = await admin
        .from('messages')
        .select('booking_id, body, created_at')
        .in('booking_id', bookings.map((b) => b.id))
        .order('created_at', { ascending: false });

    const lastMap: Record<string, any> = {};
    (lastMessages || []).forEach((m: any) => {
        if (!lastMap[m.booking_id]) lastMap[m.booking_id] = m;
    });

    const conversations = bookings.map((b) => {
        const listing = listingMap[b.listing_id];
        const otherId = b.guest_id === uid ? b.host_id : b.guest_id;

        return {
            bookingId: b.id,
            listing: listing ? { id: listing.id, title: listing.title, images: listing.images } : null,
            otherName: nameMap[otherId] || 'Guest',
            checkIn: b.check_in,
            checkOut: b.check_out,
            lastMessage: lastMap[b.id] || null,
            // Flagged so the screen can make clear whose property it is.
            asCoHost: listing ? listing.host_id !== uid && b.guest_id !== uid : false,
        };
    });

    return NextResponse.json({ conversations: conversations });
}
