import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { checkHotel } from '@/lib/hotelAccess';
import { hotelsOpen } from '@/lib/hotels';

export const dynamic = 'force-dynamic';

// Targeted update of ONE room's price / inventory / pricing-availability
// settings, for the dashboard calendar's per-room panel and inline edits.
// Deliberately separate from /api/hotels/save, whose roomTypes path is a
// replace-set (it deletes rooms not in the payload) and would wipe the other
// rooms if sent a single room. This only ever touches the one room named, and
// only the fields explicitly sent — nothing else on the room is changed.
const ADVANCE_NOTICE = ['Same day', '1 day', '2 days', '3 days', '7 days'];
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
        // Availability: minimum and maximum nights, and how far ahead a guest
        // must book — the same rules a cottage has, per room type.
        if (body.min_nights != null) {
            const n = Math.floor(Number(body.min_nights));
            if (!Number.isInteger(n) || n < 1) return NextResponse.json({ ok: false, error: 'Minimum nights must be at least 1.' }, { status: 400 });
            patch.min_nights = n;
        }
        if ('max_nights' in body) {
            if (body.max_nights === null || body.max_nights === '') patch.max_nights = null;
            else {
                const n = Math.floor(Number(body.max_nights));
                if (!Number.isInteger(n) || n < 1) return NextResponse.json({ ok: false, error: 'Maximum nights must be a whole number of at least 1.' }, { status: 400 });
                patch.max_nights = n;
            }
        }
        if (body.advance_notice != null) {
            if (!ADVANCE_NOTICE.includes(String(body.advance_notice))) return NextResponse.json({ ok: false, error: 'That advance-notice option is not valid.' }, { status: 400 });
            patch.advance_notice = String(body.advance_notice);
        }
        // Fees that apply to a hotel room: extra guest and pet (never cleaning).
        if (body.extra_guest_fee != null) {
            const f = Number(body.extra_guest_fee);
            if (!Number.isFinite(f) || f < 0) return NextResponse.json({ ok: false, error: 'The extra-guest fee can’t be negative.' }, { status: 400 });
            patch.extra_guest_fee = f;
        }
        if (body.extra_guest_after != null) {
            const n = Math.floor(Number(body.extra_guest_after));
            if (!Number.isInteger(n) || n < 1) return NextResponse.json({ ok: false, error: 'Guests included before the fee must be at least 1.' }, { status: 400 });
            patch.extra_guest_after = n;
        }
        if (body.extra_guest_period != null) {
            if (!['night', 'stay'].includes(String(body.extra_guest_period))) return NextResponse.json({ ok: false, error: 'Choose per night or per stay.' }, { status: 400 });
            patch.extra_guest_period = String(body.extra_guest_period);
        }
        if (body.pet_fee != null) {
            const f = Number(body.pet_fee);
            if (!Number.isFinite(f) || f < 0) return NextResponse.json({ ok: false, error: 'The pet fee can’t be negative.' }, { status: 400 });
            patch.pet_fee = f;
        }
        // Length-of-stay and last-minute discounts (on/off, like a cottage).
        for (const key of ['weekly_discount', 'monthly_discount', 'last_minute_discount']) {
            if (body[key] != null) patch[key] = !!body[key];
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
