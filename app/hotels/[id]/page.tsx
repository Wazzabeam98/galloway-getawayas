import { notFound } from 'next/navigation';
import { adminClient } from '@/lib/supabaseAdmin';
import { hotelsOpen } from '@/lib/hotels';
import HotelView from './HotelView';

export const dynamic = 'force-dynamic';

// A public page that will be indexed once hotels launch, so it names its own
// canonical (the root layout supplies none). Off production the page 404s while
// the flag is held, so nothing is indexed early.
export async function generateMetadata({ params }: { params: { id: string } }) {
    return { alternates: { canonical: `/hotels/${params.id}` } };
}

// A hotel's public page. Rendered server-side with the service role (the same
// way the public experience pages read), filtered to published, so RLS/anon
// column grants are not in the path here — the page shows a published hotel to
// anyone, or 404s. Held behind hotelsOpen(): off production the whole hotel
// surface is a 404 for real visitors, walkable on previews and TEST.
export default async function HotelPage({ params }: { params: { id: string } }) {
    if (!hotelsOpen()) notFound();

    const admin = adminClient();
    const { data: hotel } = await admin
        .from('hotels')
        .select('id, status, name, description, star_rating, property_type, location, street_address, check_in_time, check_out_time, facilities, house_rules, cancellation_policy, images, parking_type, parking_price, restaurant_hours')
        .eq('id', params.id)
        .maybeSingle();

    if (!hotel || hotel.status !== 'published') notFound();

    const { data: roomTypes } = await admin
        .from('hotel_room_types')
        .select('id, name, description, inventory_count, max_adults, max_children, max_occupancy, size_sqm, bed_config, bathroom_type, bathroom_features, views, smoking, accessibility, amenities, breakfast_included, images, price_per_night, min_nights')
        .eq('hotel_id', hotel.id)
        .eq('active', true)
        .order('sort_order', { ascending: true });

    return <HotelView hotel={hotel as any} roomTypes={(roomTypes as any) || []} />;
}
