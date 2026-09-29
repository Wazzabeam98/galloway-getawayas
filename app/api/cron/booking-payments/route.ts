import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { paidSessionsSince } from '@/lib/bookingPaymentReconcile';
import { settlePaidBookingSession, bookingIdOf } from '@/lib/settlePaidBooking';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// A CHARGED GUEST MUST NOT BE LEFT AT pending_payment.
//
// Every ten minutes: find the cottage bookings still waiting on a payment,
// ask Stripe whether any of them has in fact been paid, and settle those
// through lib/settlePaidBooking — the same function the webhook calls, so a
// recovered booking gets the same status, ledger row and emails a delivered
// one would have, and a webhook arriving late (or at the same moment) cannot
// confirm it a second time.
//
// Looks back three days. A Checkout Session lives 24 hours, so anything older
// that is still pending_payment was never paid; the extra margin covers a
// cron outage.
//
// Each recovery is also logged to /admin/errors. It is not a failure of this
// job — it is evidence that the webhook is not landing, which is the thing to
// go and fix.
//
// Guarded by CRON_SECRET, header only, fail-closed, like every other cron.
const LOOKBACK_DAYS = 3;

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000).toISOString();

    const { data: waiting, error: waitingError } = await admin
        .from('bookings')
        .select('id, created_at')
        .eq('status', 'pending_payment')
        .gte('created_at', since)
        .order('created_at', { ascending: true });

    if (waitingError) {
        await logError('[cron/booking-payments] could not read the bookings waiting on payment', waitingError, {
            path: 'cron/booking-payments',
        });
        return NextResponse.json({ ok: false }, { status: 500 });
    }

    // Nothing waiting, nothing to ask Stripe.
    if (!waiting || !waiting.length) {
        return NextResponse.json({ ok: true, waiting: 0, recovered: 0 });
    }

    const waitingIds = new Set<string>(waiting.map((b: any) => b.id));

    let sessions: any[];
    try {
        sessions = await paidSessionsSince(waiting[0].created_at);
    } catch (err) {
        await logError('[cron/booking-payments] could not list paid sessions from Stripe', err, {
            path: 'cron/booking-payments',
        });
        return NextResponse.json({ ok: false }, { status: 500 });
    }

    const recovered: string[] = [];
    const failed: string[] = [];
    const seen = new Set<string>();

    for (const cs of sessions) {
        const bookingId = bookingIdOf(cs);
        if (!bookingId || !waitingIds.has(bookingId) || seen.has(bookingId)) continue;
        seen.add(bookingId);

        try {
            const result = await settlePaidBookingSession(admin, cs, null);
            // `already` means the webhook (or the success page) got there
            // between our read and this call — not a recovery, not news.
            if (result.already) continue;

            recovered.push(bookingId);
            await logError(
                '[cron/booking-payments] recovered a paid booking the webhook never settled — '
                    + 'check the Stripe webhook endpoint and signing secret',
                { booking_id: bookingId, session: cs.id, payment_intent: cs.payment_intent || null, result },
                { path: 'cron/booking-payments' }
            );
        } catch (err) {
            failed.push(bookingId);
            await logError('[cron/booking-payments] a paid booking could not be settled — it will be retried', err, {
                path: 'cron/booking-payments',
            });
        }
    }

    return NextResponse.json({ ok: true, waiting: waiting.length, recovered: recovered.length, failed: failed.length });
}
