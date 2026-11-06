import { redirect, notFound } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkHotel } from '@/lib/hotelAccess';
import { hotelsOpen } from '@/lib/hotels';
import { isAdmin } from '@/lib/adminAudit';
import HotelView from '../HotelView';

// The real guest page for a hotel that is NOT public yet (a draft, or one
// waiting for approval), shown only to the people allowed to see it — the owner,
// a co-host with listing access, or an admin reviewing it. The sign-up wizard's
// Review step links the hotel title here, so a host sees exactly what guests
// will get rather than a cramped embed — the holiday-let preview's twin
// (/homes/[id]/preview). Reserve is disabled (preview), as on the listing side.
export const dynamic = 'force-dynamic';
export const metadata = {
    title: 'Preview',
    robots: { index: false, follow: false },
};

export default async function HotelPreviewPage({ params }: { params: { id: string } }) {
    if (!hotelsOpen()) notFound();

    const admin = adminClient();
    const { data: hotel } = await admin
        .from('hotels')
        .select('id, status, name, description, star_rating, property_type, location, street_address, check_in_time, check_out_time, facilities, house_rules, cancellation_policy, images, parking_type, parking_price, restaurant_hours, owner_id')
        .eq('id', params.id)
        .maybeSingle();

    // Gone public since? Send them to the real page, never the other way.
    if (hotel && hotel.status === 'published') redirect(`/hotels/${params.id}`);

    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !hotel) redirect('/');

    const allowed = hotel.owner_id === user.id
        || !!(await checkHotel(user.id, params.id, 'can_listing'))
        || await isAdmin(user.id);
    if (!allowed) redirect('/');

    const { data: roomTypes } = await admin
        .from('hotel_room_types')
        .select('id, name, description, inventory_count, max_adults, max_children, max_occupancy, size_sqm, bed_config, bathroom_type, bathroom_features, views, smoking, accessibility, amenities, breakfast_included, breakfast_price, images, price_per_night, min_nights')
        .eq('hotel_id', hotel.id)
        .eq('active', true)
        .order('sort_order', { ascending: true });

    return <HotelView hotel={hotel as any} roomTypes={(roomTypes as any) || []} preview />;
}
