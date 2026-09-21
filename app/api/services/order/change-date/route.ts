import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { guestExperiencesOpen, exclusivePerDate } from '@/lib/serviceOrders';
import { shapeOf } from '@/lib/serviceSlots';
import { changeWindowState, dayKey, dayKeyFromNow, providerTakesChanges } from '@/lib/orderChange';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// CHANGE DATE — for the two REQUEST shapes only (made_to_order, comes_to_you). A
// slot has a session to move between and uses /api/services/slots/move; this
// route refuses it. There is no time for these shapes, only a delivery/
// collection or service DATE, and moving it costs nothing — the money is fixed.
//
// The cancellation policy gates it: inside the free-cancellation window the date
// can move; past it, it is fixed (409 on POST, `locked` on GET so the sheet says
// so). Every offered date is one the booking flow would accept: a made-to-order
// date honours the provider's lead time and horizon; a comes-to-you date is one
// nobody else has that provider for (the exclusive-per-date rule), and — when
// the order sits on a cottage stay — inside the stay.

const HORIZON_FALLBACK = 90;

type LoadErr = { error: { status: number; message: string } };
interface LoadedDate { order: any; provider: any; stay: { check_in: string; check_out: string } | null; windowHours: number; shape: string }

async function loadForDate(admin: any, orderId: string, userId: string): Promise<LoadedDate | LoadErr> {
    if (!orderId) return { error: { status: 400, message: 'Missing order' } };
    const { data: order } = await admin
        .from('service_orders')
        .select('id, guest_id, provider_id, booking_id, parent_order_id, status, shape, service_date, service_time')
        .eq('id', orderId).maybeSingle();
    if (!order) return { error: { status: 404, message: 'No such booking' } };
    if (order.guest_id !== userId) return { error: { status: 403, message: 'Not your booking' } };
    if (order.parent_order_id) return { error: { status: 400, message: 'Change the original booking, not an added part.' } };
    if (order.status !== 'confirmed') return { error: { status: 409, message: 'This booking isn’t confirmed yet.' } };
    const shape = shapeOf(order);
    if (shape === 'slot') return { error: { status: 400, message: 'Use the session picker to move a slot booking.' } };

    const { data: provider } = await admin
        .from('service_providers')
        .select('id, business_name, shape, status, plan, stripe_account_id, stripe_payouts_enabled, cancellation_window_hours, lead_time_days, guest_details, exclusive_per_date')
        .eq('id', order.provider_id).maybeSingle();
    if (!providerTakesChanges(provider)) return { error: { status: 400, message: 'That experience isn’t taking changes right now.' } };

    let stay: { check_in: string; check_out: string } | null = null;
    if (order.booking_id) {
        const { data: b } = await admin.from('bookings').select('check_in, check_out').eq('id', order.booking_id).maybeSingle();
        if (b) stay = { check_in: String(b.check_in).slice(0, 10), check_out: String(b.check_out).slice(0, 10) };
    }
    const windowHours = Number(provider.cancellation_window_hours) || 48;
    return { order, provider, stay, windowHours, shape };
}

// The window a new date may fall in, as day keys [minKey, maxKey], plus the dates
// already taken (comes-to-you only) that must be greyed. String day keys compare
// chronologically, so all bounds checks are plain string compares.
function dateBounds(loaded: any, now: Date): { minKey: string; maxKey: string; horizonDays: number } {
    const { provider, stay, shape } = loaded;
    const horizonDays = Math.max(1, Math.min(365, Number(provider.guest_details && provider.guest_details.booking_horizon_days) || HORIZON_FALLBACK));
    // made_to_order honours a lead time (a cake needs notice); comes_to_you can be
    // as soon as tomorrow. Never earlier than tomorrow either way.
    const leadDays = shape === 'made_to_order' ? Math.max(1, Number(provider.lead_time_days) || 1) : 1;
    let minKey = dayKeyFromNow(leadDays, now);
    let maxKey = dayKeyFromNow(horizonDays, now);
    // A booking on a cottage stay stays on that stay: the last night is the day
    // before check-out.
    if (stay) {
        const lastNight = dayKey(new Date(new Date(stay.check_out + 'T00:00:00Z').getTime() - 86400000));
        if (stay.check_in > minKey) minKey = stay.check_in;
        if (lastNight < maxKey) maxKey = lastNight;
    }
    return { minKey, maxKey, horizonDays };
}

