import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import {
    isLiveToGuests, priceOrder, guestExperiencesOpen,
    normaliseUnit, unitMultiplies, orderQuantity, orderTotal, MAX_ORDER_QUANTITY,
} from '@/lib/serviceOrders';
import {
    isSlot, seatsLeft, SLOT_HOLD_MINUTES,
    freeCancelDeadline, guestMayCancelFree, shapeOf,
} from '@/lib/serviceSlots';
import { foldOrderFamily } from '@/lib/orderFamily';

export const dynamic = 'force-dynamic';

// ADDING GUESTS to a per-person slot booking — buying more places on a session
// the guest has already booked. It is another slot booking against the SAME
// session, recorded as a CHILD order (parent_order_id) so the original's total
// is never rewritten: the seat is claimed by the same compare-and-swap, held
// 'holding', confirmed by the same webhook and swept if unpaid.
//
// Per-person ONLY. A private hire (flat item) is bought whole — there are no
// per-seat places to add, and a bigger party is settled with the provider over
// message — so a top-up on one is refused with that reason, not a 500.
//
// Payer-only. The route keys every read on the caller being the order's own
// guest_id, so a companion (who can open the order page but is walled off the
// price) cannot reach it, quote it, or charge the payer's card.

// The columns a top-up needs off the parent order. No money column is named on
// the load that gates the caller — the price is derived here, server-side.
const PARENT_COLUMNS =
    'id, guest_id, provider_id, listing_id, booking_id, parent_order_id, status, shape, ' +
    'item_id, item_name, item_description, item_unit, unit_price, provider_business_name, ' +
    'service_date, service_time, duration_minutes, fulfilment, service_address, ' +
    'slot_session_id, quantity, attendees, guest_name, guest_email, guest_phone';

interface Loaded {
    order: any;
    provider: any;
    session: any;
    unitPrice: number;
    windowHours: number;
}
type LoadError = { error: { status: number; message: string } };

// Load the parent order and everything a top-up decision needs, applying every
// guard that is shared between the quote (GET) and the charge (POST): the caller
// owns it, it is a confirmed per-person slot, and it is not itself a top-up.
async function loadForTopUp(admin: any, orderId: string, userId: string): Promise<Loaded | LoadError> {
    if (!orderId) return { error: { status: 400, message: 'Missing order' } };

    const { data: order } = await admin
        .from('service_orders').select(PARENT_COLUMNS).eq('id', orderId).maybeSingle();
    if (!order) return { error: { status: 404, message: 'No such booking' } };
    // Payer-only. A companion is never the guest_id, so this is the wall.
    if (order.guest_id !== userId) return { error: { status: 403, message: 'Not your booking' } };
    // A top-up amends the ORIGINAL order; you cannot top up a top-up.
    if (order.parent_order_id) return { error: { status: 400, message: 'Add places to the original booking, not an added one.' } };
    if (order.status !== 'confirmed') return { error: { status: 409, message: 'This booking isn’t confirmed, so there’s nothing to add to yet.' } };

    const unit = normaliseUnit(order.item_unit);
    // Per-person ONLY. A private hire / whole-session booking has no per-seat
    // places to add — a bigger party is arranged with the provider directly.
    if (shapeOf(order) !== 'slot' || !unitMultiplies(unit)) {
        return { error: { status: 400, message: 'This is a private hire — the whole session is already yours. To bring more people, message the provider.' } };
    }
    if (!order.slot_session_id) return { error: { status: 409, message: 'That booking can’t take more places.' } };

    const { data: provider } = await admin
        .from('service_providers')
        .select('id, business_name, trade, shape, status, plan, stripe_account_id, stripe_payouts_enabled, commission_rate, slot_capacity, slot_min_people, cancellation_window_hours')
        .eq('id', order.provider_id).maybeSingle();
    if (!provider || !isSlot(provider) || !isLiveToGuests(provider) || !provider.stripe_account_id) {
        return { error: { status: 400, message: 'That experience isn’t taking bookings right now.' } };
    }

    const { data: session } = await admin
        .from('slot_sessions').select('id, capacity, seats_taken, private, declared')
        .eq('id', order.slot_session_id).maybeSingle();
    if (!session) return { error: { status: 409, message: 'That session is no longer available.' } };

    return { order, provider, session, unitPrice: Number(order.unit_price), windowHours: Number(provider.cancellation_window_hours) || 48 };
}

// The confirmed family head count and the cancellation cutoff — the two facts
// the panel needs to size the picker and to warn about a place bought inside the
// window (which the session-anchored deadline makes non-refundable at once).
async function sessionFacts(admin: any, loaded: Loaded, now: Date) {
    const { order, session, windowHours } = loaded;
    const { data: children } = await admin
        .from('service_orders').select('quantity, attendees, adults, children, item_unit')
        .eq('parent_order_id', order.id).eq('status', 'confirmed');
    const folded = foldOrderFamily(order, children || []);

    // Raw seats left on the session. Not optionAvailability — that also enforces
    // the session's MINIMUM party, which is a floor for a fresh booking, not for
    // adding to a session that is already running above it.
    const left = seatsLeft(session);

    const deadline = freeCancelDeadline('slot', String(order.service_date), order.service_time || null, windowHours);
    const insideWindow = !guestMayCancelFree('slot', String(order.service_date), order.service_time || null, windowHours, now);

    return { folded, seatsLeft: left, deadlineISO: deadline.toISOString(), insideWindow };
}

