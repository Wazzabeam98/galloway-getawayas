import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { guestExperiencesOpen, exclusivePerDate } from '@/lib/serviceOrders';
import { shapeOf, generateSessions } from '@/lib/serviceSlots';
import { changeWindowState, dayKey, dayKeyFromNow, providerTakesChanges } from '@/lib/orderChange';
import { offeredTimes as providerOfferedTimes, isOfferedTime, normaliseTime } from '@/lib/offeredTimes';
import { logError } from '@/lib/logError';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';

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
        .select('id, guest_id, provider_id, booking_id, parent_order_id, status, shape, service_date, service_time, item_name')
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
// The per-DATE start times a COMES-TO-YOU provider is open, from its weekly
// opening hours — the single place hours are set, and the same generator the
// booking dialog uses — across [min,max], minus full-day blocks. A date with no
// times is not offered. Empty for made_to_order (a date only) and for a legacy
// provider that set no hours (they fall back to named offered_times instead).
async function comesToYouTimesByDate(admin: any, loaded: any, minKey: string, maxKey: string): Promise<Record<string, string[]>> {
    if (loaded.shape !== 'comes_to_you') return {};
    const [{ data: avail }, { data: blocks }] = await Promise.all([
        admin.from('slot_availability').select('day_of_week, open_time, close_time').eq('provider_id', loaded.provider.id),
        admin.from('slot_blocks').select('blocked_date').eq('provider_id', loaded.provider.id).gte('blocked_date', minKey).lte('blocked_date', maxKey),
    ]);
    if (!avail || !avail.length) return {};
    const blockDates = (blocks || []).map((b: any) => String(b.blocked_date).slice(0, 10));
    const byDate: Record<string, string[]> = {};
    for (const s of generateSessions(avail as any, blockDates, 30, minKey, maxKey, 30)) {
        (byDate[s.date] = byDate[s.date] || []).push(s.time);
    }
    return byDate;
}

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

        // A comes-to-you provider's times per date, from its opening hours. An
        // exclusive-clash date is dropped entirely so the sheet can't offer a
        // time on a day nobody else's booking already holds.
        const timesByDate = win.free ? await comesToYouTimesByDate(admin, loaded, minKey, maxKey) : {};
        for (const t of taken) delete timesByDate[t];
        // The booking's own date and time stay offerable whatever the current
        // hours say, so a guest can always keep or return to what they booked —
        // even if the provider narrowed their hours after the booking was taken.
        if (loaded.shape === 'comes_to_you' && win.free) {
            const curDate = String(loaded.order.service_date).slice(0, 10);
            const curTime = loaded.order.service_time ? String(loaded.order.service_time).slice(0, 5) : null;
            if (curTime && curDate >= minKey && curDate <= maxKey && !taken.includes(curDate)) {
                const list = timesByDate[curDate] = timesByDate[curDate] || [];
                if (!list.includes(curTime)) { list.push(curTime); list.sort(); }
            }
        }

        return NextResponse.json({
            ok: true,
            shape: loaded.shape,
            itemName: undefined,
            locked: !win.free,                 // past the window — the date is fixed
            deadlineISO: win.deadlineISO,
            current: {
                date: String(loaded.order.service_date).slice(0, 10),
                time: loaded.order.service_time ? String(loaded.order.service_time).slice(0, 5) : null,
            },
            minKey, maxKey, horizonDays,
            takenDates: taken,
            exclusive: exclusivePerDate(loaded.provider),
            // The provider's offered times, so the sheet can let the guest change
            // the time as well as the date; empty when the provider names none.
            offeredTimes: providerOfferedTimes(loaded.provider.guest_details),
            // Comes-to-you: the times each date is open (from opening hours). The
            // sheet shows the picked date's times; empty for other shapes.
            timesByDate,
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
        const newTimeRaw: string = normaliseTime(body && body.time) || '';

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

        // The time. A COMES-TO-YOU provider's times come from its weekly OPENING
        // HOURS — the picked time must fall inside an open window for the new
        // date's weekday, and the day must not be blocked (the same rule the
        // booking route enforces). Every other shape keeps the offered-times rule:
        // required and validated when any are named, otherwise none is carried.
        const offered = providerOfferedTimes(loaded.provider.guest_details);
        const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
        let newTime: string | null = null;
        if (loaded.shape === 'comes_to_you') {
            const { data: availRows } = await admin
                .from('slot_availability').select('day_of_week, open_time, close_time').eq('provider_id', loaded.provider.id);
            const hours = availRows || [];
            if (hours.length) {
                if (!newTimeRaw) return NextResponse.json({ ok: false, error: 'Pick a time.' }, { status: 400 });
                const { data: blk } = await admin
                    .from('slot_blocks').select('blocked_date').eq('provider_id', loaded.provider.id).eq('blocked_date', newDate);
                if (blk && blk.length) return NextResponse.json({ ok: false, error: 'They’re not available that day — try another date.' }, { status: 409 });
                const dow = new Date(newDate + 'T00:00:00Z').getUTCDay();
                const tMin = toMin(newTimeRaw);
                const open = hours.some((w: any) => Number(w.day_of_week) === dow && tMin >= toMin(w.open_time) && tMin < toMin(w.close_time));
                if (!open) return NextResponse.json({ ok: false, error: 'They’re not open then — pick another time.' }, { status: 400 });
                newTime = newTimeRaw;
            } else if (offered.length) {
                if (!newTimeRaw || !isOfferedTime(loaded.provider.guest_details, newTimeRaw)) {
                    return NextResponse.json({ ok: false, error: 'Pick a time.' }, { status: 400 });
                }
                newTime = newTimeRaw;
            } else if (newTimeRaw) {
                newTime = newTimeRaw;
            }
        } else if (offered.length) {
            if (!newTimeRaw || !isOfferedTime(loaded.provider.guest_details, newTimeRaw)) {
                return NextResponse.json({ ok: false, error: 'Pick a time.' }, { status: 400 });
            }
            newTime = newTimeRaw;
        } else if (newTimeRaw) {
            newTime = newTimeRaw;
        }

        const curDate = String(loaded.order.service_date).slice(0, 10);
        const curTime = loaded.order.service_time ? String(loaded.order.service_time).slice(0, 5) : null;
        const dateChanged = newDate !== curDate;
        const timeChanged = (newTime || '') !== (curTime || '');
        if (!dateChanged && !timeChanged) {
            return NextResponse.json({ ok: false, error: 'That’s already your date and time.' }, { status: 400 });
        }

        // A date change must land in the open window and clear the exclusive clash;
        // a time-only change keeps the date, so those checks don't apply.
        if (dateChanged) {
            const { minKey, maxKey } = dateBounds(loaded, now);
            if (newDate < minKey || newDate > maxKey) {
                return NextResponse.json({ ok: false, error: 'That date isn’t open — pick one in the range shown.' }, { status: 400 });
            }
            if (exclusivePerDate(loaded.provider)) {
                const { data: clash } = await admin
                    .from('service_orders').select('id')
                    .eq('provider_id', loaded.provider.id).eq('service_date', newDate)
                    .in('status', ['authorised', 'confirmed']).neq('id', loaded.order.id).limit(1);
                if (clash && clash.length) {
                    return NextResponse.json({ ok: false, error: 'Someone’s already booked them for that date — try another.' }, { status: 409 });
                }
            }
        }

        // A REQUEST, not an instant move. A date/time change moves no money, so it
        // can't ride a hold — instead the requested date (and time) are parked on
        // the still-confirmed order and the provider accepts (service_date/time :=
        // pending) or declines within 48 hours (the service-orders cron clears an
        // unanswered one). Only one pending request at a time.
        const expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
        const { data: saved, error: saveErr } = await admin
            .from('service_orders')
            .update({ pending_service_date: newDate, pending_service_time: newTime, pending_change_expires_at: expiresAt })
            .eq('id', loaded.order.id).eq('status', 'confirmed')
            .select('id');
        if (saveErr) return NextResponse.json({ ok: false, error: 'Could not request the change. Try again.' }, { status: 500 });
        if (!saved || !saved.length) return NextResponse.json({ ok: false, error: 'That booking changed — reload and try again.' }, { status: 409 });

        // Tell the provider there's a date change to answer.
        try {
            const { data: prov } = await admin.from('service_providers').select('business_name, contact_email').eq('id', loaded.provider.id).maybeSingle();
            if (prov && prov.contact_email) {
                await sendEmail(prov.contact_email, 'A guest wants to change a booking', emailLayout(
                    '<p>A guest has asked to move their ' + escapeHtml(loaded.order.item_name || 'booking') + ' to <strong>' + escapeHtml(newDate)
                    + (newTime ? ' at ' + escapeHtml(newTime) : '')
                    + '</strong>. Nothing is charged either way — accept within 48 hours, or decline to keep the original.</p>'
                    + button(SITE_URL + '/services/dashboard', 'Answer the request'),
                    'You’re receiving this because you offer experiences on Galloway Getaways.'));
            }
        } catch (e) { console.error('[change-date] notify', e); }

        return NextResponse.json({ ok: true, requested: true, date: newDate, time: newTime });
    } catch (err: any) {
        await logError('services-order-change-date-POST', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Could not change the date.' }, { status: 500 });
    }
}
