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
import { hasExtraGuests, partyPrice, partyCeiling } from '@/lib/extraGuests';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// CHANGE GUEST COUNT — for COMES-TO-YOU only, and INCREASES only.
//
// The rules changed on PR #173: guest-count REDUCTIONS are gone everywhere and
// the reduce-and-refund path is deleted; MADE-TO-ORDER no longer offers a guest
// count change at all; and a comes-to-you increase is never instant — it is a
// REQUEST the provider accepts or declines, on an authorise-then-capture hold
// (the same flow the per-person top-up already used). A slot keeps its own
// instant, seat-limited top-up at /api/services/slots/top-up; this route refuses
// it. To LOWER a count, a guest cancels and rebooks or messages the provider.
//
// Two kinds of comes-to-you item both raise money and so both hold-then-capture:
//   - per-person (a multiplying unit): the extra places are a top-up child order.
//   - flat with extra-guests pricing: a bigger party adds the per-head fees.
// A plain flat item (no extra-guests pricing) has nothing to charge for a larger
// party, so there is nothing to request — the sheet points the guest at the
// provider instead.

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

type LoadErr = { error: { status: number; message: string } };
interface LoadedCount { order: any; provider: any; item: any; children: any[]; unit: string; windowHours: number; shape: string }

async function loadForCount(admin: any, orderId: string, userId: string): Promise<LoadedCount | LoadErr> {
    if (!orderId) return { error: { status: 400, message: 'Missing order' } };
    const { data: order } = await admin.from('service_orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle();
    if (!order) return { error: { status: 404, message: 'No such booking' } };
    if (order.guest_id !== userId) return { error: { status: 403, message: 'Not your booking' } };
    if (order.parent_order_id) return { error: { status: 400, message: 'Change the original booking, not an added part.' } };
    if (order.status !== 'confirmed') return { error: { status: 409, message: 'This booking isn’t confirmed yet.' } };
    const shape = shapeOf(order);
    if (shape === 'slot') return { error: { status: 400, message: 'Use the session picker for a slot booking.' } };
    // Made-to-order no longer takes a guest-count change of any kind.
    if (shape === 'made_to_order') return { error: { status: 400, message: 'This booking’s quantity can’t be changed — message the provider.' } };

    const { data: provider } = await admin.from('service_providers')
        .select('id, business_name, trade, shape, status, plan, stripe_account_id, stripe_payouts_enabled, commission_rate, cancellation_window_hours, guest_details')
        .eq('id', order.provider_id).maybeSingle();
    if (!providerTakesChanges(provider)) return { error: { status: 400, message: 'That experience isn’t taking changes right now.' } };

    // The item, for its extra-guests pricing (a flat item may charge per extra head).
    const { data: item } = order.item_id
        ? await admin.from('service_provider_items')
            .select('id, unit, price, included_guests, extra_adult_fee, extra_child_fee, max_party')
            .eq('id', order.item_id).maybeSingle()
        : { data: null };

    const { data: children } = await admin.from('service_orders')
        .select('id, quantity, attendees, adults, children, item_unit, price, status, stripe_payment_intent_id, created_at')
        .eq('parent_order_id', order.id).eq('status', 'confirmed').order('created_at', { ascending: false });

    const unit = normaliseUnit(order.item_unit);
    const windowHours = Number(provider.cancellation_window_hours) || 48;
    return { order, provider, item, children: children || [], unit, windowHours, shape };
}

// Start the authorise-then-capture Checkout for an increase REQUEST: a child
// order holds the extra charge; the webhook turns the paid hold into 'authorised'
// under kind 'change_request', and the provider accepts (capture) or declines /
// lets it lapse (released). Shared by the per-person and extra-guests rises.
async function startIncreaseRequest(
    admin: any, user: any, order: any, provider: any,
    child: { attendees: number; adults: number; children: number; quantity: number; unit: string; unitPrice: number; price: number; lineName: string },
) {
    const business = provider.business_name || order.provider_business_name || 'Your experience';
    const itemName = order.item_name || business;
    const pricing = priceOrder(provider, { bandPrice: child.price }, []);
    if (pricing.amountPence <= 0) return NextResponse.json({ ok: false, error: 'That doesn’t add a charge.' }, { status: 400 });
    const nowIso = new Date().toISOString();
    const { data: row, error: childErr } = await admin.from('service_orders').insert({
        parent_order_id: order.id, provider_id: provider.id, guest_id: user.id,
        booking_id: null, listing_id: null, trade: provider.trade || null,
        shape: order.shape, slot_session_id: null,
        service_date: order.service_date, service_time: order.service_time,
        duration_minutes: null, fulfilment: order.fulfilment, service_address: order.service_address,
        guests: Math.max(1, child.attendees), attendees: child.unit === 'flat' ? Math.max(1, child.attendees) : null,
        quantity: Math.max(1, child.quantity), adults: child.adults, children: child.children,
        unit_price: child.unitPrice, item_unit: child.unit, price: child.price, commission_rate: pricing.commissionRate,
        status: 'holding', item_id: order.item_id, item_name: itemName, item_description: order.item_description || '',
        provider_business_name: business, guest_name: order.guest_name, guest_email: order.guest_email, guest_phone: order.guest_phone,
        expires_at: new Date(Date.now() + SLOT_HOLD_MINUTES * 60 * 1000).toISOString(), created_at: nowIso,
    }).select('id').single();
    if (childErr || !row) return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
    try {
        const checkout = await stripeRequest('POST', '/checkout/sessions', {
            mode: 'payment', customer_email: order.guest_email || user.email || undefined, payment_method_types: ['card'],
            line_items: [{ quantity: 1, price_data: { currency: 'gbp', unit_amount: pricing.amountPence,
                product_data: { name: child.lineName + ' · ' + String(order.service_date).slice(0, 10),
                    description: 'Extra places requested from ' + business + '. Your card is only held until they accept; Galloway Getaways takes the payment on their behalf and is not the provider.' } } }],
            payment_intent_data: {
                capture_method: 'manual',
                on_behalf_of: provider.stripe_account_id, application_fee_amount: pricing.applicationFeePence,
                transfer_data: { destination: provider.stripe_account_id },
                description: 'Galloway experience — extra places (request) · ' + business + ' · ' + itemName,
                metadata: { kind: 'change_request', order_id: row.id, parent_order_id: order.id, provider_id: provider.id },
            },
            success_url: SITE_URL + '/experiences/order/' + order.id + '?requested=1',
            cancel_url: SITE_URL + '/experiences/order/' + order.id + '?requested=cancelled',
            expires_at: Math.floor(Date.now() / 1000) + SLOT_HOLD_MINUTES * 60,
            metadata: { kind: 'change_request', order_id: row.id, parent_order_id: order.id, provider_id: provider.id, guest_id: user.id },
        });
        return NextResponse.json({ ok: true, url: checkout.url, requested: true });
    } catch (err: any) {
        await admin.from('service_orders').update({ status: 'expired' }).eq('id', row.id);
        await logError('services-order-change-count-topup', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
    }
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
        const { order, provider, item, children, unit } = loaded;

        const now = new Date();
        const win = changeWindowState(order, loaded.windowHours, now);
        const perGroup = perGroupPricing(unit);
        const extraGuests = perGroup && hasExtraGuests(item);
        const minAge = providerMinAge(provider);

        // CLOSED WINDOW — once the free-cancellation window passes, no change is
        // allowed; the sheet says so and offers to message the provider.
        if (!win.free) {
            return NextResponse.json({
                ok: true, closed: true, shape: loaded.shape, itemName: order.item_name,
                deadlineISO: win.deadlineISO, providerName: provider.business_name || null,
            });
        }

        if (extraGuests) {
            // A flat item with extra-guests pricing. INCREASES ONLY: the base
            // covers the included heads, each extra adult/child adds its fee, held
            // on the card and captured only if the provider accepts. Reductions are
            // gone, so the floor is the current party.
            const curAdults = Math.max(1, Number(order.adults) || Math.max(1, Number(order.attendees) || 1));
            const curChildren = Math.max(0, Number(order.children) || 0);
            // The party is capped by what the ITEM takes (its max_party), not by how
            // many are staying: a comes-to-you dinner can be for visitors as well as
            // the guests sleeping at the cottage, so the "up to N" the listing shows
            // is the real limit. (Was min(partyCeiling, stayGuests), which pinned a
            // 6-person dinner on a 2-guest stay below its own party and blocked 6→7.)
            const ceiling = partyCeiling(item);
            const currentPrice = partyPrice(item, curAdults, curChildren, minAge);
            return NextResponse.json({
                ok: true, shape: loaded.shape, perGroup: true, extraGuests: true, riseOnly: true,
                current: curAdults + curChildren, adults: curAdults, children: curChildren,
                min: curAdults + curChildren, max: Number.isFinite(ceiling) ? ceiling : capacityFor(provider),
                includedGuests: Number(item.included_guests) || 0,
                extraAdultFee: Number(item.extra_adult_fee) || 0,
                extraChildFee: Number(item.extra_child_fee) || 0,
                currentPrice, unitPrice: Number(item.price) || 0,
                currency: 'gbp', minAge, itemName: order.item_name, free: win.free, deadlineISO: win.deadlineISO,
            });
        }

        if (perGroup) {
            // A plain flat item (no extra-guests pricing): a larger party costs
            // nothing to add and there is nothing to hold, so there is no request
            // to make — point the guest at the provider.
            return NextResponse.json({
                ok: true, shape: loaded.shape, messageOnly: true,
                itemName: order.item_name, providerName: provider.business_name || null,
            });
        }

        // PER-PERSON comes-to-you. INCREASES ONLY: extra places are a top-up child
        // order, held and captured on accept. The floor is the current count.
        const family = foldOrderFamily(order, children);
        const current = family.headcount;
        // Capped by what the provider takes, not the stay's guest count — a
        // comes-to-you session can host visitors beyond those staying.
        const capMax = capacityFor(provider);
        return NextResponse.json({
            ok: true, shape: loaded.shape, perGroup: false, mode: 'people', riseOnly: true,
            current,
            adults: family.adults, children: family.children,
            min: current,
            max: Math.max(current, capMax),
            unitPrice: Number(order.unit_price),
            currency: 'gbp',
            free: win.free, deadlineISO: win.deadlineISO,
            itemName: order.item_name, minAge,
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
        const { order, provider, item, children, unit } = loaded;
        const now = new Date();
        const win = changeWindowState(order, loaded.windowHours, now);
        const perGroup = perGroupPricing(unit);
        const extraGuests = perGroup && hasExtraGuests(item);

        // CLOSED WINDOW — no change of any kind once the window has passed.
        if (!win.free) {
            return NextResponse.json({ ok: false, error: 'Changes are closed now — the free-cancellation window has passed. Message the provider if you need to change anything.' }, { status: 409 });
        }
        if (!Number.isFinite(wantCount) || wantCount < 1) {
            return NextResponse.json({ ok: false, error: 'Choose a number.' }, { status: 400 });
        }

        // ---- FLAT ITEM WITH EXTRA-GUESTS PRICING — a bigger party is a request --
        if (extraGuests) {
            const minAge = providerMinAge(provider);
            const kidsOk = childrenAllowed(minAge);
            const curAdults = Math.max(1, Number(order.adults) || Math.max(1, Number(order.attendees) || 1));
            const curChildren = Math.max(0, Number(order.children) || 0);
            const newAdults = Math.max(1, Math.floor(Number(body && body.adults)) || curAdults);
            const newChildren = kidsOk ? Math.max(0, Math.floor(Number(body && body.children)) || 0) : 0;
            const newParty = newAdults + newChildren;
            const curParty = curAdults + curChildren;
            const ceiling = partyCeiling(item);
            if (newParty <= curParty) {
                return NextResponse.json({ ok: false, error: 'You can only add guests here. To lower your party, message the provider or cancel and rebook.' }, { status: 400 });
            }
            if (newParty > ceiling) {
                return NextResponse.json({ ok: false, error: 'That party is outside what this experience takes (up to ' + (Number.isFinite(ceiling) ? ceiling : capacityFor(provider)) + ').' }, { status: 400 });
            }
            const delta = Math.round((partyPrice(item, newAdults, newChildren, minAge) - partyPrice(item, curAdults, curChildren, minAge)) * 100) / 100;
            if (delta <= 0) return NextResponse.json({ ok: false, error: 'That doesn’t add a charge.' }, { status: 400 });
            const extraParty = newParty - curParty;
            return await startIncreaseRequest(admin, user, order, provider, {
                attendees: extraParty, adults: Math.max(0, newAdults - curAdults), children: Math.max(0, newChildren - curChildren),
                quantity: extraParty, unit: 'flat', unitPrice: Number(item.price), price: delta,
                lineName: (order.item_name || provider.business_name || 'Your experience') + ' · ' + extraParty + ' more guest' + (extraParty === 1 ? '' : 's'),
            });
        }

        // ---- PLAIN FLAT — nothing to charge, so no request to make -------------
        if (perGroup) {
            return NextResponse.json({ ok: false, error: 'To change your party, message the provider.' }, { status: 400 });
        }

        // ---- PER-PERSON — extra places are a request (hold + accept) -----------
        const family = foldOrderFamily(order, children);
        const current = family.headcount;
        const unitPrice = Number(order.unit_price);
        const delta = wantCount - current;
        if (delta <= 0) {
            return NextResponse.json({ ok: false, error: 'You can only add places here. To lower your count, message the provider or cancel and rebook.' }, { status: 400 });
        }
        const added = orderQuantity(unit, delta);
        if (added === null) return NextResponse.json({ ok: false, error: 'You can add up to ' + MAX_ORDER_QUANTITY + '.' }, { status: 400 });
        const capMax = capacityFor(provider);
        if (wantCount > Math.max(current, capMax)) {
            return NextResponse.json({ ok: false, error: 'That’s more than this experience can take.' }, { status: 400 });
        }
        const kidsOk = childrenAllowed(providerMinAge(provider));
        const addChildren = kidsOk ? Math.min(reqChildren, added - 1) : 0;
        const addAdults = added - addChildren;
        const deltaTotal = Math.round((orderTotal(unitPrice, current + added) - orderTotal(unitPrice, current)) * 100) / 100;
        return await startIncreaseRequest(admin, user, order, provider, {
            attendees: added, adults: addAdults, children: addChildren,
            quantity: added, unit, unitPrice, price: deltaTotal,
            lineName: added > 1 ? (order.item_name || provider.business_name || 'Your experience') + ' × ' + added + ' more' : (order.item_name || provider.business_name || 'Your experience') + ' · one more',
        });
    } catch (err: any) {
        await logError('services-order-change-count-POST', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Could not change that.' }, { status: 500 });
    }
}