// GET — the payer's quote for the panel: unit price, seats left, the current
// party, and the cancellation cutoff (with whether now is already past it).
export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!guestExperiencesOpen()) return NextResponse.json({ ok: false, error: 'Guest experiences aren’t open yet.' }, { status: 403 });

        const orderId = new URL(request.url).searchParams.get('orderId') || '';
        const admin = adminClient();
        const loaded = await loadForTopUp(admin, orderId, user.id);
        if ('error' in loaded) return NextResponse.json({ ok: false, error: loaded.error.message }, { status: loaded.error.status });

        const now = new Date();
        const facts = await sessionFacts(admin, loaded, now);

        return NextResponse.json({
            ok: true,
            unitPrice: loaded.unitPrice,
            currency: 'gbp',
            seatsLeft: facts.seatsLeft,
            headcount: facts.folded.headcount,
            // The current party split, folded across the family. Null when no
            // split was ever recorded — the panel then seeds the stepper as all
            // adults, since that is what an unsplit order is treated as.
            adults: facts.folded.adults,
            children: facts.folded.children,
            maxAddable: Math.min(facts.seatsLeft, MAX_ORDER_QUANTITY),
            serviceDate: loaded.order.service_date,
            serviceTime: loaded.order.service_time ? String(loaded.order.service_time).slice(0, 5) : null,
            deadlineISO: facts.deadlineISO,
            insideWindow: facts.insideWindow,
            itemName: loaded.order.item_name,
        });
    } catch (err: any) {
        console.error('[services/slots/top-up GET]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not load that.' }, { status: 500 });
    }
}

