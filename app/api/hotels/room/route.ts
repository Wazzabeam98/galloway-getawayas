import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { checkHotel } from '@/lib/hotelAccess';
import { hotelsOpen } from '@/lib/hotels';

export const dynamic = 'force-dynamic';

// Targeted update of ONE room's price / inventory, for the dashboard's inline
// edit. Deliberately separate from /api/hotels/save, whose roomTypes path is a
// replace-set (it deletes rooms not in the payload) and would wipe the other
// rooms if sent a single room. This only ever touches the one room named, and
// only its price and inventory — nothing else on the room is changed.
export async function POST(request: Request) {
    try {
        if (!hotelsOpen()) return NextResponse.json({ ok: false, error: 'Hotels are not open yet.' }, { status: 404 });

        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json();
        const hotelId: string = body && body.hotelId;
        const roomId: string = body && body.roomId;
        if (!hotelId || !roomId) return NextResponse.json({ ok: false, error: 'Missing room' }, { status: 400 });

        const access = await checkHotel(user.id, hotelId, 'can_listing');
        if (!access) return NextResponse.json({ ok: false, error: 'You don’t have permission to edit this hotel.' }, { status: 403 });

        const patch: Record<string, any> = {};
        if (body.price_per_night != null) {
            const p = Number(body.price_per_night);
            if (!Number.isFinite(p) || p <= 0) return NextResponse.json({ ok: false, error: 'Give the room a nightly price.' }, { status: 400 });
            patch.price_per_night = p;
        }
        if (body.inventory_count != null) {
            const c = Math.floor(Number(body.inventory_count));
            if (!Number.isInteger(c) || c < 1) return NextResponse.json({ ok: false, error: 'There must be at least one room.' }, { status: 400 });
            patch.inventory_count = c;
        }
        if (!Object.keys(patch).length) return NextResponse.json({ ok: true });

        const admin = adminClient();
        const { error } = await admin.from('hotel_room_types').update(patch).eq('id', roomId).eq('hotel_id', hotelId);
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('[hotels/room] ' + ((err && err.message) || 'failed'), err, { path: 'hotels/room' });
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
