import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { guestExperiencesOpen, normaliseUnit, unitMultiplies, isLiveToGuests } from '@/lib/serviceOrders';
import { isSlot, shapeOf } from '@/lib/serviceSlots';
import { moveOrderFamily, moveTargetEligibility } from '@/lib/experienceMove';
import { fetchSlotSessionRows } from '@/lib/providerSessions';
import { londonDayKey } from '@/lib/dayKey';

export const dynamic = 'force-dynamic';

// MOVE a confirmed slot booking (and its whole family) to another session.
//
// GET  — the picker feed: the family's size, its current session, and every
//        future session of the same provider annotated with whether this order
//        can legitimately move to it (right mode, room for the WHOLE family, not
//        past that session's own cutoff) and, when it can't, why. The eligibility
//        rule is lib/experienceMove.moveTargetEligibility — the same rule the RPC
//        enforces under lock, so the picker never offers a time the move refuses.
// POST — perform the move. Payer-only. The atomic all-or-nothing swap is the
//        RPC's job (move_order_family_to_session); this route authorises,
//        resolves the named target session (v1: it must already exist), and hands
//        both to the RPC via lib/experienceMove.
//
// v1 SCOPE: the target must be a session that already exists (a declared class,
// or an open hour something is already booked on). Moving onto a brand-new open
// hour with no row yet, and the price delta on a dearer/cheaper session, are the
// layer above this engine and are not built here.

const HORIZON_DAYS = 120;

interface Loaded {
    order: any;
    provider: any;
    current: any;        // the slot_sessions row the family sits on
    windowHours: number;
    familySeats: number;
    familyPrivate: boolean;
}
type LoadError = { error: { status: number; message: string } };

// Everything the picker (GET) and the move (POST) both need, with every shared
// guard applied: the caller owns it, it is a confirmed slot PARENT, the provider
// is live, and the current session is readable. Also totals the family's seats
// (parent + confirmed top-up children) — what must fit on any target.
async function loadForMove(admin: any, orderId: string, userId: string): Promise<Loaded | LoadError> {
    if (!orderId) return { error: { status: 400, message: 'Missing order' } };

    const { data: order } = await admin
        .from('service_orders')
        .select('id, guest_id, provider_id, status, shape, item_unit, item_name, slot_session_id, parent_order_id, service_date, service_time, quantity')
        .eq('id', orderId).maybeSingle();
    if (!order) return { error: { status: 404, message: 'No such booking' } };
    // Payer-only. A companion is never the guest_id, so this is the wall.
    if (order.guest_id !== userId) return { error: { status: 403, message: 'Not your booking' } };
    if (order.parent_order_id) return { error: { status: 400, message: 'Move the original booking, not an added place.' } };
    if (order.status !== 'confirmed') return { error: { status: 409, message: 'This booking isn’t confirmed yet, so there’s nothing to move.' } };
    if (shapeOf(order) !== 'slot' || !order.slot_session_id) {
        return { error: { status: 400, message: 'This booking has no session to move.' } };
    }
    // Touch the unit helpers so a private hire and a per-person seat are both
    // movable — the RPC handles the mode either way.
    void unitMultiplies(normaliseUnit(order.item_unit));

    const { data: provider } = await admin
        .from('service_providers')
        .select('id, business_name, shape, status, plan, stripe_payouts_enabled, owner_paused, cancellation_window_hours')
        .eq('id', order.provider_id).maybeSingle();
    if (!provider || !isSlot(provider) || !isLiveToGuests(provider)) {
        return { error: { status: 400, message: 'That experience isn’t taking bookings right now.' } };
    }

    const { data: current } = await admin
        .from('slot_sessions')
        .select('id, session_date, session_time, capacity, seats_taken, private, declared, blocked, duration_minutes')
        .eq('id', order.slot_session_id).maybeSingle();
    if (!current) return { error: { status: 409, message: 'That session is no longer available.' } };

    // The family's seats = the parent's quantity plus every confirmed top-up's.
    const { data: children } = await admin
        .from('service_orders').select('quantity')
        .eq('parent_order_id', order.id).eq('status', 'confirmed');
    const familySeats = (Number(order.quantity) || 1)
        + (children || []).reduce((sum: number, c: any) => sum + (Number(c.quantity) || 1), 0);

    return {
        order, provider, current,
        windowHours: Number(provider.cancellation_window_hours) || 48,
        familySeats,
        familyPrivate: !!current.private,
    };
}

// GET — the picker feed.
export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!guestExperiencesOpen()) return NextResponse.json({ ok: false, error: 'Guest experiences aren’t open yet.' }, { status: 403 });

        const orderId = new URL(request.url).searchParams.get('orderId') || '';
        const admin = adminClient();
        const loaded = await loadForMove(admin, orderId, user.id);
        if ('error' in loaded) return NextResponse.json({ ok: false, error: loaded.error.message }, { status: loaded.error.status });

        const { order, provider, current, windowHours, familySeats, familyPrivate } = loaded;

        // The provider's real sessions (declared classes, and sessions already
        // booked on) within a sensible horizon — the set v1 can move to. Bounded
        // both ends: from today (you can't move into the past) to today + horizon,
        // so this is never an unbounded firehose of every future session. Earlier
        // dates than the booking's own are included — allowed, and the calendar
        // opens on the current date so later dates are the obvious path.
        const today = londonDayKey(new Date());
        const horizon = londonDayKey(new Date(Date.now() + HORIZON_DAYS * 86400000));
        // The SAME slot_sessions read the host diary uses (lib/providerSessions),
        // so the two views cannot disagree about which sessions exist.
        const rows = await fetchSlotSessionRows(admin, provider.id, today, horizon);

        const now = new Date();
        const sessions = (rows || [])
            // A block is not a bookable session; never show it as an option.
            .filter((s: any) => !s.blocked)
            .map((s: any) => {
                const elig = moveTargetEligibility(
                    { seats: familySeats, private: familyPrivate },
                    s, windowHours, now, current.id
                );
                return {
                    date: String(s.session_date).slice(0, 10),
                    time: String(s.session_time).slice(0, 5),
                    capacity: s.capacity,
                    seatsLeft: Math.max(0, s.capacity - s.seats_taken),
                    private: !!s.private,
                    available: elig.available,
                    reason: elig.reason || null,
                };
            });

        return NextResponse.json({
            ok: true,
            business: provider.business_name || null,
            itemName: order.item_name || null,
            familySeats,
            familyPrivate,
            current: {
                date: String(current.session_date).slice(0, 10),
                time: String(current.session_time).slice(0, 5),
            },
            horizonDays: HORIZON_DAYS,
            sessions,
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: 'Could not load times to move to.' }, { status: 500 });
    }
}

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
        const loaded = await loadForMove(admin, orderId, user.id);
        if ('error' in loaded) return NextResponse.json({ ok: false, error: loaded.error.message }, { status: loaded.error.status });

        // Resolve the named target session row. v1: it must already exist.
        const { data: target } = await admin
            .from('slot_sessions')
            .select('id')
            .eq('provider_id', loaded.provider.id)
            .eq('session_date', sessionDate)
            .eq('session_time', sessionTime.length === 5 ? sessionTime + ':00' : sessionTime)
            .maybeSingle();
        if (!target) {
            return NextResponse.json({ ok: false, error: 'That time isn’t open for this experience — pick an available session.' }, { status: 409 });
        }

        const result = await moveOrderFamily(admin, { orderId, targetSessionId: target.id, windowHours: loaded.windowHours });

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
