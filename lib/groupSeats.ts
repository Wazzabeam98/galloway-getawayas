// Server-side reads of a group's seats, for the invite flow.
//
// booking_guests cannot be read from the browser for a whole group: the
// "order guests readable" RLS policy references service_orders, which the
// authenticated role has no SELECT grant on, so ANY authenticated select on
// booking_guests throws "permission denied for table service_orders" and comes
// back as an error, not rows. The experience side already avoids this by reading
// seats through the service role; the holiday-let side must do the same. This is
// the one place both sides read a group's seats, so the pattern can't drift.

export interface LoadedSeats {
    seats: any[];
    profiles: Record<string, any>;
}

async function withProfiles(admin: any, seats: any[]): Promise<LoadedSeats> {
    const ids = (seats || []).filter((s: any) => s.user_id).map((s: any) => s.user_id);
    const profiles: Record<string, any> = {};
    if (ids.length) {
        const { data: profRows } = await admin
            .from('profiles')
            .select('id, avatar_url, full_name, preferred_name, show_full_name')
            .in('id', ids);
        (profRows || []).forEach((p: any) => { profiles[p.id] = p; });
    }
    return { seats: seats || [], profiles };
}

// A booking's seats (the holiday-let party), server-authoritative.
export async function loadBookingSeats(admin: any, bookingId: string): Promise<LoadedSeats> {
    const { data } = await admin
        .from('booking_guests')
        .select('id, user_id, name, email, status, invite_token, seat_index, link_sent_at')
        .eq('booking_id', bookingId)
        .neq('status', 'removed')
        .order('seat_index');
    return withProfiles(admin, data || []);
}
