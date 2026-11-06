export const dynamic = "force-dynamic";

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { accessibleListings } from "@/lib/access";
import { accessibleHotels } from "@/lib/hotelAccess";
import { hotelsOpen } from "@/lib/hotels";
import CottageCalendarClient from "@/components/dashboard/CottageCalendarClient";
import RoomCalendar from "@/components/hotel-dashboard/RoomCalendar";

// The host calendar. A cottage host gets the single-unit calendar they always
// had (CottageCalendarClient, which loads its own listings). A hotel owner gets
// the per-room-type calendar — the one thing hotels genuinely need differently,
// inventory counted per room rather than one unit free or not — rendered under
// the same host nav, so the two look of a piece. Someone with both sees both.
export default async function CalendarPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: user } = await supabase.auth.getUser();
    const uid = user.user?.id || '';

    // Does this person have any cottage calendar to manage? (Owned or co-hosted
    // with can_calendar, and not a draft — a draft has no guests arriving.)
    const access = uid ? await accessibleListings(uid) : [];
    const calendarListingIds = access.filter((a) => a.can_calendar).map((a) => a.listingId);

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const { count: liveCottages } = calendarListingIds.length
        ? await admin.from('listings').select('id', { count: 'exact', head: true }).in('id', calendarListingIds).neq('status', 'draft')
        : { count: 0 };
    const hasCottageCalendar = (liveCottages || 0) > 0;

    // Hotel room types this person may manage, behind the launch flag.
    let hotelList: { id: string; name: string }[] = [];
    let hotelRooms: { id: string; hotel_id: string; name: string; price_per_night: number; inventory_count: number }[] = [];
    if (hotelsOpen() && uid) {
        const hAccess = await accessibleHotels(uid);
        const calHotelIds = hAccess.filter((a) => a.can_calendar).map((a) => a.hotelId);
        if (calHotelIds.length) {
            const [{ data: hotelRows }, { data: roomRows }] = await Promise.all([
                admin.from('hotels').select('id, name').in('id', calHotelIds),
                admin.from('hotel_room_types').select('id, hotel_id, name, price_per_night, inventory_count')
                    .in('hotel_id', calHotelIds).eq('active', true).order('sort_order', { ascending: true }),
            ]);
            hotelList = (hotelRows || []) as any;
            hotelRooms = (roomRows || []) as any;
        }
    }

    const hasHotelCalendar = hotelRooms.length > 0;

    // Someone who signed in but has nothing yet, or isn't signed in: let the
    // cottage client render its own sign-in / empty states, unchanged.
    if (!hasHotelCalendar) return <CottageCalendarClient />;

    return (
        <>
            {hasCottageCalendar && <CottageCalendarClient />}
            <RoomCalendar hotels={hotelList} rooms={hotelRooms} />
        </>
    );
}
