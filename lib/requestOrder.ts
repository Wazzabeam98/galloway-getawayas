import { stripeRequest } from '@/lib/stripe';
import { expiryFrom } from '@/lib/serviceOrders';
import { resolveGuestForPaidOrder, supabaseGuestStore } from '@/lib/guestAccount';
import { displayName, formatTime } from '@/lib/utils';
import {
    sendEmail, emailLayout, escapeHtml, button, noteCallout, allergyCallout, SITE_URL,
    NEUTRAL_SUBTITLE, formatDate,
} from '@/lib/email';
import { logError } from '@/lib/logError';

// Builds the 'authorised' service order for a REQUEST-shape guest experience
// (a chef/baker/masseur booked against a stay) from a completed Checkout
// session, and tells the provider there is something to answer.
//
// WHY THIS IS A SHARED FUNCTION, NOT INLINE IN THE WEBHOOK. The card is held on
// request and the order row is born from checkout.session.completed. If that
// webhook never lands — a stale signing secret, a dropped delivery, a transient
// throw — no row is ever written: the provider is never told, and the hold
// quietly lapses ~7 days later with the guest thinking they booked and nothing
// anywhere for anyone to notice. The instant-slot path was hardened against the
// same fault with a reconcile sweep that asks Stripe whether the money moved and
// makes the record right. The request path now does the same — and the ONE way
// an order is created is this function, called by the webhook (the normal path)
// and by the sweep (when the webhook never landed), so the two can never drift.
//
// IDEMPOTENT ON THE HELD PAYMENTINTENT. The PaymentIntent is one-to-one with the
// order, so a session whose order already exists — the webhook ran, or an
// earlier sweep pass made it — is a no-op. That lets the sweep run beside a late
// webhook without a chef being double-booked or a card double-charged; the
// stripe_payment_intent_id unique index is the backstop if the two race the
// select.
export interface RequestOrderResult {
    created: boolean;
    orderId?: string;
    reason?: 'exists' | 'clash' | 'error';
}

