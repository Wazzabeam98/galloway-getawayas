import { redirect, notFound } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { hotelsOpen } from '@/lib/hotels';
import RoomCalendar from '@/components/hotel-dashboard/RoomCalendar';

export const dynamic = 'force-dynamic';

// The per-room-type availability calendar (close dates, seasonal prices, rooms
// left per date), modelled on the cottage dashboard calendar.
export default async function HotelCalendarPage({ searchParams }: { searchParams: { hotel?: string } }) {
    if (!hotelsOpen()) notFound();
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/addhotel');

    const admin = adminClient();
    let q = admin.from('hotels').select('id, name').eq('owner_id', user.id);
    if (searchParams?.hotel) q = q.eq('id', searchParams.hotel);
    const { data: hotels } = await q;
    const hotelIds = (hotels || []).map((h: any) => h.id);

    const { data: rooms } = hotelIds.length
        ? await admin.from('hotel_room_types').select('id, hotel_id, name, price_per_night, inventory_count').in('hotel_id', hotelIds).order('sort_order', { ascending: true })
        : { data: [] as any[] };

    return <RoomCalendar hotels={(hotels as any) || []} rooms={(rooms as any) || []} />;
}
