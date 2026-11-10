import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { revalidatePath } from 'next/cache';
import { coordinatePatchFor } from '@/lib/postcodeGeocode';
import { checkHotel } from '@/lib/hotelAccess';
import { hotelsOpen, hotelPublishProblem } from '@/lib/hotels';

export const dynamic = 'force-dynamic';

// Publishing a hotel — the one thing not done by writing the row.
//
// Mirrors /api/listings/publish exactly: a browser role may never set status
// (the hotel tables grant it no write at all), so publishing goes through here.
// getUser(), not getSession(); checkHotel(can_listing) is the authority on who
// may publish, checked against the verified id. A hotel going live for the FIRST
// time goes to 'pending_review' and an owner approves it at /admin/hotels; one
// that has been live before re-publishes straight to 'published'. Coordinates
// are geocoded here, the one point the server touches every publish, as listings
// does.
export async function POST(request: Request) {
    let reporterId: string | null = null;
    try {
        if (!hotelsOpen()) {
            return NextResponse.json({ ok: false, error: 'Hotels are not open yet.' }, { status: 404 });
        }

        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        reporterId = (user && user.id) || null;
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json();
        const hotelId: string = body && body.hotelId;
        if (!hotelId) return NextResponse.json({ ok: false, error: 'Missing hotel' }, { status: 400 });

        const admin = adminClient();

        const access = await checkHotel(user.id, hotelId, 'can_listing');
        if (!access) {
            return NextResponse.json({ ok: false, error: 'You don’t have permission to publish this hotel.' }, { status: 403 });
        }

        const { data: hotel } = await admin
            .from('hotels')
            .select('id, owner_id, name, property_type, street_address, postcode, latitude, longitude, location, images, check_in_time, check_out_time, status')
            .eq('id', hotelId)
            .maybeSingle();
        if (!hotel) return NextResponse.json({ ok: false, error: 'No such hotel' }, { status: 404 });

        const { data: roomTypes } = await admin
            .from('hotel_room_types')
            .select('name, inventory_count, max_adults, max_children, max_occupancy, price_per_night')
            .eq('hotel_id', hotelId);

        // The same completeness the wizard shows, enforced server-side so a
        // direct POST cannot publish an incomplete hotel.
        const problem = hotelPublishProblem({ ...hotel, roomTypes: roomTypes || [] } as any);
        if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });

        const everPublished = hotel.status === 'published' || hotel.status === 'hidden';
        const nextStatus = everPublished ? 'published' : 'pending_review';

        const { error } = await admin
            .from('hotels')
            .update({ status: nextStatus, ...(await coordinatePatchFor(hotel as any, {})) })
            .eq('id', hotelId);
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

        revalidatePath('/hotels/browse');
        revalidatePath(`/hotels/${hotelId}`);

        return NextResponse.json({ ok: true, status: nextStatus });
    } catch (err: any) {
        await logError('hotels/publish: a hotel could not be published', err, { path: 'api/hotels/publish', userId: reporterId || undefined });
        return NextResponse.json({ ok: false, error: (err && err.message) || 'Could not publish that' }, { status: 500 });
    }
}
