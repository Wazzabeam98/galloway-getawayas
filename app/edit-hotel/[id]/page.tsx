export const dynamic = "force-dynamic";

// A private editor, never indexed.
export const metadata = { robots: { index: false, follow: false } };

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { adminClient } from "@/lib/supabaseAdmin";
import { checkHotel } from "@/lib/hotelAccess";
import { hotelsOpen } from "@/lib/hotels";
import HotelEditor from "@/components/hotel-editor/HotelEditor";

// Edit a published (or draft) hotel, the sectioned way the holiday-let editor
// works: a page of lifted cards, each opening a panel. A draft is still finished
// in the one-question-at-a-time wizard (/addhotel?draft=); this is the editor a
// host comes back to afterwards. Writing goes through /api/hotels/save, which is
// the authority on permission and on what may be written — this page only gates
// the view and seeds it with the current values.
export default async function EditHotelPage({ params }: { params: { id: string } }) {
    if (!hotelsOpen()) notFound();

    const supabase = createServerComponentClient({ cookies });
    const { data: user } = await supabase.auth.getUser();
    const uid = user.user?.id || '';

    const access = await checkHotel(uid, params.id, 'can_listing');
    if (!access) notFound();

    const admin = adminClient();
    const { data: hotel } = await admin
        .from('hotels')
        .select('id, name, description, star_rating, property_type, location, street_address, postcode, facilities, parking_type, parking_price, restaurant_schedule, restaurant_hours, images, check_in_time, check_in_end_time, check_out_time, cancellation_policy, cancellation_custom_days, vat_registered, house_rules, additional_rules, events_allowed, smoking_allowed, commercial_photography_allowed, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, max_pets, status')
        .eq('id', params.id)
        .maybeSingle();
    if (!hotel) notFound();

    const { data: rooms } = await admin
        .from('hotel_room_types')
        .select('*')
        .eq('hotel_id', params.id)
        .order('sort_order', { ascending: true });

    return <HotelEditor hotel={hotel} rooms={rooms || []} />;
}
