import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { checkHotel } from '@/lib/hotelAccess';
import { hotelsOpen, isHotelPropertyType, roomTypeProblem, occupancyOf, type DraftRoomType } from '@/lib/hotels';

export const dynamic = 'force-dynamic';

// Create and edit a hotel draft and its room types.
//
// The hotel tables grant the browser SELECT only — every write comes through
// here with the service role, exactly as edit-listing writes everything through
// /api/listings/save. This route is therefore the authority on who may write
// (checkHotel, against the verified getUser() id, never getSession()) and on
// what may be written: never status (that is /api/hotels/publish's alone), never
// owner_id, never commission_rate (an owner cannot set their own commission).
//
// Held behind hotelsOpen() — a direct POST is refused the same as a hidden
// button when the feature is off.
//
// A new hotel (no hotelId) is created as a draft owned by the caller and its id
// returned, the way /addhome inserts a draft; thereafter the wizard patches it.

// The columns the wizard may write. status/owner_id/commission_rate/coords are
// deliberately absent — coords are geocoded server-side at publish, as listings
// does. vat_number/vat_registered are the owner's to set.
const WRITABLE = new Set([
    'name', 'description', 'star_rating', 'property_type', 'location',
    'street_address', 'postcode', 'check_in_time', 'check_in_end_time',
    'check_out_time', 'facilities', 'house_rules', 'cancellation_policy',
    'cancellation_custom_days', 'vat_registered', 'vat_number', 'images',
    'parking_type', 'parking_price', 'restaurant_hours', 'restaurant_schedule',
    // House rules (parity with the holiday-let HouseRulesCard).
    'events_allowed', 'smoking_allowed', 'commercial_photography_allowed',
    'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end',
    'additional_rules', 'max_pets',
]);

function clean(patch: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch || {})) {
        if (WRITABLE.has(k)) out[k] = v;
    }
    if ('property_type' in out && out.property_type != null && !isHotelPropertyType(out.property_type)) {
        delete out.property_type; // ignore a bad value rather than store it
    }
    return out;
}

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
        const hotelId: string | null = (body && typeof body.hotelId === 'string') ? body.hotelId : null;
        const patch = clean((body && body.patch) || {});
        const roomTypes: Partial<DraftRoomType & { id?: string }>[] | null =
            Array.isArray(body && body.roomTypes) ? body.roomTypes : null;

        const admin = adminClient();

        // Create a fresh draft, owned by the caller.
        let id = hotelId;
        if (!id) {
            const { data, error } = await admin
                .from('hotels')
                .insert({ owner_id: user.id, status: 'draft', ...patch })
                .select('id')
                .single();
            if (error || !data) {
                return NextResponse.json({ ok: false, error: (error && error.message) || 'Could not start a hotel' }, { status: 500 });
            }
            id = data.id;
        } else {
            // Must be allowed to edit this hotel (owner or can_listing co-host).
            const access = await checkHotel(user.id, id, 'can_listing');
            if (!access) {
                return NextResponse.json({ ok: false, error: 'You don’t have permission to edit this hotel.' }, { status: 403 });
            }
            if (Object.keys(patch).length) {
                const { error } = await admin.from('hotels').update(patch).eq('id', id);
                if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
            }
        }

        // Room types, when the wizard sends them: add/edit the ones given, and
        // remove any the owner dropped that have no bookings yet (a room type
        // with bookings is never silently deleted — its FK on bookings protects
        // it, and we skip it with a note rather than erroring).
        if (roomTypes) {
            const problems = roomTypes.map((r, i) => ({ i, p: roomTypeProblem(r) })).filter((x) => x.p);
            if (problems.length) {
                return NextResponse.json({ ok: false, error: problems[0].p, roomIndex: problems[0].i }, { status: 400 });
            }

            const keptIds: string[] = [];
            for (let i = 0; i < roomTypes.length; i++) {
                const r = roomTypes[i];
                const adults = Math.floor(Number(r.max_adults));
                const children = Math.floor(Number(r.max_children ?? 0));
                const row = {
                    hotel_id: id,
                    name: String(r.name).trim(),
                    description: r.description ?? null,
                    inventory_count: Math.floor(Number(r.inventory_count)),
                    max_adults: adults,
                    max_children: children,
                    // Sleeps is derived, never asked for (Liam's walkthrough).
                    max_occupancy: occupancyOf({ max_adults: adults, max_children: children }),
                    size_sqm: r.size_sqm != null && r.size_sqm !== ('' as any) ? Math.floor(Number(r.size_sqm)) : null,
                    bed_config: Array.isArray(r.bed_config) ? r.bed_config : [],
                    bathroom_type: r.bathroom_type === 'private' || r.bathroom_type === 'shared' ? r.bathroom_type : null,
                    bathroom_features: Array.isArray(r.bathroom_features) ? r.bathroom_features : [],
                    views: Array.isArray(r.views) ? r.views : [],
                    smoking: ['non_smoking', 'smoking', 'both'].includes(String(r.smoking)) ? r.smoking : 'non_smoking',
                    accessibility: Array.isArray(r.accessibility) ? r.accessibility : [],
                    amenities: Array.isArray(r.amenities) ? r.amenities : [],
                    breakfast_included: !!r.breakfast_included,
                    images: Array.isArray((r as any).images) ? (r as any).images : [],
                    price_per_night: Number(r.price_per_night),
                    min_nights: r.min_nights != null ? Math.floor(Number(r.min_nights)) : 1,
                    sort_order: i,
                };
                if (r.id) {
                    const { error } = await admin.from('hotel_room_types').update(row).eq('id', r.id).eq('hotel_id', id);
                    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
                    keptIds.push(r.id);
                } else {
                    const { data, error } = await admin.from('hotel_room_types').insert(row).select('id').single();
                    if (error || !data) return NextResponse.json({ ok: false, error: (error && error.message) || 'Could not add a room type' }, { status: 500 });
                    keptIds.push(data.id);
                }
            }

            // Remove dropped room types that nothing has booked.
            const { data: existing } = await admin.from('hotel_room_types').select('id').eq('hotel_id', id);
            const toConsider = (existing || []).map((e: any) => e.id).filter((eid: string) => !keptIds.includes(eid));
            for (const dropId of toConsider) {
                const { count } = await admin
                    .from('bookings')
                    .select('id', { count: 'exact', head: true })
                    .eq('room_type_id', dropId);
                if (!count) await admin.from('hotel_room_types').delete().eq('id', dropId);
            }

            // Hand the saved ids back in the order they were sent, so the wizard
            // can attach them to its rooms and never insert the same room twice.
            return NextResponse.json({ ok: true, hotelId: id, roomIds: keptIds });
        }

        return NextResponse.json({ ok: true, hotelId: id });
    } catch (err: any) {
        await logError('hotels/save: a hotel could not be saved', err, { path: 'api/hotels/save', userId: reporterId || undefined });
        return NextResponse.json({ ok: false, error: (err && err.message) || 'Could not save that' }, { status: 500 });
    }
}
