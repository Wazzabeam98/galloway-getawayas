import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import {
    guestExperiencesOpen, normaliseUnit,
    orderQuantity, orderTotal, priceOrder, MAX_ORDER_QUANTITY,
} from '@/lib/serviceOrders';
import { shapeOf, SLOT_HOLD_MINUTES } from '@/lib/serviceSlots';
import { foldOrderFamily } from '@/lib/orderFamily';
import { childrenAllowed } from '@/lib/guestAges';
import { perGroupPricing, changeWindowState, providerTakesChanges } from '@/lib/orderChange';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// CHANGE GUEST COUNT — for the two REQUEST shapes (made_to_order, comes_to_you).
// A slot has seats and uses /api/services/slots/top-up; this route refuses it.
//
// TWO KINDS OF ITEM, TWO OUTCOMES:
//   - per-group (a `flat` price): the count is the party size — it moves no money
//     at all, only respects the provider's capacity. Changed either way, any time.
//   - per-person (any multiplying unit): the count is the quantity, and it moves
//     money under the cancellation policy. A rise TOPS UP through Checkout (a new
//     charge, recorded as a child order exactly like a slot top-up, so the
//     original total is never rewritten). A fall REFUNDS the difference, but only
//     inside the free-cancellation window — past it the count floor is the
//     current count (a reduction would refund nothing, so it is not offered).
//
// Money moves before the row changes, and every refund carries an idempotency key
// unique to its exact transition, so a retry never refunds twice and a later full
// cancel (`refund-<id>`) can never collide with a partial reduce.

const ORDER_COLUMNS =
    'id, guest_id, provider_id, listing_id, booking_id, parent_order_id, status, shape, ' +
    'item_id, item_name, item_description, item_unit, unit_price, price, quantity, attendees, adults, children, amount_refunded, ' +
    'provider_business_name, service_date, service_time, fulfilment, service_address, stripe_payment_intent_id, ' +
    'guest_name, guest_email, guest_phone';

function providerMinAge(provider: any): number | null {
    const raw = provider && provider.guest_details && provider.guest_details.min_age;
    return raw == null || raw === '' ? null : Number(raw);
}
function capacityFor(provider: any): number {
    const cap = Number(provider && provider.guest_details && provider.guest_details.max_guests);
    return cap && cap > 0 ? Math.min(cap, MAX_ORDER_QUANTITY) : MAX_ORDER_QUANTITY;
}
function minPartyFor(provider: any): number {
    const m = Number(provider && provider.guest_details && provider.guest_details.min_people);
    return m && m > 0 ? m : 1;
}

type LoadErr = { error: { status: number; message: string } };
interface LoadedCount { order: any; provider: any; children: any[]; unit: string; windowHours: number; shape: string }