export async function createRequestOrderFromSession(admin: any, cs: any): Promise<RequestOrderResult> {
    const md = (cs && cs.metadata) || {};
    if (md.kind !== 'service_order') return { created: false, reason: 'error' };

    const piId = cs.payment_intent
        ? (typeof cs.payment_intent === 'string' ? cs.payment_intent : cs.payment_intent.id)
        : null;

    // Already recorded? The held PaymentIntent is the order's fingerprint. If a
    // row carries it, the order exists (webhook, or an earlier sweep) — do
    // nothing rather than write a second.
    if (piId) {
        const { data: already } = await admin
            .from('service_orders')
            .select('id')
            .eq('stripe_payment_intent_id', piId)
            .maybeSingle();
        if (already) return { created: false, orderId: already.id, reason: 'exists' };
    }

    const { data: prov } = await admin
        .from('service_providers')
        .select('id, business_name, trade, shape, contact_email, exclusive_per_date')
        .eq('id', md.provider_id)
        .maybeSingle();

    // MINT THE GUEST BEFORE THE INSERT for a signed-out standalone booker.
    //
    // A standalone order can be placed without an account, so md.guest_id is
    // empty. But service_orders carries a CHECK
    // (service_orders_guest_present_once_paid) that a paid row MUST have a
    // guest_id — so inserting a null-guest 'authorised'/'confirmed' row is
    // rejected, and the captured/held money would be left with no record. The
    // slot path already mints from the payer email on payment; do the same here,
    // so the row always has a guest_id and the booker gets an account + receipt.
    //
    // If minting genuinely fails we do NOT write a null-guest row. We log and
    // return without cancelling: the reconcile sweep re-runs this same function
    // and will mint on the next pass (mirroring the slot path's deferred mint),
    // so a transient failure is recovered rather than dropping the booking.
    let guestId: string | null = md.guest_id || null;
    let mintedEmail: string | null = null;
    if (!guestId) {
        const payerEmail = (cs.customer_details && cs.customer_details.email) || cs.customer_email || null;
        try {
            const resolved = await resolveGuestForPaidOrder(supabaseGuestStore(admin), {
                typedEmail: md.contact_email || null,
                payerEmail,
                name: md.contact_name || null,
                phone: md.contact_phone || null,
            });
            guestId = resolved.id;
            mintedEmail = resolved.email;
        } catch (mintErr) {
            await logError(
                '[requestOrder] a standalone service order was paid but the guest account could not be minted — the reconcile sweep will retry',
                mintErr,
                { path: 'requestOrder' },
            );
            return { created: false, reason: 'error' };
        }
    }

    const { data: guest } = guestId
        ? await admin
            .from('profiles')
            .select('id, full_name, preferred_name, show_full_name, phone, email')
            .eq('id', guestId)
            .maybeSingle()
        : { data: null };

    const guestsNum = md.guests ? parseInt(md.guests, 10) : null;
    const nowIso = new Date().toISOString();

    // A MADE-TO-ORDER CART carries its lines in metadata as "itemId:qty,..." (kept
    // compact for Stripe's 500-char limit); the frozen line detail is rebuilt here
    // from the items. An all-standard cart is INSTANT (paid at once, confirmed);
    // any custom item makes it a request (held, authorised, provider answers).
    const isCart = !!md.cart;
    const instant = md.instant === '1';
    let lineItems: any[] | null = null;
    if (isCart) {
        const pairs = String(md.cart).split(',').map((s: string) => {
            const [id, q] = s.split(':');
            return { id: (id || '').trim(), qty: Math.max(1, parseInt(q, 10) || 1) };
        }).filter((p: any) => p.id);
        const ids = Array.from(new Set(pairs.map((p: any) => p.id)));
        const { data: its } = ids.length
            ? await admin.from('service_provider_items').select('id, name, unit, price, is_custom').in('id', ids)
            : { data: [] };
        const byId = new Map<string, any>((its || []).map((i: any) => [i.id, i]));
        lineItems = pairs.map((p: any) => {
            const it = byId.get(p.id);
            const up = it ? Number(it.price) : 0;
            return { item_id: p.id, name: it ? it.name : 'Item', unit: it ? it.unit : 'flat', qty: p.qty, unit_price: up, line_total: Math.round(up * p.qty * 100) / 100, is_custom: it ? !!it.is_custom : false };
        });
        // A delivery order's flat fee is its own line, so the frozen breakdown sums
        // to the amount charged (the item lines alone would fall short).
        const deliveryFee = Math.round((Number(md.delivery_fee) || 0) * 100) / 100;
        if (deliveryFee > 0) lineItems.push({ item_id: null, name: 'Delivery', unit: 'flat', qty: 1, unit_price: deliveryFee, line_total: deliveryFee, is_custom: false });
    }

    const { data: order, error: orderErr } = await admin
        .from('service_orders')
        .insert({
            provider_id: md.provider_id,
            // Always set: from the signed-in user (md.guest_id) or, for a
            // signed-out standalone booker, the account just minted above. Never
            // null on a paid row — the guest-present CHECK requires it.
            guest_id: guestId,
            listing_id: md.listing_id || null,
            booking_id: md.booking_id || null,
            // The chosen time (comes_to_you / made_to_order now carry one) and, for
            // a travelling shape, the address the provider goes to. Frozen here so
            // they never drift if the provider edits their offering later.
            service_time: md.service_time || null,
            service_address: md.service_address || null,
            fulfilment: md.fulfilment || null,
            trade: (prov && prov.trade) || null,
            // The provider's shape (comes_to_you / made_to_order), so the order
            // carries it rather than being inferred — shapeOf defaults an unset
            // shape to made_to_order, which now decides whether a guest-count
            // change is even offered. A slot never reaches this builder.
            shape: (prov && prov.shape) || null,
            // Snapshotted so the one-per-date unique index can see it (an index
            // predicate reads only its own table's columns). A chef/masseur is
            // exclusive; a baker is not.
            exclusive_per_date: !!(prov && prov.exclusive_per_date),
            service_date: md.service_date,
            guests: Number.isFinite(guestsNum as number) ? guestsNum : null,
            // Party split for an extra-guests item (blank on a plain item). The
            // head count that priced it is `attendees`, so the family fold and the
            // provider's "who's coming" read the real party.
            attendees: md.adults ? (parseInt(md.adults, 10) + (parseInt(md.children, 10) || 0)) : null,
            adults: md.adults ? parseInt(md.adults, 10) : null,
            children: md.children ? (parseInt(md.children, 10) || 0) : null,
            price: Number(cs.amount_total || 0) / 100,
            commission_rate: Number(md.commission_rate) || 0.10,
            // An all-standard cart is paid and confirmed at once; everything else is
            // held as a request until the provider answers.
            status: (isCart && instant) ? 'confirmed' : 'authorised',
            confirmed_at: (isCart && instant) ? nowIso : null,
            line_items: lineItems,
            // Profile contact when signed in; the typed/paid contact for a
            // standalone booker with no account yet (minted from this on payment).
            guest_name: displayName(guest, '') || md.contact_name || null,
            guest_phone: (guest ? guest.phone : null) || md.contact_phone || null,
            guest_email: (guest && guest.email) || mintedEmail || md.contact_email || (cs.customer_details && cs.customer_details.email) || null,
            // A made-to-order cart's free-text preferred collection/delivery time is
            // kept on the note (there is no fixed slot for food), labelled so the
            // order page and the provider read it plainly.
            note: (isCart && md.collection_note)
                ? ('Preferred ' + (md.fulfilment === 'delivery' ? 'delivery' : 'collection') + ' time: ' + md.collection_note)
                : (md.note || null),
            allergy: md.allergy || null,
            provider_business_name: prov ? prov.business_name : null,
            item_id: isCart ? null : (md.item_id || null),
            item_name: md.item_name || null,
            item_description: md.item_description || null,
            item_unit: md.item_unit || null,
            unit_price: (isCart || !md.unit_price) ? null : Number(md.unit_price),
            // quantity is NOT NULL; a cart's real breakdown is in line_items, so the
            // order-level quantity is just 1 (one order).
            quantity: isCart ? 1 : (md.quantity ? parseInt(md.quantity, 10) : 1),
            stripe_payment_intent_id: piId,
            expires_at: expiryFrom(nowIso),
            created_at: nowIso,
        })
        .select('id')
        .single();

    if (orderErr) {
        const code = (orderErr as any).code;
        const detail = String((orderErr as any).message || '') + ' ' + String((orderErr as any).details || '');
        // The PaymentIntent uniqueness index fired: the order already exists — a
        // sweep and a late webhook reached the same session at once. Not a clash,
        // no hold to release, nothing to report.
        if (code === '23505' && /payment_intent/i.test(detail)) {
            return { created: false, reason: 'exists' };
        }
        // LOST THE RACE (chefs only). Two guests can both pass the order route's
        // pre-check for a chef in the same moment; the chef-only one-per-date
        // partial unique index then lets exactly one order exist and rejects the
        // other. Release the rejected guest's hold now rather than freezing it
        // for 48 hours for nothing. A baker has no such index, so this never
        // fires for them.
        if (code === '23505') {
            if (piId) {
                try {
                    await stripeRequest('POST', '/payment_intents/' + piId + '/cancel', undefined, 'cancel-race-' + piId);
                } catch (cancelErr: any) {
                    await logError('[requestOrder] could not release a raced service-order hold', cancelErr, { path: 'requestOrder' });
                }
            }
            await logError('[requestOrder] a second guest lost the race for a date; their hold was released', orderErr, { path: 'requestOrder' });
            return { created: false, reason: 'clash' };
        }
        await logError('[requestOrder] a service order could not be recorded', orderErr, { path: 'requestOrder' });
        return { created: false, reason: 'error' };
    }

    // A rendered list of the cart's lines, for the emails below.
    const linesHtml = (lineItems && lineItems.length)
        ? '<ul style="margin:0 0 16px;padding-left:18px;font-size:15px;">' + lineItems.map((l) => '<li>' + escapeHtml(String(l.qty)) + ' × ' + escapeHtml(String(l.name)) + (l.is_custom ? ' (made to order)' : '') + ' — £' + Number(l.line_total).toFixed(2) + '</li>').join('') + '</ul>'
        : '';
    const guestTo = ((guest && guest.email) || mintedEmail || md.contact_email || (cs.customer_details && cs.customer_details.email) || '').trim();
    const totalStr = '£' + (Number(cs.amount_total || 0) / 100).toFixed(2);
    const whereWhen = ' for <strong>' + escapeHtml(formatDate(String(md.service_date))) + '</strong>'
        + (md.collection_note ? ' (' + escapeHtml(String(md.collection_note)) + ')' : '')
        + (md.fulfilment === 'delivery' && md.service_address ? ', delivered to ' + escapeHtml(String(md.service_address)) : ', for collection');

    // AN INSTANT (all-standard) FOOD ORDER — paid and confirmed at once. The guest
    // gets a receipt and the provider a new-order notice; there is nothing to answer.
    if (isCart && instant && order) {
        try {
            if (guestTo) {
                await sendEmail(guestTo, 'Your order with ' + (prov ? prov.business_name : 'your provider') + ' is confirmed', emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">Thanks — your order with <strong>' + escapeHtml((prov && prov.business_name) || 'your provider') + '</strong> is confirmed and paid' + whereWhen + '.</p>'
                    + linesHtml
                    + '<p style="margin:0 0 16px;font-size:16px;">Total paid: <strong>' + escapeHtml(totalStr) + '</strong>.</p>'
                    + allergyCallout(md.allergy) + noteCallout(md.note),
                    'You’re receiving this because you booked through Galloway Getaways.',
                    undefined, NEUTRAL_SUBTITLE));
            }
        } catch (e) { console.error('[requestOrder] instant guest receipt failed', e); }
        try {
            if (prov && prov.contact_email) {
                await sendEmail(prov.contact_email, 'A new order came in', emailLayout(
                    allergyCallout(md.allergy)
                    + '<p style="margin:0 0 16px;font-size:16px;">A guest has ordered' + whereWhen + '. It’s paid — nothing to accept.</p>'
                    + linesHtml
                    + '<p style="margin:0 0 16px;font-size:16px;">Total: <strong>' + escapeHtml(totalStr) + '</strong>, less the Galloway Getaways fee.</p>'
                    + noteCallout(md.note)
                    + button(SITE_URL + '/services/dashboard#order-' + order.id, 'See the order'),
                    'You’re receiving this because you offer experiences on Galloway Getaways.',
                    undefined, NEUTRAL_SUBTITLE));
            }
        } catch (e) { console.error('[requestOrder] instant provider notice failed', e); }
        return { created: true, orderId: order.id };
    }

    // Tell the provider there is something to answer. Best-effort: the hold is
    // placed whether or not the mail sends, and the dashboard shows it anyway.
    try {
        if (prov && prov.contact_email && order) {
            await sendEmail(
                prov.contact_email,
                md.allergy
                    ? 'A guest would like to book you — allergy noted, please read'
                    : (md.note ? 'A guest would like to book you — please read their note' : 'A guest would like to book you'),
                emailLayout(
                    allergyCallout(md.allergy)
                    + '<p>' + (md.booking_id ? 'A guest staying nearby' : 'A guest') + ' has asked to book '
                    + escapeHtml(prov.business_name || 'your experience')
                    + (md.item_name ? ' — ' + escapeHtml(String(md.item_name)) : '')
                    + ' for ' + escapeHtml(formatDate(String(md.service_date)))
                    + (md.service_time ? ' at ' + escapeHtml(formatTime(String(md.service_time))) : '')
                    + (Number.isFinite(guestsNum as number) && (guestsNum as number) > 0
                        ? ' · ' + guestsNum + ' guest' + (guestsNum === 1 ? '' : 's') : '')
                    + '.</p>'
                    + linesHtml
                    + (md.service_address ? '<p>Where: ' + escapeHtml(String(md.service_address)) + '</p>' : '')
                    + noteCallout(md.note)
                    + '<p>Their card is held, not charged. Confirm within 48 hours to '
                    + 'take the booking; if you can’t make it, decline and the hold is '
                    + 'released.</p>'
                    + button(SITE_URL + '/services/dashboard#order-' + order.id, 'View the request'),
                    'You’re receiving this because you offer experiences on Galloway Getaways.',
                    undefined, NEUTRAL_SUBTITLE
                )
            );
        }
    } catch (mailErr) {
        console.error('[requestOrder] service order notify failed', mailErr);
    }

    // Tell the GUEST their request has gone in, straight away. The provider has
    // up to 48 hours to answer, so without this the guest hears nothing after
    // paying and reasonably fears their card was charged for a booking that
    // isn't confirmed. States the held-not-charged posture plainly. Best-effort,
    // like the provider notice.
    try {
        if (guestTo) {
            const provName = (prov && prov.business_name) || 'the provider';
            await sendEmail(
                guestTo,
                'Your request has gone to ' + provName,
                emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">Thanks — your request has gone to <strong>' + escapeHtml(provName) + '</strong>'
                    + whereWhen + '.</p>'
                    + linesHtml
                    + (md.item_name && !linesHtml ? '<p style="margin:0 0 16px;font-size:15px;">' + escapeHtml(String(md.item_name)) + '</p>' : '')
                    + '<p style="margin:0 0 16px;font-size:16px;">Your card is <strong>held, not charged</strong>. '
                    + escapeHtml(provName) + ' has 48 hours to confirm — you’re only charged if they do, and the hold is released if they can’t make it.</p>'
                    + '<p style="margin:0 0 16px;font-size:16px;">Amount held: <strong>' + escapeHtml(totalStr) + '</strong>.</p>'
                    + allergyCallout(md.allergy) + noteCallout(md.note)
                    + button(SITE_URL + '/experiences/order/' + order.id, 'View your request'),
                    'You’re receiving this because you booked through Galloway Getaways.',
                    undefined, NEUTRAL_SUBTITLE
                )
            );
        }
    } catch (guestMailErr) {
        console.error('[requestOrder] guest request confirmation failed', guestMailErr);
    }

    return { created: true, orderId: order.id };
}
