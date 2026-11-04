import { redirect, notFound } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { hotelsOpen } from '@/lib/hotels';
import HotelDashboard from '@/components/hotel-dashboard/HotelDashboard';

export const dynamic = 'force-dynamic';

// The hotel owner's dashboard: their hotel(s), each with the rooms (edit price
// inline), an Edit button that reopens the wizard, Preview, and links to their
// bookings and messages. Bookings are counted per hotel; messages reuse the
// existing /messages inbox (a hotel booking is a bookings row with the owner as
// host_id, so its thread already appears there).
export default async function HotelDashboardPage() {
    if (!hotelsOpen()) notFound();

    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/addhotel');

    const admin = adminClient();
    const { data: hotels } = await admin
        .from('hotels')
        .select('id, name, status, property_type, location, images')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });

    const hotelIds = (hotels || []).map((h: any) => h.id);
    const roomsByHotel: Record<string, any[]> = {};
    const bookingCount: Record<string, number> = {};
    if (hotelIds.length) {
        const { data: rooms } = await admin
            .from('hotel_room_types')
            .select('id, hotel_id, name, inventory_count, price_per_night, breakfast_included, sort_order')
            .in('hotel_id', hotelIds)
            .order('sort_order', { ascending: true });
        (rooms || []).forEach((r: any) => { (roomsByHotel[r.hotel_id] ||= []).push(r); });

        const roomIds = (rooms || []).map((r: any) => r.id);
        if (roomIds.length) {
            const { data: bks } = await admin
                .from('bookings')
                .select('room_type_id, status')
                .in('room_type_id', roomIds)
                .in('status', ['confirmed', 'completed', 'pending']);
            const roomToHotel: Record<string, string> = {};
            (rooms || []).forEach((r: any) => { roomToHotel[r.id] = r.hotel_id; });
            (bks || []).forEach((b: any) => { const hid = roomToHotel[b.room_type_id]; if (hid) bookingCount[hid] = (bookingCount[hid] || 0) + 1; });
        }
    }

    return (
        <HotelDashboard
            hotels={(hotels as any) || []}
            roomsByHotel={roomsByHotel}
            bookingCount={bookingCount}
        />
    );
}