async function loadForCount(admin: any, orderId: string, userId: string): Promise<LoadedCount | LoadErr> {
    if (!orderId) return { error: { status: 400, message: 'Missing order' } };
    const { data: order } = await admin.from('service_orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle();
    if (!order) return { error: { status: 404, message: 'No such booking' } };
    if (order.guest_id !== userId) return { error: { status: 403, message: 'Not your booking' } };
    if (order.parent_order_id) return { error: { status: 400, message: 'Change the original booking, not an added part.' } };
    if (order.status !== 'confirmed') return { error: { status: 409, message: 'This booking isn’t confirmed yet.' } };
    const shape = shapeOf(order);
    if (shape === 'slot') return { error: { status: 400, message: 'Use the session picker for a slot booking.' } };

    const { data: provider } = await admin.from('service_providers')
        .select('id, business_name, trade, shape, status, plan, stripe_account_id, stripe_payouts_enabled, commission_rate, cancellation_window_hours, guest_details')
        .eq('id', order.provider_id).maybeSingle();
    if (!providerTakesChanges(provider)) return { error: { status: 400, message: 'That experience isn’t taking changes right now.' } };

    const { data: children } = await admin.from('service_orders')
        .select('id, quantity, attendees, adults, children, item_unit, price, status, stripe_payment_intent_id, created_at')
        .eq('parent_order_id', order.id).eq('status', 'confirmed').order('created_at', { ascending: false });

    const unit = normaliseUnit(order.item_unit);
    const windowHours = Number(provider.cancellation_window_hours) || 48;
    return { order, provider, children: children || [], unit, windowHours, shape };
}

export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        if (!guestExperiencesOpen()) return NextResponse.json({ ok: false, error: 'Guest experiences aren’t open yet.' }, { status: 403 });

        const orderId = new URL(request.url).searchParams.get('orderId') || '';
        const admin = adminClient();
        const loaded = await loadForCount(admin, orderId, user.id);
        if ('error' in loaded) return NextResponse.json({ ok: false, error: loaded.error.message }, { status: loaded.error.status });
        const { order, provider, children, unit } = loaded;

        const now = new Date();
        const win = changeWindowState(order, loaded.windowHours, now);
        const perGroup = perGroupPricing(unit);

        // CLOSED WINDOW — once the free-cancellation window passes, no change is
        // allowed; the sheet says so and offers to message the provider.
        if (!win.free) {
            return NextResponse.json({
                ok: true, closed: true, shape: loaded.shape, itemName: order.item_name,
                deadlineISO: win.deadlineISO, providerName: provider.business_name || null,
            });
        }

        if (perGroup) {
            // Party size only — no money, so the window is irrelevant. Respect the
            // provider's capacity and minimum.
            const current = Math.max(1, Number(order.attendees) || Number(order.quantity) || 1);
            return NextResponse.json({
                ok: true, shape: loaded.shape, perGroup: true,
                current, min: minPartyFor(provider), max: capacityFor(provider),
                unitPrice: 0, itemName: order.item_name, free: win.free, deadlineISO: win.deadlineISO,
            });
        }

        const family = foldOrderFamily(order, children);
        const current = family.headcount;
        const capMax = loaded.shape === 'comes_to_you' ? capacityFor(provider) : MAX_ORDER_QUANTITY;
        // made_to_order counts a quantity of a thing (three cakes), so its sheet is
        // a single stepper; comes_to_you counts people, so it splits adults/kids.
        const mode = loaded.shape === 'made_to_order' ? 'quantity' : 'people';
        return NextResponse.json({
            ok: true, shape: loaded.shape, perGroup: false, mode,
            current,
            adults: family.adults, children: family.children,
            // Past the window a reduction refunds nothing, so the floor is the
            // current count; inside it, down to the provider's minimum.
            min: win.free ? Math.min(current, minPartyFor(provider)) : current,
            max: Math.max(current, capMax),
            unitPrice: Number(order.unit_price),
            currency: 'gbp',
            free: win.free, deadlineISO: win.deadlineISO,
            itemName: order.item_name, minAge: providerMinAge(provider),
        });
    } catch (err: any) {
        await logError('services-order-change-count-GET', { message: String(err && err.message) });
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
        const wantCount = Math.floor(Number(body && body.count));
        const reqChildren = Math.max(0, Math.floor(Number(body && body.children) || 0));

        const admin = adminClient();
        const loaded = await loadForCount(admin, orderId, user.id);
        if ('error' in loaded) return NextResponse.json({ ok: false, error: loaded.error.message }, { status: loaded.error.status });
        const { order, provider, children, unit } = loaded;
        const now = new Date();
        const win = changeWindowState(order, loaded.windowHours, now);
        const perGroup = perGroupPricing(unit);

        // CLOSED WINDOW — no change of any kind once the window has passed.
        if (!win.free) {
            return NextResponse.json({ ok: false, error: 'Changes are closed now — the free-cancellation window has passed. Message the provider if you need to change anything.' }, { status: 409 });
        }
        if (!Number.isFinite(wantCount) || wantCount < 1) {
            return NextResponse.json({ ok: false, error: 'Choose a number.' }, { status: 400 });
        }

        // ---- PER-GROUP: party size, no money -----------------------------------
        if (perGroup) {
            const min = minPartyFor(provider), max = capacityFor(provider);
            if (wantCount < min || wantCount > max) {
                return NextResponse.json({ ok: false, error: 'That group size is outside what this experience takes (' + min + '–' + max + ').' }, { status: 400 });
            }
            const { data: done } = await admin.from('service_orders')
                .update({ attendees: wantCount }).eq('id', order.id).eq('status', 'confirmed').select('id');
            if (!done || !done.length) return NextResponse.json({ ok: false, error: 'That booking changed — reload and try again.' }, { status: 409 });
            return NextResponse.json({ ok: true, groupOnly: true, count: wantCount });
        }

        // ---- PER-PERSON: the count moves money ---------------------------------
        const family = foldOrderFamily(order, children);
        const current = family.headcount;
        const unitPrice = Number(order.unit_price);
        const delta = wantCount - current;
        if (delta === 0) return NextResponse.json({ ok: false, error: 'That’s already your count.' }, { status: 400 });

        // ---- A RISE — top up through Checkout, recorded as a child order -------
        if (delta > 0) {
            const added = orderQuantity(unit, delta);
            if (added === null) return NextResponse.json({ ok: false, error: 'You can add up to ' + MAX_ORDER_QUANTITY + '.' }, { status: 400 });
            const capMax = loaded.shape === 'comes_to_you' ? capacityFor(provider) : MAX_ORDER_QUANTITY;
            if (wantCount > Math.max(current, capMax)) {
                return NextResponse.json({ ok: false, error: 'That’s more than this experience can take.' }, { status: 400 });
            }
            const kidsOk = childrenAllowed(providerMinAge(provider));
            const addChildren = kidsOk ? Math.min(reqChildren, added - 1) : 0;
            const addAdults = added - addChildren;

            const deltaTotal = Math.round((orderTotal(unitPrice, current + added) - orderTotal(unitPrice, current)) * 100) / 100;
            const pricing = priceOrder(provider, { bandPrice: deltaTotal }, []);
            if (pricing.amountPence <= 0) return NextResponse.json({ ok: false, error: 'That doesn’t add a charge.' }, { status: 400 });

            const business = provider.business_name || order.provider_business_name || 'Your experience';
            const itemName = order.item_name || business;
            const nowIso = now.toISOString();
            const { data: child, error: childErr } = await admin.from('service_orders').insert({
                parent_order_id: order.id, provider_id: provider.id, guest_id: user.id,
                booking_id: null, listing_id: null, trade: provider.trade || null,
                shape: order.shape, slot_session_id: null,
                service_date: order.service_date, service_time: order.service_time,
                duration_minutes: null, fulfilment: order.fulfilment, service_address: order.service_address,
                guests: added, attendees: null, quantity: added, adults: addAdults, children: addChildren,
                unit_price: unitPrice, item_unit: unit, price: deltaTotal, commission_rate: pricing.commissionRate,
                status: 'holding', item_id: order.item_id, item_name: itemName, item_description: order.item_description || '',
                provider_business_name: business, guest_name: order.guest_name, guest_email: order.guest_email, guest_phone: order.guest_phone,
                expires_at: new Date(Date.now() + SLOT_HOLD_MINUTES * 60 * 1000).toISOString(), created_at: nowIso,
            }).select('id').single();
            if (childErr || !child) return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });

            try {
                const lineName = added > 1 ? itemName + ' × ' + added + ' more' : itemName + ' · one more';
                const checkout = await stripeRequest('POST', '/checkout/sessions', {
                    mode: 'payment', customer_email: order.guest_email || user.email || undefined, payment_method_types: ['card'],
                    line_items: [{ quantity: 1, price_data: { currency: 'gbp', unit_amount: pricing.amountPence,
                        product_data: { name: lineName + ' · ' + String(order.service_date).slice(0, 10),
                            description: 'Added to your booking with ' + business + '. Galloway Getaways takes the payment on their behalf and is not the provider.' } } }],
                    payment_intent_data: {
                        on_behalf_of: provider.stripe_account_id, application_fee_amount: pricing.applicationFeePence,
                        transfer_data: { destination: provider.stripe_account_id },
                        description: 'Galloway experience — added · ' + business + ' · ' + itemName,
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
                await logError('services-order-change-count-topup', { message: String(err && err.message) });
                return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
            }
        }

        // ---- A FALL — refund the difference, inside the window only ------------
        if (!win.free) {
            return NextResponse.json({ ok: false, error: 'The free-cancellation window has passed, so a reduction wouldn’t be refunded.' }, { status: 409 });
        }
        if (wantCount < minPartyFor(provider)) {
            return NextResponse.json({ ok: false, error: 'That’s below the minimum for this experience.' }, { status: 400 });
        }
        let removeK = current - wantCount;              // > 0
        let refunded = 0;

        // Whole added-place children first (newest first), each a clean full refund.
        for (const kid of children) {
            if (removeK <= 0) break;
            const kidQty = Number(kid.quantity) || 1;
            if (kidQty > removeK) continue;             // leave a child bigger than the remainder for the parent step
            if (!kid.stripe_payment_intent_id) continue;
            await stripeRequest('POST', '/refunds',
                { payment_intent: kid.stripe_payment_intent_id, refund_application_fee: 'true', reverse_transfer: 'true' },
                'refund-' + kid.id);
            const { data: moved } = await admin.from('service_orders')
                .update({ status: 'refunded', amount_refunded: Number(kid.price) || 0, cancelled_at: now.toISOString() })
                .eq('id', kid.id).eq('status', 'confirmed').select('id');
            if (moved && moved.length) { removeK -= kidQty; refunded += Number(kid.price) || 0; }
        }

        // The remainder comes off the parent as a PARTIAL refund on its own PI.
        if (removeK > 0) {
            const parentQty = orderQuantity(unit, order.quantity) || Number(order.quantity) || 0;
            const newParentQty = parentQty - removeK;
            if (newParentQty < 1 || !order.stripe_payment_intent_id) {
                return NextResponse.json({ ok: refunded > 0, refunded, error: 'Reduce in smaller steps, or cancel the booking.', partial: refunded > 0 }, { status: refunded > 0 ? 200 : 409 });
            }
            const refundAmt = Math.round((orderTotal(unitPrice, parentQty) - orderTotal(unitPrice, newParentQty)) * 100) / 100;
            const amountPence = Math.round(refundAmt * 100);
            // A key unique to this exact transition. Parent quantity only ever
            // falls, so from→to can never repeat; a retry replays safely, a later
            // full cancel uses 'refund-<id>' and cannot collide.
            await stripeRequest('POST', '/refunds',
                { payment_intent: order.stripe_payment_intent_id, amount: amountPence, refund_application_fee: 'true', reverse_transfer: 'true' },
                'reduce-' + order.id + '-' + parentQty + '-' + newParentQty);
            const newAdults = Math.max(1, (Number(order.adults) || newParentQty) - Math.min(removeK, Math.max(0, (Number(order.children) || 0))));
            const newChildren = Math.max(0, newParentQty - newAdults);
            const { data: done } = await admin.from('service_orders')
                .update({
                    quantity: newParentQty, price: orderTotal(unitPrice, newParentQty),
                    adults: newAdults, children: newChildren,
                    amount_refunded: (Number(order.amount_refunded) || 0) + refundAmt,
                })
                .eq('id', order.id).eq('status', 'confirmed').eq('quantity', order.quantity).select('id');
            if (!done || !done.length) {
                await logError('services-order-change-count-parent-cas', { order: order.id, message: 'parent row moved after refund' });
                return NextResponse.json({ ok: true, refunded: refunded + refundAmt, warn: 'Refunded — reload to see the new count.' });
            }
            refunded += refundAmt;
        }

        return NextResponse.json({ ok: true, refunded: Math.round(refunded * 100) / 100, count: wantCount });
    } catch (err: any) {
        await logError('services-order-change-count-POST', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Could not change that.' }, { status: 500 });
    }
}