// POST — claim the added seats and start Checkout for the delta.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!guestExperiencesOpen()) return NextResponse.json({ ok: false, error: 'Guest experiences aren’t open yet.' }, { status: 403 });

        const body = await request.json().catch(() => ({}));
        const orderId: string = body && body.orderId;

        const admin = adminClient();
        const loaded = await loadForTopUp(admin, orderId, user.id);
        if ('error' in loaded) return NextResponse.json({ ok: false, error: loaded.error.message }, { status: loaded.error.status });
        const { order, provider, session, unitPrice } = loaded;

        const unit = normaliseUnit(order.item_unit);

        // HOW MANY, and the split of the ADDED places (adults 13+, children 4-12)
        // — a head-count detail for the provider, never a price: every seat costs
        // the same. Mirror the book route: keep the guest's children choice, give
        // the rest to adults (always at least one adult on the added places), and
        // force the split to sum to the added count. A split is required here
        // because "adding a place asks which".
        const added = orderQuantity(unit, body && body.quantity);
        if (added === null || added < 1) {
            return NextResponse.json({ ok: false, error: 'Choose how many to add, up to ' + MAX_ORDER_QUANTITY + '.' }, { status: 400 });
        }
        const reqChildren = Math.max(0, Math.floor(Number(body && body.children) || 0));
        const addChildren = Math.min(reqChildren, added - 1);
        const addAdults = added - addChildren;

        // ---- claim the added seats, atomically (a JOIN on the pinned session) --
        // The session already exists and is a shared table (per-person), so this
        // is the plain seats CAS — read seats_taken, confirm the added places
        // still fit through the one availability function the panel greyed with,
        // then take them with an UPDATE guarded on the value we read. A lost swap
        // means someone moved between our read and write: re-read and retry. A
        // full session is a clean 409 — nobody is charged for a seat they could
        // not have, and two guests topping up at once cannot both take the last.
        let claimed = false;
        for (let attempt = 0; attempt < 5 && !claimed; attempt++) {
            const { data: sess } = await admin.from('slot_sessions')
                .select('id, capacity, seats_taken, private, declared')
                .eq('id', session.id).maybeSingle();
            if (!sess) break;
            if (added > seatsLeft(sess)) {
                return NextResponse.json({ ok: false, error: 'There aren’t that many places left. Try fewer.' }, { status: 409 });
            }
            const { data: swapped } = await admin.from('slot_sessions')
                .update({ seats_taken: sess.seats_taken + added })
                .eq('id', sess.id).eq('seats_taken', sess.seats_taken)   // CAS guard
                .select('id');
            if (swapped && swapped.length) claimed = true;
        }
        if (!claimed) return NextResponse.json({ ok: false, error: 'There aren’t that many places left. Try fewer.' }, { status: 409 });

        const releaseSeats = async () => {
            const { data: s } = await admin.from('slot_sessions').select('seats_taken').eq('id', session.id).maybeSingle();
            if (s) await admin.from('slot_sessions').update({ seats_taken: Math.max(0, s.seats_taken - added) }).eq('id', session.id);
        };

        // THE DELTA. price(old + added) − price(old), through the shared order
        // helper — never a hand-rolled unit × added, so any per-quantity rule the
        // helper ever grows is honoured here too. Commission on the delta is
        // struck at the same rate as the original, by priceOrder.
        const oldQty = orderQuantity(unit, order.quantity) || Number(order.quantity) || 0;
        const deltaTotal = Math.round((orderTotal(unitPrice, oldQty + added) - orderTotal(unitPrice, oldQty)) * 100) / 100;
        const pricing = priceOrder(provider, { bandPrice: deltaTotal }, []);
        if (pricing.amountPence <= 0) {
            await releaseSeats();
            return NextResponse.json({ ok: false, error: 'That doesn’t add a charge.' }, { status: 400 });
        }

        const business = provider.business_name || order.provider_business_name || 'Your experience';
        const itemName = order.item_name || business;
        const nowIso = new Date().toISOString();

        // The CHILD holding order — its own row, its own seats, no booking_id
        // (parent_order_id is the only link). Confirmed by the same webhook and
        // swept if unpaid, exactly like the original slot order.
        const { data: child, error: childErr } = await admin.from('service_orders')
            .insert({
                parent_order_id: order.id,
                provider_id: provider.id,
                guest_id: user.id,
                booking_id: null,
                listing_id: null,
                trade: provider.trade || null,
                shape: 'slot',
                slot_session_id: session.id,
                service_date: order.service_date,
                service_time: order.service_time,
                duration_minutes: order.duration_minutes,
                fulfilment: order.fulfilment,
                service_address: order.service_address,
                // The provider sees the ADDED places on this row; the folded
                // family head count is what the diary and order page show.
                guests: added,
                attendees: null,
                quantity: added,
                adults: addAdults,
                children: addChildren,
                unit_price: unitPrice,
                item_unit: unit,
                price: deltaTotal,
                commission_rate: pricing.commissionRate,
                status: 'holding',
                item_id: order.item_id,
                item_name: itemName,
                item_description: order.item_description || '',
                provider_business_name: business,
                guest_name: order.guest_name,
                guest_email: order.guest_email,
                guest_phone: order.guest_phone,
                expires_at: new Date(Date.now() + SLOT_HOLD_MINUTES * 60 * 1000).toISOString(),
                created_at: nowIso,
            })
            .select('id')
            .single();
        if (childErr || !child) {
            await releaseSeats();
            return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
        }

        try {
            const lineName = added > 1 ? itemName + ' × ' + added + ' more places' : itemName + ' · one more place';
            const time = order.service_time ? String(order.service_time).slice(0, 5) : '';
            const checkout = await stripeRequest('POST', '/checkout/sessions', {
                mode: 'payment',
                customer_email: order.guest_email || user.email || undefined,
                payment_method_types: ['card'],
                line_items: [{
                    quantity: 1,
                    price_data: {
                        currency: 'gbp',
                        unit_amount: pricing.amountPence,
                        product_data: {
                            name: lineName + ' · ' + order.service_date + (time ? ' ' + time : ''),
                            description: 'Added to your booking with ' + business
                                + '. Galloway Getaways takes the payment on their behalf and is not the provider.',
                        },
                    },
                }],
                custom_text: {
                    submit: {
                        message: 'Galloway Getaways takes this payment on behalf of ' + business + '. We are the booking agent, not the provider of the experience.',
                    },
                },
                // The provider stays merchant of record; commission on the delta
                // as on the original.
                payment_intent_data: {
                    on_behalf_of: provider.stripe_account_id,
                    application_fee_amount: pricing.applicationFeePence,
                    transfer_data: { destination: provider.stripe_account_id },
                    description: 'Galloway experience — added places · ' + business + ' · ' + itemName,
                    metadata: { kind: 'slot_order', order_id: child.id, parent_order_id: order.id, provider_id: provider.id },
                },
                success_url: SITE_URL + '/experiences/order/' + order.id + '?added=1',
                cancel_url: SITE_URL + '/experiences/order/' + order.id + '?added=cancelled',
                expires_at: Math.floor(Date.now() / 1000) + SLOT_HOLD_MINUTES * 60,
                metadata: { kind: 'slot_order', order_id: child.id, parent_order_id: order.id, provider_id: provider.id, guest_id: user.id },
            });
            return NextResponse.json({ ok: true, url: checkout.url });
        } catch (err: any) {
            await admin.from('service_orders').update({ status: 'expired' }).eq('id', child.id);
            await releaseSeats();
            console.error('[services/slots/top-up]', err && err.message);
            return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
        }
    } catch (err: any) {
        console.error('[services/slots/top-up]', err && err.message);
        return NextResponse.json({ ok: false, error: (err && err.message) || 'Could not start that' }, { status: 500 });
    }
}
