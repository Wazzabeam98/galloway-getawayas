import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import {
    isLiveToGuests, priceOrder, guestExperiencesOpen, exclusivePerDate,
    normaliseUnit, unitMultiplies, unitNoun, orderQuantity, orderTotal, MAX_ORDER_QUANTITY,
} from '@/lib/serviceOrders';
import { dateFromKey, dateKey } from '@/lib/pricing';
import { hasExtraGuests, partyPrice, partyCeiling } from '@/lib/extraGuests';
import { childrenAllowed } from '@/lib/guestAges';
import { itemTravels } from '@/lib/serviceProviders';
import { offeredTimes as providerOfferedTimes, isOfferedTime, normaliseTime } from '@/lib/offeredTimes';
import { displayName } from '@/lib/utils';
import { withinLimits, callerAddress } from '@/lib/rateLimit';
import { hasUkPostcode } from '@/lib/postcode';
import { deliveryAreaForAddress } from '@/lib/postcodeGeocode';

export const dynamic = 'force-dynamic';

// A guest asking a provider for an experience during their stay.
//
// AUTHORISE ON REQUEST, CAPTURE ON CONFIRM. This starts a Checkout Session with
// the card HELD, not charged (capture_method: manual). The money is taken only
// when the provider confirms they can do it — see services/orders/confirm — and
// the hold is released, untaken, if they decline or never answer. A guest is
// not made to pay for a chef who has not agreed, and a chef is not made to hold
// an evening for a guest who has not committed.
//
// THE PROVIDER IS THE MERCHANT OF RECORD. The charge is on_behalf_of the
// provider's own connected account, settled to it (transfer_data.destination),
// and our 10% is an application fee — not a markup. The guest is paying the
// provider; we are the platform taking payment for them. That is the whole
// liability posture, and it lives in these four Stripe fields.
//
// Nothing about the money is trusted from the browser: the price is the
// provider's own, read here, and the guest count comes off the booking the
// guest already made rather than being retyped.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // May be null: a brand-new guest booking a STANDALONE experience (no stay)
        // need not sign in first — Stripe collects the email and the account is
        // minted from the payer email on the webhook, exactly as the slot path
        // does. An against-a-stay booking still requires the signed-in owner.
        const { data: { user } } = await supabase.auth.getUser();

        // The lock. Closed until launch, and enforced here rather than only in
        // the UI, so a direct POST is refused the same as a hidden button —
        // whatever the provider's state.
        if (!guestExperiencesOpen()) {
            return NextResponse.json(
                { ok: false, error: 'Guest experiences aren’t open yet.' },
                { status: 403 }
            );
        }

        const body = await request.json().catch(function () { return {}; });
        // The guest picks an ITEM off the menu now, not a provider. The provider
        // and the price both come from the item — never the browser.
        const itemId: string = body && body.itemId;
        // How many units, for a per-person / per-night / per-item price. The
        // browser sends what the guest typed; it is validated against the item's
        // unit below, never trusted as the multiplier on its own.
        const requestedQuantity: unknown = body && body.quantity;
        const bookingId: string = body && body.bookingId;
        const serviceDate: string = body && body.serviceDate;
        // The chosen time (HH:MM) — validated against the provider's offered times
        // below. Optional for a provider who has named none (backwards-compatible).
        const requestedTime: string = normaliseTime(body && body.serviceTime) || '';
        const note: string = (body && body.note ? String(body.note) : '').slice(0, 500);
        // A food order's stated allergy/dietary need. Its own field, not folded
        // into note, so it can be routed on its own — flagged in the email and
        // shown as its own badge — and so "no allergy" reads as a real answer.
        const allergy: string = (body && body.allergy ? String(body.allergy) : '').slice(0, 500);
        // Typed contact for an anonymous standalone booker; ignored when signed in.
        const typedName: string = (body && body.guestName ? String(body.guestName) : '').slice(0, 120).trim();
        const typedEmail: string = (body && body.guestEmail ? String(body.guestEmail) : '').slice(0, 200).trim().toLowerCase();
        const typedPhone: string = (body && body.guestPhone ? String(body.guestPhone) : '').slice(0, 40).trim();

        // A made-to-order CART sends `items` instead of a single `itemId`.
        const hasCart = Array.isArray(body && body.items) && body.items.length > 0;
        if (!serviceDate || (!itemId && !hasCart)) {
            return NextResponse.json({ ok: false, error: 'Missing details' }, { status: 400 });
        }

        // STANDALONE (no stay) vs against-a-stay. Standalone needs no booking: the
        // party is capped by the item's own maximum, the date by the provider's
        // horizon, and a travelling shape asks for an address. An against-a-stay
        // booking is validated and owned exactly as before.
        const standalone = !bookingId;
        const anonymous = standalone && !user;
        if (!standalone && !user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }
        if (anonymous) {
            const verdict = await withinLimits([
                { bucket: 'guest-order:ip', key: callerAddress(request.headers), max: 20, windowMinutes: 60 },
            ]);
            if (!verdict.ok) {
                return NextResponse.json({ ok: false, error: 'That’s a lot of attempts in a short time. Try again shortly.' }, { status: 429 });
            }
        }

        const admin = adminClient();

        // The booking (against-a-stay only) is the guest's own, and it is where the
        // dates, the place and the guest count come from — never the browser.
        let booking: any = null;
        if (!standalone) {
            const { data } = await admin
                .from('bookings')
                .select('id, guest_id, listing_id, check_in, check_out, guests, status')
                .eq('id', bookingId)
                .maybeSingle();
            if (!data) {
                return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
            }
            if (data.guest_id !== user!.id) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }
            booking = data;
        }

        // ---- MADE-TO-ORDER CART -------------------------------------------------
        // A food order is a CART: several items, each with a quantity, in one order
        // and one payment. If every item is STANDARD the order books and charges
        // instantly (auto-capture, confirmed on the webhook, no provider step);
        // if any item is CUSTOM the whole order is a REQUEST — the card is held and
        // the provider accepts or declines. No time picker (a free-text preferred
        // collection/delivery time instead) and no party size.
        const cartRaw = Array.isArray(body && body.items) ? body.items : null;
        if (cartRaw && cartRaw.length) {
            const wanted = cartRaw
                .map((r: any) => ({ id: String((r && r.itemId) || ''), qty: Math.max(1, Math.min(MAX_ORDER_QUANTITY, Math.floor(Number(r && r.qty) || 0))) }))
                .filter((r: any) => r.id && r.qty > 0);
            if (!wanted.length) return NextResponse.json({ ok: false, error: 'Add at least one item.' }, { status: 400 });
            if (wanted.length > 20) return NextResponse.json({ ok: false, error: 'That’s a very large order — message the provider directly.' }, { status: 400 });

            const ids = Array.from(new Set(wanted.map((w: any) => w.id)));
            const { data: cartItems } = await admin.from('service_provider_items')
                .select('id, provider_id, name, description, price, active, unit, fulfilment, is_custom')
                .in('id', ids);
            if (!cartItems || !cartItems.length) return NextResponse.json({ ok: false, error: 'Those items aren’t available.' }, { status: 400 });
            const providerId = cartItems[0].provider_id;
            if (cartItems.some((i: any) => i.provider_id !== providerId)) return NextResponse.json({ ok: false, error: 'One provider per order.' }, { status: 400 });
            const byId = new Map<string, any>(cartItems.map((i: any) => [i.id, i]));

            const { data: prov } = await admin.from('service_providers')
                .select('id, business_name, trade, shape, fulfilment, lead_time_days, delivery_fee, status, stripe_account_id, stripe_payouts_enabled, plan, commission_rate, guest_details')
                .eq('id', providerId).maybeSingle();
            if (!prov || prov.shape !== 'made_to_order' || !isLiveToGuests(prov) || !prov.stripe_account_id) {
                return NextResponse.json({ ok: false, error: 'That experience isn’t available.' }, { status: 400 });
            }

            // The lines, priced here (qty × the provider's own price) — never trusted
            // from the browser. Any custom item turns the whole order into a request.
            const lines: any[] = [];
            let total = 0, hasCustom = false;
            for (const w of wanted) {
                const it = byId.get(w.id);
                if (!it || it.active !== true || !(Number(it.price) > 0)) return NextResponse.json({ ok: false, error: 'One of those items isn’t available.' }, { status: 400 });
                const up = Number(it.price);
                const lineTotal = Math.round(up * w.qty * 100) / 100;
                lines.push({ item_id: it.id, name: it.name, unit: normaliseUnit(it.unit), qty: w.qty, unit_price: up, line_total: lineTotal, is_custom: !!it.is_custom });
                total += lineTotal;
                if (it.is_custom) hasCustom = true;
            }
            total = Math.round(total * 100) / 100;
            if (total <= 0) return NextResponse.json({ ok: false, error: 'That order has no cost.' }, { status: 400 });

            // The service (collection/delivery) date, same bounds as any request.
            // The provider's notice period is the floor for BOTH shapes — a made-to-
            // order cake needs its notice whether it's booked standalone or against a
            // stay, so the earliest date is today+notice, not merely "during the stay".
            const whenC = dateFromKey(serviceDate);
            const nowC = new Date();
            const addDaysC = (n: number) => { const d = new Date(nowC); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d; };
            const leadDaysC = Math.max(0, Number(prov.lead_time_days) || 0);
            if (whenC < addDaysC(leadDaysC)) return NextResponse.json({ ok: false, error: 'That date is inside the notice period — please pick a later one.' }, { status: 400 });
            if (standalone) {
                const horizon = Math.max(1, Math.min(365, Number(prov.guest_details && (prov.guest_details as any).booking_horizon_days) || 90));
                if (whenC > addDaysC(horizon)) return NextResponse.json({ ok: false, error: 'Pick a date within the booking window.' }, { status: 400 });
            } else {
                const start = dateFromKey(booking.check_in), end = dateFromKey(booking.check_out);
                if (whenC < start || whenC >= end) return NextResponse.json({ ok: false, error: 'Pick a date during your stay.' }, { status: 400 });
            }

            // Delivery travels to an address; collection does not. A provider fixed to
            // one honours that; a "both" provider takes the guest's choice from the
            // basket. The preferred time is FREE TEXT (no fixed slots for food).
            const chosenDelivery = String(body && body.fulfilment) === 'delivery';
            const travelsC = prov.fulfilment === 'delivery' || (prov.fulfilment === 'both' && chosenDelivery);
            let addressC: string | null = null;
            if (travelsC) {
                if (standalone) {
                    addressC = (body && body.serviceAddress ? String(body.serviceAddress) : '').slice(0, 300).trim() || null;
                    if (!addressC || !hasUkPostcode(addressC)) return NextResponse.json({ ok: false, error: 'Add a full delivery address, including a postcode.' }, { status: 400 });
                    // Delivery only goes where the provider delivers: within Dumfries
                    // & Galloway. A typed address outside it — or one we can't place —
                    // is refused here on the server, not just greyed out on the page.
                    const area = await deliveryAreaForAddress(addressC);
                    if (area !== 'in') return NextResponse.json({ ok: false, error: area === 'out'
                        ? `Sorry — ${prov.business_name || 'this provider'} only delivers within Dumfries & Galloway.`
                        : 'We couldn’t place that postcode. Check it, or arrange collection instead.' }, { status: 400 });
                } else if (booking.listing_id) {
                    const { data: stay } = await admin.from('listings').select('street_address, postcode, location').eq('id', booking.listing_id).maybeSingle();
                    if (stay) addressC = [stay.street_address, stay.postcode, stay.location].filter(Boolean).join(', ') || null;
                }
            }
            const collectionNote = (body && body.collectionTime ? String(body.collectionTime) : '').slice(0, 200).trim();

            const contactNameC = anonymous ? (typedName || null) : null;
            const contactEmailC = anonymous ? (typedEmail || null) : (user ? user.email || null : null);
            const contactPhoneC = anonymous ? (typedPhone || null) : null;

            // A delivery order carries the provider's flat delivery fee, charged
            // once on top of the lines and passed to the provider like the rest.
            const deliveryFeeC = travelsC ? Math.round((Math.max(0, Number(prov.delivery_fee) || 0)) * 100) / 100 : 0;
            const grandTotalC = Math.round((total + deliveryFeeC) * 100) / 100;
            const pricingC = priceOrder(prov, { bandPrice: grandTotalC }, []);
            const businessC = prov.business_name || 'Your order';
            const cartMeta = wanted.map((w: any) => w.id + ':' + w.qty).join(',');
            const summaryName = lines.length === 1 && lines[0].qty === 1 ? lines[0].name : (businessC + ' order');
            const mdC: Record<string, string> = {
                kind: 'service_order',
                provider_id: providerId,
                booking_id: standalone ? '' : booking.id,
                guest_id: user ? user.id : '',
                listing_id: standalone ? '' : (booking.listing_id || ''),
                service_date: dateKey(whenC),
                service_time: '',
                service_address: addressC || '',
                fulfilment: travelsC ? 'delivery' : 'collection',
                standalone: standalone ? '1' : '',
                contact_name: contactNameC || '',
                contact_email: contactEmailC || '',
                contact_phone: contactPhoneC || '',
                instant: hasCustom ? '' : '1',
                cart: cartMeta,
                delivery_fee: deliveryFeeC > 0 ? String(deliveryFeeC) : '',
                collection_note: collectionNote,
                commission_rate: String(pricingC.commissionRate),
                note: note,
                allergy: allergy,
                item_name: summaryName,
                item_unit: 'order',
            };
            const stripeLines = lines.map((l) => ({
                quantity: l.qty,
                price_data: { currency: 'gbp', unit_amount: Math.round(l.unit_price * 100),
                    product_data: { name: l.name + (l.is_custom ? ' (made to order)' : '') } },
            }));
            if (deliveryFeeC > 0) stripeLines.push({
                quantity: 1,
                price_data: { currency: 'gbp', unit_amount: Math.round(deliveryFeeC * 100), product_data: { name: 'Delivery' } },
            });
            const checkoutC = await stripeRequest('POST', '/checkout/sessions', {
                mode: 'payment',
                customer_email: user ? user.email : (contactEmailC || undefined),
                payment_method_types: ['card'],
                line_items: stripeLines,
                custom_text: { submit: { message: 'Galloway Getaways takes this payment on behalf of ' + businessC + '. We are the booking agent, not the provider.' } },
                payment_intent_data: {
                    // Standard-only orders capture at once; a custom order is HELD
                    // until the provider accepts.
                    capture_method: hasCustom ? 'manual' : 'automatic',
                    on_behalf_of: prov.stripe_account_id,
                    application_fee_amount: pricingC.applicationFeePence,
                    transfer_data: { destination: prov.stripe_account_id },
                    description: 'Galloway food order — ' + businessC + (hasCustom ? ' (request)' : ''),
                    metadata: mdC,
                },
                success_url: SITE_URL + (hasCustom ? '/experiences/requested?p=' + providerId : '/trips?experience=booked'),
                cancel_url: SITE_URL + (standalone ? '/experiences/browse/' + providerId + '?experience=cancelled' : '/trips?experience=cancelled'),
                metadata: mdC,
            });
            return NextResponse.json({ ok: true, url: checkoutC.url, instant: !hasCustom, requested: hasCustom });
        }

        // The item is the source of the price. Active and priced, or it is not
        // for sale — the same gate the menu applies, enforced here too.
        const { data: item } = await admin
            .from('service_provider_items')
            .select('id, provider_id, name, description, price, active, unit, fulfilment, included_guests, extra_adult_fee, extra_child_fee, max_party, min_people')
            .eq('id', itemId)
            .maybeSingle();

        if (!item || item.active !== true || !(Number(item.price) > 0)) {
            return NextResponse.json({ ok: false, error: 'That item isn’t available.' }, { status: 400 });
        }

        // The unit decides whether a quantity even applies, and the quantity is
        // validated against it — a flat price is always one, a rate is a whole
        // number from one up to the cap. Out of range is refused, not clamped:
        // charging for the cap when someone typed past it would be a surprise on
        // their card, and a genuinely large order is a phone call.
        const unit = normaliseUnit(item.unit);
        const quantity = orderQuantity(unit, unitMultiplies(unit) ? requestedQuantity : 1);
        if (quantity === null) {
            return NextResponse.json(
                {
                    ok: false,
                    error: 'Choose how many, up to ' + MAX_ORDER_QUANTITY
                        + '. For anything larger, message the provider directly.',
                },
                { status: 400 }
            );
        }
        const unitPrice = Number(item.price);

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, business_name, trade, shape, fulfilment, lead_time_days, status, stripe_account_id, stripe_payouts_enabled, plan, commission_rate, exclusive_per_date, guest_details')
            .eq('id', item.provider_id)
            .maybeSingle();

        // EXTRA-GUESTS PRICING + PARTY CAP. A flat item with extra-guests pricing
        // charges the party (base for the included number, per-head fees beyond
        // it); a plain item is unit price × quantity. Either way the party can
        // never exceed the item's max, nor the STAY's own guest count — an
        // experience can't seat more than are staying.
        const minAge = provider && provider.guest_details && (provider.guest_details as any).min_age != null
            ? Number((provider.guest_details as any).min_age) : null;
        const reqAdults = Math.max(0, Math.floor(Number(body && body.adults) || 0));
        const reqChildrenRaw = Math.max(0, Math.floor(Number(body && body.children) || 0));
        // The party ceiling: the item's own maximum. A COMES-TO-YOU experience (a
        // chef, a masseur coming to the cottage) can be for visitors as well as
        // those staying, so it is NOT capped by the stay's guest count — the same
        // rule the change-count route and the booking dialog use. Any other
        // against-a-stay shape is still bounded by who is staying.
        const providerMax = provider && provider.guest_details && (provider.guest_details as any).max_guests != null
            ? Number((provider.guest_details as any).max_guests) : Infinity;
        const stayCap = (standalone || (provider && provider.shape === 'comes_to_you')) ? Infinity : (Number(booking.guests) || Infinity);
        let total: number;
        if (hasExtraGuests(item)) {
            const adults = Math.max(1, reqAdults || 1);
            const children = childrenAllowed(minAge) ? reqChildrenRaw : 0;
            const party = adults + children;
            const cap = Math.min(partyCeiling(item), stayCap);
            if (party > cap) {
                return NextResponse.json({ ok: false, error: 'That’s more guests than this experience takes (up to ' + cap + ').' }, { status: 400 });
            }
            total = partyPrice(item as any, adults, children, minAge);
        } else {
            const cap = Math.min(stayCap, providerMax || Infinity);
            // The item's smallest party (min_people). A private chef set to a
            // minimum of two can't be booked for one — refused here, not only held
            // out of the stepper.
            const floor = unitMultiplies(unit) ? Math.max(1, Number((item as any).min_people) || 1) : 1;
            if (unitMultiplies(unit) && quantity < floor) {
                return NextResponse.json({ ok: false, error: 'This experience takes a minimum of ' + floor + ' guests.' }, { status: 400 });
            }
            if (unitMultiplies(unit) && quantity > cap) {
                return NextResponse.json({ ok: false, error: standalone ? ('That’s more than this experience takes (up to ' + cap + ').') : ('That’s more than the ' + cap + ' staying — book for your party size.') }, { status: 400 });
            }
            total = orderTotal(unitPrice, quantity);
        }

        // A provider a guest may not buy from must never be reachable here, not
        // only hidden from the surface — the gate is enforced, not decorative.
        if (!provider || !isLiveToGuests(provider) || !provider.stripe_account_id) {
            return NextResponse.json({ ok: false, error: 'That experience isn’t available.' }, { status: 400 });
        }

        // The service date. Against a stay it must fall inside it (check_out is the
        // morning the guest leaves, so the last night is the day before). Standalone
        // it must sit within the provider's booking horizon and honour its lead time
        // (a cake needs notice; a chef can be as soon as tomorrow).
        const when = dateFromKey(serviceDate);
        if (standalone) {
            const now = new Date();
            const addDays = (n: number) => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d; };
            // The provider's notice period is the earliest a date can be picked, for a
            // comes-to-you chef as much as a made-to-order baker (a made-to-order has a
            // floor of one day; a chef can be same-notice-as-set, down to zero).
            const leadDays = provider.shape === 'made_to_order'
                ? Math.max(1, Number(provider.lead_time_days) || 1)
                : Math.max(0, Number(provider.lead_time_days) || 0);
            const horizon = Math.max(1, Math.min(365, Number(provider.guest_details && (provider.guest_details as any).booking_horizon_days) || 90));
            if (when < addDays(leadDays) || when > addDays(horizon)) {
                return NextResponse.json({ ok: false, error: 'Pick a date within the booking window.' }, { status: 400 });
            }
        } else {
            const start = dateFromKey(booking.check_in);
            const end = dateFromKey(booking.check_out);
            if (when < start || when >= end) {
                return NextResponse.json({ ok: false, error: 'Pick a date during your stay.' }, { status: 400 });
            }
        }

        // The TIME.
        //
        // A COMES-TO-YOU provider's times come from its weekly OPENING HOURS — the
        // single place a provider sets the hours they work (the offered-times field
        // is gone). The picked time must fall inside an open window for that weekday,
        // and the day must not be blocked off. A provider who set no hours yet falls
        // back to any named offered_times (legacy), or to no time at all.
        //
        // Every other shape keeps the offered-times rule: pick one if any are named.
        const offered = providerOfferedTimes(provider.guest_details);
        let serviceTime: string | null = null;
        const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
        if (provider.shape === 'comes_to_you') {
            const [{ data: availRows }, { data: dayBlocks }] = await Promise.all([
                admin.from('slot_availability').select('day_of_week, open_time, close_time').eq('provider_id', provider.id),
                admin.from('slot_blocks').select('blocked_date').eq('provider_id', provider.id).eq('blocked_date', dateKey(when)),
            ]);
            const hours = availRows || [];
            if (hours.length) {
                if (dayBlocks && dayBlocks.length) {
                    return NextResponse.json({ ok: false, error: 'They’re not available that day — try another date.' }, { status: 409 });
                }
                if (!requestedTime) {
                    return NextResponse.json({ ok: false, error: 'Pick a time.' }, { status: 400 });
                }
                const dow = new Date(dateKey(when) + 'T00:00:00Z').getUTCDay();
                const tMin = toMin(requestedTime);
                const open = hours.some((w: any) => Number(w.day_of_week) === dow && tMin >= toMin(w.open_time) && tMin < toMin(w.close_time));
                if (!open) {
                    return NextResponse.json({ ok: false, error: 'They’re not open at that time — pick another.' }, { status: 400 });
                }
                serviceTime = requestedTime;
            } else if (offered.length) {
                if (!requestedTime || !isOfferedTime(provider.guest_details, requestedTime)) {
                    return NextResponse.json({ ok: false, error: 'Pick a time.' }, { status: 400 });
                }
                serviceTime = requestedTime;
            } else if (requestedTime) {
                serviceTime = requestedTime;
            }
        } else if (offered.length) {
            if (!requestedTime || !isOfferedTime(provider.guest_details, requestedTime)) {
                return NextResponse.json({ ok: false, error: 'Pick a time.' }, { status: 400 });
            }
            serviceTime = requestedTime;
        } else if (requestedTime) {
            serviceTime = requestedTime;
        }

        // The address, for a shape that TRAVELS to the guest: a comes-to-you chef,
        // or a made-to-order delivery. Standalone the guest types it; against a stay
        // it is the cottage, composed server-side from the owned booking's listing.
        const travels = provider.shape === 'comes_to_you' || itemTravels(item as any, provider.fulfilment);
        let serviceAddress: string | null = null;
        if (travels) {
            if (standalone) {
                serviceAddress = (body && body.serviceAddress ? String(body.serviceAddress) : '').slice(0, 300).trim() || null;
                if (!serviceAddress || !hasUkPostcode(serviceAddress)) {
                    return NextResponse.json({ ok: false, error: 'Add a full address, including a postcode, for the provider to come to.' }, { status: 400 });
                }
                // A travelling provider only comes to Dumfries & Galloway — the same
                // council-area gate, enforced server-side on the typed address.
                const area = await deliveryAreaForAddress(serviceAddress);
                if (area !== 'in') return NextResponse.json({ ok: false, error: area === 'out'
                    ? `Sorry — ${provider.business_name || 'this provider'} only travels within Dumfries & Galloway.`
                    : 'We couldn’t place that postcode. Check it and try again.' }, { status: 400 });
            } else if (booking.listing_id) {
                const { data: stay } = await admin.from('listings')
                    .select('street_address, postcode, location').eq('id', booking.listing_id).maybeSingle();
                if (stay) serviceAddress = [stay.street_address, stay.postcode, stay.location].filter(Boolean).join(', ') || null;
            }
        }

        // The buyer's contact for an anonymous standalone booker (no profile yet).
        // Ignored when signed in — the profile / minted account is the source then.
        const contactName = anonymous ? (typedName || null) : null;
        const contactEmail = anonymous ? (typedEmail || null) : (user ? user.email || null : null);
        const contactPhone = anonymous ? (typedPhone || null) : null;

        // One booking per date — but ONLY for a provider the owner has marked
        // exclusive (a chef, a masseur). They cannot be in two cottages at once,
        // so a second live order for the date is a clash. A baker bakes many
        // cakes for one Saturday, a hamper maker many hampers, so for them a
        // second order is fine. exclusivePerDate reads the per-provider flag; the
        // partial unique index (20260902090000) enforces the same as the hard
        // guard behind this courtesy.
        if (exclusivePerDate(provider)) {
            const { data: clash } = await admin
                .from('service_orders')
                .select('id')
                .eq('provider_id', provider.id)
                .eq('service_date', dateKey(when))
                .in('status', ['authorised', 'confirmed'])
                .limit(1);

            if (clash && clash.length > 0) {
                return NextResponse.json(
                    { ok: false, error: 'Someone’s already booked them for that evening — try another night of your stay.' },
                    { status: 409 }
                );
            }
        }

        // The TOTAL is what Stripe holds and what the 10% fee is taken from, so
        // it is what priceOrder is handed. unit price × quantity, computed here
        // and never trusted from the browser.
        const pricing = priceOrder(provider, { bandPrice: total }, []);

        const business = (provider.business_name || 'Your experience');
        const itemName = (item.name || business);
        // What the checkout line reads: "Celebration cake × 3 people". The bare
        // item name for a flat price or a quantity of one.
        const lineName = quantity > 1
            ? itemName + ' × ' + quantity + ' ' + unitNoun(unit) + (quantity === 1 ? '' : 's')
            : itemName;

        // The order's whole shape, put on BOTH the session and the held
        // PaymentIntent. The webhook builds the order from the session; the
        // reconcile sweep — for when that webhook never lands — has only the
        // PaymentIntent to go on, so it must carry the same detail. Same 50-key /
        // 500-char Stripe metadata limits either way, so this adds no new risk
        // over what the session already carried. One object, so the two can
        // never drift.
        const orderMetadata: Record<string, string> = {
            kind: 'service_order',
            provider_id: provider.id,
            booking_id: standalone ? '' : booking.id,
            guest_id: user ? user.id : '',
            listing_id: standalone ? '' : (booking.listing_id || ''),
            service_date: dateKey(when),
            service_time: serviceTime || '',
            service_address: serviceAddress || '',
            fulfilment: travels ? 'delivery' : 'collection',
            standalone: standalone ? '1' : '',
            contact_name: contactName || '',
            contact_email: contactEmail || '',
            contact_phone: contactPhone || '',
            // For an extra-guests item the party IS the priced head count; record
            // it (and its split) so the webhook writes the real party, not the
            // whole-stay number.
            guests: String(hasExtraGuests(item) ? (Math.max(1, reqAdults || 1) + (childrenAllowed(minAge) ? reqChildrenRaw : 0)) : (standalone ? (unitMultiplies(unit) ? quantity : '') : (booking.guests ?? ''))),
            adults: hasExtraGuests(item) ? String(Math.max(1, reqAdults || 1)) : '',
            children: hasExtraGuests(item) ? String(childrenAllowed(minAge) ? reqChildrenRaw : 0) : '',
            commission_rate: String(pricing.commissionRate),
            note: note,
            allergy: allergy,
            item_id: item.id,
            item_name: itemName,
            item_description: item.description || '',
            item_unit: unit,
            unit_price: String(unitPrice),
            quantity: String(quantity),
        };

        const checkout = await stripeRequest('POST', '/checkout/sessions', {
            mode: 'payment',
            customer_email: user ? user.email : (contactEmail || undefined),
            payment_method_types: ['card'],
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: 'gbp',
                        unit_amount: pricing.amountPence,
                        product_data: {
                            // The item they picked, so the checkout shows what
                            // they are buying; whose it is and the liability line
                            // are in the description, not buried.
                            name: lineName,
                            description: 'Booked with ' + business
                                + '. Galloway Getaways takes the payment on their behalf and is not the provider.',
                        },
                    },
                },
            ],
            // The agent-not-provider line, right above the Pay button so a guest
            // genuinely reads it before authorising — not only in the item description.
            custom_text: {
                submit: {
                    message: 'Galloway Getaways takes this payment on behalf of ' + business + '. We are the booking agent, not the provider of the experience.',
                },
            },
            payment_intent_data: {
                // The hold. Captured only when the provider confirms.
                capture_method: 'manual',
                // The provider is the merchant of record; our cut is a fee.
                on_behalf_of: provider.stripe_account_id,
                application_fee_amount: pricing.applicationFeePence,
                transfer_data: { destination: provider.stripe_account_id },
                description: 'Galloway experience — ' + business + ' · ' + itemName,
                // The full order shape on the held PaymentIntent, so the sweep
                // can rebuild the order from Stripe alone if the webhook is lost.
                metadata: orderMetadata,
            },
            // A real "request sent" moment — held-not-charged, what happens next
            // — instead of a banner on /trips. The order row is written by the
            // webhook, so this page confirms the act and needs only the provider.
            success_url: SITE_URL + '/experiences/requested?p=' + provider.id,
            cancel_url: SITE_URL + (standalone ? '/experiences/browse/' + provider.id + '?experience=cancelled' : '/trips?experience=cancelled'),
            metadata: orderMetadata,
        });

        return NextResponse.json({ ok: true, url: checkout.url });
    } catch (err: any) {
        console.error('[services/order]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not start that' },
            { status: 500 }
        );
    }
}
