import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { guestExperiencesOpen, normaliseUnit, unitMultiplies, isLiveToGuests } from '@/lib/serviceOrders';
import { isSlot, shapeOf } from '@/lib/serviceSlots';
import { moveOrderFamily } from '@/lib/experienceMove';

export const dynamic = 'force-dynamic';

// MOVE a confirmed slot booking (and its whole family) to another session.
//
// This is the guest-facing "change my time" action. It is payer-only, and it
// only ever names a target session that ALREADY exists for the same provider —
// the atomic swap, capacity re-check, cutoff and all-or-nothing family move are
// the RPC's job (move_order_family_to_session). This route authorises, resolves
// the target session row, and hands both to the RPC via lib/experienceMove.
//
// v1 SCOPE: the target must be a session that already exists (a declared class,
// or an open hour something is already booked on). Moving onto a brand-new open
// hour with no row yet, the price delta on a dearer/cheaper session, and the
// guest date picker are the layer above this engine and are not built here.

// Map the RPC's terse error codes to a guest-readable line + HTTP status.
function present(error: string): { status: number; message: string } {
    switch (error) {
        case 'no-order':        return { status: 404, message: 'No such booking' };
        case 'not-parent':      return { status: 400, message: 'Move the original booking, not an added place.' };
        case 'not-confirmed':   return { status: 409, message: 'This booking isn’t confirmed yet, so there’s nothing to move.' };
        case 'not-a-slot':      return { status: 400, message: 'This booking has no session to move.' };
        case 'no-target':
        case 'target-blocked':
        case 'target-not-ready':return { status: 409, message: 'That time isn’t available. Pick another.' };
        case 'same-session':    return { status: 400, message: 'That’s the time you’re already booked on.' };
        case 'other-provider':  return { status: 400, message: 'That time belongs to a different experience.' };
        case 'past-cutoff':     return { status: 409, message: 'That time is too close now to move into.' };
        case 'no-room':         return { status: 409, message: 'That time doesn’t have room for your whole party.' };
        case 'mode-clash':      return { status: 409, message: 'That time can’t take this booking — pick another.' };
        case 'family-drift':    return { status: 409, message: 'We couldn’t move this booking cleanly. Please contact us.' };
        default:                return { status: 409, message: 'That time just filled up. Pick another.' };
    }
}

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!guestExperiencesOpen()) return NextResponse.json({ ok: false, error: 'Guest experiences aren’t open yet.' }, { status: 403 });

        const body = await request.json().catch(() => ({}));
        const orderId: string = body && body.orderId;
        const sessionDate: string = body && body.sessionDate;   // "YYYY-MM-DD"
        const sessionTime: string = body && body.sessionTime;   // "HH:MM"
        if (!orderId || !sessionDate || !sessionTime) {
            return NextResponse.json({ ok: false, error: 'Missing order or target time' }, { status: 400 });
        }

        const admin = adminClient();

        // Load the order and apply the payer wall before touching anything.
        const { data: order } = await admin
            .from('service_orders')
            .select('id, guest_id, provider_id, status, shape, item_unit, slot_session_id, parent_order_id, service_date, service_time')
            .eq('id', orderId).maybeSingle();
        if (!order) return NextResponse.json({ ok: false, error: 'No such booking' }, { status: 404 });
        // Payer-only. A companion is never the guest_id, so this is the wall.
        if (order.guest_id !== user.id) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        if (order.parent_order_id) return NextResponse.json({ ok: false, error: 'Move the original booking, not an added place.' }, { status: 400 });
        if (order.status !== 'confirmed') return NextResponse.json({ ok: false, error: 'This booking isn’t confirmed yet, so there’s nothing to move.' }, { status: 409 });
        if (shapeOf(order) !== 'slot' || !order.slot_session_id) {
            return NextResponse.json({ ok: false, error: 'This booking has no session to move.' }, { status: 400 });
        }
        // Touch normaliseUnit/unitMultiplies so a private hire and a per-person
        // seat are both movable — the RPC handles the mode either way.
        void unitMultiplies(normaliseUnit(order.item_unit));

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, shape, status, plan, stripe_payouts_enabled, owner_paused, cancellation_window_hours')
            .eq('id', order.provider_id).maybeSingle();
        if (!provider || !isSlot(provider) || !isLiveToGuests(provider)) {
            return NextResponse.json({ ok: false, error: 'That experience isn’t taking bookings right now.' }, { status: 400 });
        }

        // Resolve the target session row. v1: it must already exist.
        const { data: target } = await admin
            .from('slot_sessions')
            .select('id')
            .eq('provider_id', order.provider_id)
            .eq('session_date', sessionDate)
            .eq('session_time', sessionTime.length === 5 ? sessionTime + ':00' : sessionTime)
            .maybeSingle();
        if (!target) {
            return NextResponse.json({ ok: false, error: 'That time isn’t open for this experience — pick an available session.' }, { status: 409 });
        }

        const windowHours = Number(provider.cancellation_window_hours) || 48;
        const result = await moveOrderFamily(admin, { orderId, targetSessionId: target.id, windowHours });

        if (!result.ok) {
            const p = present(result.error || 'unavailable');
            return NextResponse.json({ ok: false, error: p.message }, { status: p.status });
        }

        return NextResponse.json({
            ok: true,
            moved: result.moved,
            seats: result.seats,
            serviceDate: result.toDate,
            serviceTime: result.toTime,
            from: { date: result.fromDate, time: result.fromTime },
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: 'Something went wrong moving your booking.' }, { status: 500 });
    }
}