// The dates in [min,max] this provider is already committed elsewhere — the
// exclusive-per-date clash, minus this order's own date. Empty for made_to_order
// (a baker bakes many things for one day).
async function takenDates(admin: any, loaded: any, minKey: string, maxKey: string): Promise<string[]> {
    if (!exclusivePerDate(loaded.provider)) return [];
    const { data: rows } = await admin
        .from('service_orders')
        .select('id, service_date')
        .eq('provider_id', loaded.provider.id)
        .in('status', ['authorised', 'confirmed'])
        .gte('service_date', minKey).lte('service_date', maxKey);
    const taken = new Set<string>();
    for (const r of rows || []) {
        if (r.id === loaded.order.id) continue;               // our own date is free to keep
        taken.add(String(r.service_date).slice(0, 10));
    }
    return Array.from(taken).sort();
}

export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!guestExperiencesOpen()) return NextResponse.json({ ok: false, error: 'Guest experiences aren’t open yet.' }, { status: 403 });

        const orderId = new URL(request.url).searchParams.get('orderId') || '';
        const admin = adminClient();
        const loaded = await loadForDate(admin, orderId, user.id);
        if ('error' in loaded) return NextResponse.json({ ok: false, error: loaded.error.message }, { status: loaded.error.status });

        const now = new Date();
        const win = changeWindowState(loaded.order, loaded.windowHours, now);
        const { minKey, maxKey, horizonDays } = dateBounds(loaded, now);
        const taken = win.free ? await takenDates(admin, loaded, minKey, maxKey) : [];

        return NextResponse.json({
            ok: true,
            shape: loaded.shape,
            itemName: undefined,
            locked: !win.free,                 // past the window — the date is fixed
            deadlineISO: win.deadlineISO,
            current: { date: String(loaded.order.service_date).slice(0, 10) },
            minKey, maxKey, horizonDays,
            takenDates: taken,
            exclusive: exclusivePerDate(loaded.provider),
        });
    } catch (err: any) {
        await logError('services-order-change-date-GET', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Could not load that.' }, { status: 500 });
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
        const newDate: string = String((body && body.date) || '').slice(0, 10);

        const admin = adminClient();
        const loaded = await loadForDate(admin, orderId, user.id);
        if ('error' in loaded) return NextResponse.json({ ok: false, error: loaded.error.message }, { status: loaded.error.status });

        const now = new Date();
        const win = changeWindowState(loaded.order, loaded.windowHours, now);
        // PAST THE WINDOW — the date is fixed. This is the same cutoff the refund
        // uses, so a guest who could no longer cancel for free cannot move the date
        // either.
        if (!win.free) {
            return NextResponse.json({ ok: false, error: 'The free-cancellation window has passed, so the date can’t be changed now.' }, { status: 409 });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return NextResponse.json({ ok: false, error: 'Pick a date.' }, { status: 400 });
        if (newDate === String(loaded.order.service_date).slice(0, 10)) {
            return NextResponse.json({ ok: false, error: 'That’s already your date.' }, { status: 400 });
        }
        const { minKey, maxKey } = dateBounds(loaded, now);
        if (newDate < minKey || newDate > maxKey) {
            return NextResponse.json({ ok: false, error: 'That date isn’t open — pick one in the range shown.' }, { status: 400 });
        }
        // Re-check the exclusive clash under the write (the partial unique index is
        // the hard backstop; this is the friendly message).
        if (exclusivePerDate(loaded.provider)) {
            const { data: clash } = await admin
                .from('service_orders').select('id')
                .eq('provider_id', loaded.provider.id).eq('service_date', newDate)
                .in('status', ['authorised', 'confirmed']).neq('id', loaded.order.id).limit(1);
            if (clash && clash.length) {
                return NextResponse.json({ ok: false, error: 'Someone’s already booked them for that date — try another.' }, { status: 409 });
            }
        }

        // No money moves — just the date. Guarded on the row still being confirmed
        // and on the current date, so a racing change can't be clobbered.
        const { data: moved, error: moveErr } = await admin
            .from('service_orders')
            .update({ service_date: newDate })
            .eq('id', loaded.order.id).eq('status', 'confirmed').eq('service_date', loaded.order.service_date)
            .select('id');
        if (moveErr) {
            // A 23505 from the exclusive partial unique index — someone took the date first.
            if (String(moveErr.code) === '23505') {
                return NextResponse.json({ ok: false, error: 'Someone’s already booked them for that date — try another.' }, { status: 409 });
            }
            return NextResponse.json({ ok: false, error: 'Could not change the date. Try again.' }, { status: 500 });
        }
        if (!moved || !moved.length) return NextResponse.json({ ok: false, error: 'That booking changed — reload and try again.' }, { status: 409 });

        return NextResponse.json({ ok: true, date: newDate });
    } catch (err: any) {
        await logError('services-order-change-date-POST', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Could not change the date.' }, { status: 500 });
    }
}
