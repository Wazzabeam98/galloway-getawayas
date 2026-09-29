// FINDING A COTTAGE PAYMENT THE WEBHOOK NEVER DELIVERED.
//
// A guest pays at Stripe and the booking only moves off 'pending_payment'
// when checkout.session.completed reaches /api/stripe/webhook. If that event
// is lost — Stripe gives up, the endpoint is down, the signing secret was
// rotated and the signature check refuses it — the guest has been charged and
// the booking sits unpaid, hidden from the host, with nobody told.
//
// These helpers ask Stripe directly and hand any paid payment to
// settlePaidBookingSession, the same function the webhook calls, so a
// recovered booking is settled exactly as a delivered one would have been and
// never twice (see the compare-and-set in lib/settlePaidBooking).
//
// LISTED, NOT SEARCHED — the same reasoning as the experience sweeps in
// app/api/cron/service-orders: Stripe's List API is read-after-write
// consistent, the Search API can lag a paid session by a minute.

import { stripeRequest } from '@/lib/stripe';
import { settlePaidBookingSession, bookingIdOf, SettleResult } from '@/lib/settlePaidBooking';

// The only session kinds that take a booking off pending_payment. A balance
// paid by hand never finds the booking at pending_payment, so it has no place
// here.
const OPENING_KINDS = ['deposit', 'full'];

export function isOpeningPayment(cs: any): boolean {
    const kind = (cs && cs.metadata && cs.metadata.kind) || 'full';
    return !!cs
        && cs.status === 'complete'
        && cs.payment_status === 'paid'
        && OPENING_KINDS.indexOf(kind) !== -1
        && !!bookingIdOf(cs);
}

// The Checkout Session a succeeded PaymentIntent was paid through, in the
// shape settlePaidBookingSession reads. The checkout route copies booking_id
// and kind onto the intent (payment_intent_data.metadata), so the intent alone
// says which booking and which kind of payment it was; the amount is what
// Stripe actually received.
export function sessionFromIntent(pi: any): any {
    return {
        id: null,
        object: 'checkout.session',
        status: 'complete',
        payment_status: pi && pi.status === 'succeeded' ? 'paid' : 'unpaid',
        amount_total: Number((pi && (pi.amount_received || pi.amount)) || 0),
        payment_intent: pi && pi.id,
        customer: (pi && pi.customer) || null,
        client_reference_id: (pi && pi.metadata && pi.metadata.booking_id) || null,
        metadata: {
            booking_id: (pi && pi.metadata && pi.metadata.booking_id) || null,
            // No default here, unlike a session. Other payments carry a
            // booking_id too (balances, change and resolution payments), and
            // an intent that does not SAY it opened a booking must not be
            // read as one.
            kind: (pi && pi.metadata && pi.metadata.kind) || 'unknown',
        },
    };
}

/**
 * Every cottage deposit or full payment that succeeded at Stripe since
 * `sinceIso`, as session-shaped objects. Read from the PaymentIntents rather
 * than the Checkout Sessions because the intent is the money itself, and it is
 * what the other reconcile sweeps read. Bounded to ten pages (1,000 intents),
 * far beyond this site's volume.
 */
export async function paidSessionsSince(sinceIso: string): Promise<any[]> {
    // Five minutes of slack for clock skew between us and Stripe.
    const createdGte = Math.floor(new Date(sinceIso).getTime() / 1000) - 300;
    const found: any[] = [];
    let startingAfter: string | null = null;

    for (let page = 0; page < 10; page++) {
        const query: Record<string, any> = { created: { gte: createdGte }, limit: 100 };
        if (startingAfter) query.starting_after = startingAfter;
        const list = await stripeRequest('GET', '/payment_intents', query);
        const data = (list && list.data) || [];
        for (const pi of data) {
            if (pi.status !== 'succeeded') continue;
            const cs = sessionFromIntent(pi);
            if (isOpeningPayment(cs)) found.push(cs);
        }
        if (!list || !list.has_more || !data.length) break;
        startingAfter = data[data.length - 1].id;
    }

    return found;
}

/**
 * The success page's question: has this one booking been paid for at Stripe,
 * and if so, settle it now rather than tell the guest to keep refreshing.
 *
 * `sessionId` comes back on the success URL ({CHECKOUT_SESSION_ID}) and is
 * the fast path — one GET. It is a hint from the browser, so it is only
 * believed if Stripe says the session is paid AND it names this booking.
 * Without it (an older link, a stripped query string) the recent paid
 * sessions are listed instead.
 */
export async function recoverBookingPayment(
    admin: any,
    booking: { id: string; created_at?: string | null },
    sessionId?: string | null
): Promise<SettleResult | null> {
    let session: any = null;

    if (sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
        try {
            const cs = await stripeRequest('GET', '/checkout/sessions/' + sessionId);
            if (isOpeningPayment(cs) && bookingIdOf(cs) === booking.id) session = cs;
        } catch {
            // A bad or foreign id is simply not the answer; fall through to the list.
        }
    }

    if (!session) {
        const since = booking.created_at || new Date(Date.now() - 2 * 86400 * 1000).toISOString();
        const sessions = await paidSessionsSince(since);
        session = sessions.find((cs) => bookingIdOf(cs) === booking.id) || null;
    }

    if (!session) return null;
    return settlePaidBookingSession(admin, session, null);
}
