import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import {
    isLiveToGuests, priceOrder, guestExperiencesOpen,
    normaliseUnit, unitMultiplies, orderQuantity, orderTotal, MAX_ORDER_QUANTITY, expiryFrom,
} from '@/lib/serviceOrders';
import {
    isSlot, sessionCapacity, generateSessions, SLOT_HOLD_MINUTES,
} from '@/lib/serviceSlots';
import { dateFromKey, dateKey } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

// A guest booking a slot — the instant shape. Unlike the request shapes, there is
// no provider to confirm: the seat is claimed here, the card is charged on the
// Checkout that follows, and the booking is live the moment it is paid.
//
// THE SEAT IS CLAIMED BEFORE THE CARD, AND HELD FOR 15 MINUTES. Two guests can
// reach the last 2pm at once, so the claim has to be atomic — it is a
// compare-and-swap on seats_taken (update ... where seats_taken = the value we
// read), which the database serialises. Win the swap and a 'holding' order is
// created with a 15-minute expiry; the webhook turns it into a confirmed booking
// on payment, and the sweep releases the seat if the guest never pays. Nobody is
// ever charged for a seat they could not have.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        if (!guestExperiencesOpen()) {
            return NextResponse.json({ ok: false, error: 'Guest experiences aren’t open yet.' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const providerId: string = body && body.providerId;
        const bookingId: string = body && body.bookingId;
        const sessionDate: string = body && body.sessionDate;
        const sessionTime: string = body && body.sessionTime;      // "HH:MM"
        const requestedQuantity: unknown = body && body.quantity;
        const note: string = (body && body.note ? String(body.note) : '').slice(0, 500);

        if (!providerId || !bookingId || !sessionDate || !sessionTime) {
            return NextResponse.json({ ok: false, error: 'Missing details' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: booking } = await admin
            .from('bookings')
            .select('id, guest_id, listing_id, check_in, check_out, guests')
            .eq('id', bookingId)
            .maybeSingle();
        if (!booking) return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        if (booking.guest_id !== user.id) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, business_name, trade, shape, status, stripe_account_id, stripe_payouts_enabled, plan, commission_rate, slot_length_minutes, slot_capacity, cancellation_window_hours')
            .eq('id', providerId)
            .maybeSingle();

        if (!provider || !isSlot(provider) || !isLiveToGuests(provider) || !provider.stripe_account_id) {
            return NextResponse.json({ ok: false, error: 'That isn’t available.' }, { status: 400 });
        }

        // The single item carries the price, the unit and the name. A slot
        // provider has a list of one (its session type).
        const { data: item } = await admin
            .from('service_provider_items')
            .select('id, name, description, price, unit, active')
            .eq('provider_id', provider.id)
            .eq('active', true)
            .gt('price', 0)
            .order('sort_order', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (!item) return NextResponse.json({ ok: false, error: 'That isn’t available.' }, { status: 400 });

        const unit = normaliseUnit(item.unit);

        // The date must fall inside the stay, and the (date, time) must be a real
        // session the template offers and the provider has not blocked. Never
        // trust the pair from the browser.
        const start = dateFromKey(booking.check_in);
        const end = dateFromKey(booking.check_out);
        const when = dateFromKey(sessionDate);
        if (when < start || when >= end) {
            return NextResponse.json({ ok: false, error: 'Pick a time during your stay.' }, { status: 400 });
        }

        const [{ data: avail }, { data: blocks }] = await Promise.all([
            admin.from('slot_availability').select('day_of_week, open_time, close_time').eq('provider_id', provider.id),
            admin.from('slot_blocks').select('blocked_date').eq('provider_id', provider.id),
        ]);
        const legit = generateSessions(
            (avail || []).map((a: any) => ({ day_of_week: a.day_of_week, open_time: a.open_time, close_time: a.close_time })),
            (blocks || []).map((b: any) => b.blocked_date),
            Number(provider.slot_length_minutes) || 60,
            sessionDate, sessionDate,
        ).some((s) => s.time === sessionTime);
        if (!legit) {
            return NextResponse.json({ ok: false, error: 'That time isn’t available. Pick another.' }, { status: 400 });
        }

        // The session must still be in the future.
        if (new Date(sessionDate + 'T' + (sessionTime.length === 5 ? sessionTime + ':00' : sessionTime) + 'Z').getTime() <= Date.now()) {
            return NextResponse.json({ ok: false, error: 'That time has passed. Pick another.' }, { status: 400 });
        }

        const capacity = sessionCapacity(provider, unit);
        const quantity = orderQuantity(unit, unitMultiplies(unit) ? requestedQuantity : 1);
        if (quantity === null) {
            return NextResponse.json(
                { ok: false, error: 'Choose how many, up to ' + MAX_ORDER_QUANTITY + '.' },
                { status: 400 }
            );
        }

        // ---- claim the seat, atomically -----------------------------------
        // Materialise the session row (idempotent on the unique key), then take
        // seats by compare-and-swap. A lost swap means someone else moved it
        // between our read and our write, so re-read and try again; a full
        // session is a clean 409.
        await admin.from('slot_sessions')
            .upsert({ provider_id: provider.id, session_date: sessionDate, session_time: sessionTime, capacity, seats_taken: 0 },
                { onConflict: 'provider_id,session_date,session_time', ignoreDuplicates: true });

        let claimed = false;
        for (let attempt = 0; attempt < 5 && !claimed; attempt++) {
            const { data: sess } = await admin.from('slot_sessions')
                .select('id, capacity, seats_taken')
                .eq('provider_id', provider.id).eq('session_date', sessionDate).eq('session_time', sessionTime)
                .maybeSingle();
            if (!sess) break;
            if (sess.seats_taken + quantity > sess.capacity) {
                return NextResponse.json(
                    { ok: false, error: 'That time just filled up. Pick another.' },
                    { status: 409 }
                );
            }
            const { data: swapped } = await admin.from('slot_sessions')
                .update({ seats_taken: sess.seats_taken + quantity })
                .eq('id', sess.id).eq('seats_taken', sess.seats_taken)   // CAS guard
                .select('id');
            if (swapped && swapped.length) claimed = true;
        }
        if (!claimed) {
            return NextResponse.json({ ok: false, error: 'That time just filled up. Pick another.' }, { status: 409 });
        }

        const { data: sessionRow } = await admin.from('slot_sessions')
            .select('id').eq('provider_id', provider.id).eq('session_date', sessionDate).eq('session_time', sessionTime)
            .maybeSingle();

        // Helper to give the seat back if anything below fails.
        const releaseSeat = async () => {
            if (!sessionRow) return;
            const { data: s } = await admin.from('slot_sessions').select('seats_taken').eq('id', sessionRow.id).maybeSingle();
            if (s) await admin.from('slot_sessions').update({ seats_taken: Math.max(0, s.seats_taken - quantity) }).eq('id', sessionRow.id);
        };

        const unitPrice = Number(item.price);
        const total = orderTotal(unitPrice, quantity);
        const pricing = priceOrder(provider, { bandPrice: total }, []);
        const business = provider.business_name || 'Your experience';
        const itemName = item.name || business;
        const nowIso = new Date().toISOString();

        // The holding order — created HERE, not in the webhook, because the seat
        // is already taken and the hold must exist to be swept if unpaid.
        const { data: order, error: orderErr } = await admin.from('service_orders')
            .insert({
                provider_id: provider.id,
                guest_id: user.id,
                listing_id: booking.listing_id || null,
                booking_id: booking.id,
                trade: provider.trade || null,
                shape: 'slot',
                slot_session_id: sessionRow ? sessionRow.id : null,
                service_date: sessionDate,
                service_time: sessionTime,
                guests: booking.guests ?? null,
                quantity,
                unit_price: unitPrice,
                item_unit: unit,
                price: total,
                commission_rate: pricing.commissionRate,
                status: 'holding',
                item_id: item.id,
                item_name: itemName,
                item_description: item.description || '',
                provider_business_name: business,
                note: note || null,
                expires_at: new Date(Date.now() + SLOT_HOLD_MINUTES * 60 * 1000).toISOString(),
                created_at: nowIso,
            })
            .select('id')
            .single();

        if (orderErr || !order) {
            await releaseSeat();
            return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
        }

        try {
            const lineName = quantity > 1 ? itemName + ' × ' + quantity : itemName;
            const checkout = await stripeRequest('POST', '/checkout/sessions', {
                mode: 'payment',
                customer_email: user.email,
                payment_method_types: ['card'],
                line_items: [{
                    quantity: 1,
                    price_data: {
                        currency: 'gbp',
                        unit_amount: pricing.amountPence,
                        product_data: {
                            name: lineName + ' · ' + sessionDate + ' ' + sessionTime,
                            description: 'Booked with ' + business
                                + '. Galloway Getaways takes the payment on their behalf and is not the provider.',
                        },
                    },
                }],
                // Instant: captured on payment, not held. The slot IS the confirmation.
                payment_intent_data: {
                    on_behalf_of: provider.stripe_account_id,
                    application_fee_amount: pricing.applicationFeePence,
                    transfer_data: { destination: provider.stripe_account_id },
                    description: 'Galloway experience — ' + business + ' · ' + itemName,
                    metadata: { kind: 'slot_order', order_id: order.id, provider_id: provider.id, booking_id: booking.id },
                },
                success_url: SITE_URL + '/trips?experience=booked',
                cancel_url: SITE_URL + '/trips?experience=cancelled',
                // Give up on the Checkout at the hold's edge, so an abandoned one
                // stops being payable at the same moment the seat is released.
                expires_at: Math.floor(Date.now() / 1000) + SLOT_HOLD_MINUTES * 60,
                metadata: { kind: 'slot_order', order_id: order.id, provider_id: provider.id, booking_id: booking.id, guest_id: user.id },
            });

            return NextResponse.json({ ok: true, url: checkout.url });
        } catch (err: any) {
            // Checkout never started — undo the hold and the seat.
            await admin.from('service_orders').update({ status: 'expired' }).eq('id', order.id);
            await releaseSeat();
            console.error('[services/slots/book]', err && err.message);
            return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
        }
    } catch (err: any) {
        console.error('[services/slots/book]', err && err.message);
        return NextResponse.json({ ok: false, error: (err && err.message) || 'Could not start that' }, { status: 500 });
    }
}
