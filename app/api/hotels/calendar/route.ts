import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { checkHotel } from '@/lib/hotelAccess';
import { hotelsOpen } from '@/lib/hotels';
import { roomsLeftByNight, type OverlapBooking } from '@/lib/hotelAvailability';
import { checkRoomOverridePatch, patchChangesSomething, mergeRoomOverrides, checkRoomOverrideDates } from '@/lib/hotelRoomOverrides';
import { dateFromKey } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

// The per-room-type availability calendar — the hotel twin of
// /api/listings/calendar. A room type's owner (can_calendar) can close dates and
// set seasonal prices; GET returns the overrides plus rooms-left per night.
// Writes are service-role (the browser gets SELECT on hotel_room_overrides only).

function keysInRange(fromKey: string, toKey: string): string[] {
    const out: string[] = [];
    let cur = dateFromKey(fromKey);
    const end = dateFromKey(toKey);
    let guard = 0;
    while (cur.getTime() <= end.getTime() && guard < 400) {
        const y = cur.getFullYear(), m = cur.getMonth() + 1, d = cur.getDate();
        out.push(y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d);
        cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
        guard++;
    }
    return out;
}

// Resolve the hotel for a room type and check the caller may manage its calendar.
async function allow(roomTypeId: string): Promise<{ ok: true; hotelId: string; roomType: any } | { ok: false; status: number; error: string }> {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, status: 401, error: 'Not signed in' };
    const admin = adminClient();
    const { data: rt } = await admin
        .from('hotel_room_types')
        .select('id, hotel_id, price_per_night, inventory_count, min_nights')
        .eq('id', roomTypeId)
        .maybeSingle();
    if (!rt) return { ok: false, status: 404, error: 'No such room type' };
    const access = await checkHotel(user.id, rt.hotel_id, 'can_calendar');
    if (!access) return { ok: false, status: 403, error: 'You don’t have permission to manage this calendar.' };
    return { ok: true, hotelId: rt.hotel_id, roomType: rt };
}

export async function GET(request: Request) {
    try {
        if (!hotelsOpen()) return NextResponse.json({ ok: false, error: 'Hotels are not open yet.' }, { status: 404 });
        const url = new URL(request.url);
        const roomTypeId = url.searchParams.get('roomType') || '';
        const from = url.searchParams.get('from') || '';
        const to = url.searchParams.get('to') || '';
        if (!roomTypeId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            return NextResponse.json({ ok: false, error: 'Missing room type or dates.' }, { status: 400 });
        }
        const a = await allow(roomTypeId);
        if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: a.status });

        const admin = adminClient();
        const { data: overrideRows } = await admin
            .from('hotel_room_overrides')
            .select('date, is_blocked, price_override')
            .eq('room_type_id', roomTypeId);
        const overrides: Record<string, { is_blocked: boolean; price_override: number | null }> = {};
        const blocked = new Set<string>();
        (overrideRows || []).forEach((r: any) => {
            const key = String(r.date).slice(0, 10);
            overrides[key] = { is_blocked: !!r.is_blocked, price_override: r.price_override != null ? Number(r.price_override) : null };
            if (r.is_blocked) blocked.add(key);
        });

        // Bookings overlapping the range → rooms left per night.
        const { data: bookings } = await admin
            .from('bookings')
            .select('check_in, check_out, rooms_booked, status, created_at')
            .eq('room_type_id', roomTypeId)
            .lt('check_in', to)
            .gt('check_out', from);
        const nights = keysInRange(from, to);
        const roomsLeft = roomsLeftByNight((bookings || []) as OverlapBooking[], Number(a.roomType.inventory_count) || 0, nights, blocked);

        return NextResponse.json({
            ok: true,
            base_price: Number(a.roomType.price_per_night),
            inventory: Number(a.roomType.inventory_count),
            min_nights: Number(a.roomType.min_nights),
            overrides,
            roomsLeft,
        });
    } catch (err: any) {
        await logError('[hotels/calendar GET] ' + ((err && err.message) || 'failed'), err, { path: 'hotels/calendar' });
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        if (!hotelsOpen()) return NextResponse.json({ ok: false, error: 'Hotels are not open yet.' }, { status: 404 });
        const body = await request.json();
        const roomTypeId: string = body && body.roomTypeId;
        if (!roomTypeId) return NextResponse.json({ ok: false, error: 'Missing room type' }, { status: 400 });
        const a = await allow(roomTypeId);
        if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: a.status });

        const checked = checkRoomOverridePatch(body);
        if (!checked.ok) return NextResponse.json({ ok: false, error: checked.error }, { status: 400 });
        if (!patchChangesSomething(checked.patch)) return NextResponse.json({ ok: false, error: 'Change the price or close the dates first.' }, { status: 400 });

        const admin = adminClient();
        const { data: existingRows } = await admin
            .from('hotel_room_overrides')
            .select('date, is_blocked, price_override')
            .eq('room_type_id', roomTypeId)
            .in('date', checked.patch.dates);
        const existing: Record<string, any> = {};
        (existingRows || []).forEach((r: any) => { existing[String(r.date).slice(0, 10)] = r; });

        const merged = mergeRoomOverrides(checked.patch, existing);
        if (merged.upsert.length) {
            const rows = merged.upsert.map((r) => ({ room_type_id: roomTypeId, date: r.date, is_blocked: r.is_blocked, price_override: r.price_override }));
            const { error } = await admin.from('hotel_room_overrides').upsert(rows, { onConflict: 'room_type_id,date' });
            if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }
        if (merged.clear.length) {
            await admin.from('hotel_room_overrides').delete().eq('room_type_id', roomTypeId).in('date', merged.clear);
        }
        return NextResponse.json({ ok: true, rows: merged.upsert, cleared: merged.clear });
    } catch (err: any) {
        await logError('[hotels/calendar POST] ' + ((err && err.message) || 'failed'), err, { path: 'hotels/calendar' });
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        if (!hotelsOpen()) return NextResponse.json({ ok: false, error: 'Hotels are not open yet.' }, { status: 404 });
        const body = await request.json();
        const roomTypeId: string = body && body.roomTypeId;
        if (!roomTypeId) return NextResponse.json({ ok: false, error: 'Missing room type' }, { status: 400 });
        const a = await allow(roomTypeId);
        if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: a.status });
        const checked = checkRoomOverrideDates(body);
        if (!checked.ok) return NextResponse.json({ ok: false, error: checked.error }, { status: 400 });
        const admin = adminClient();
        await admin.from('hotel_room_overrides').delete().eq('room_type_id', roomTypeId).in('date', checked.dates);
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('[hotels/calendar DELETE] ' + ((err && err.message) || 'failed'), err, { path: 'hotels/calendar' });
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
