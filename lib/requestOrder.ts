import { stripeRequest } from '@/lib/stripe';
import { expiryFrom } from '@/lib/serviceOrders';
import { displayName } from '@/lib/utils';
import {
    sendEmail, emailLayout, escapeHtml, button, noteCallout, allergyCallout, SITE_URL,
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
        .select('id, business_name, trade, contact_email, exclusive_per_date')
        .eq('id', md.provider_id)
        .maybeSingle();

    const { data: guest } = md.guest_id
        ? await admin
            .from('profiles')
            .select('id, full_name, preferred_name, show_full_name, phone, email')
            .eq('id', md.guest_id)
            .maybeSingle()
        : { data: null };

    const guestsNum = md.guests ? parseInt(md.guests, 10) : null;
    const nowIso = new Date().toISOString();

    const { data: order, error: orderErr } = await admin
        .from('service_orders')
        .insert({
            provider_id: md.provider_id,
            // Present today: the request shape is login-gated (order/route.ts
            // sets guest_id from the signed-in user), so the reconcile has it
            // from the same session metadata the webhook reads.
            guest_id: md.guest_id || null,
            listing_id: md.listing_id || null,
            booking_id: md.booking_id || null,
            trade: (prov && prov.trade) || null,
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
            status: 'authorised',
            guest_name: displayName(guest, '') || null,
            guest_phone: guest ? guest.phone : null,
            guest_email: (guest && guest.email) || (cs.customer_details && cs.customer_details.email) || null,
            note: md.note || null,
            allergy: md.allergy || null,
            provider_business_name: prov ? prov.business_name : null,
            item_id: md.item_id || null,
            item_name: md.item_name || null,
            item_description: md.item_description || null,
            item_unit: md.item_unit || null,
            unit_price: md.unit_price ? Number(md.unit_price) : null,
            quantity: md.quantity ? parseInt(md.quantity, 10) : 1,
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
                    + '<p>A guest staying nearby has asked to book '
                    + escapeHtml(prov.business_name || 'your experience')
                    + (md.item_name ? ' — ' + escapeHtml(String(md.item_name)) : '')
                    + ' for ' + escapeHtml(String(md.service_date))
                    + (Number.isFinite(guestsNum as number) && (guestsNum as number) > 0
                        ? ' · ' + guestsNum + ' guest' + (guestsNum === 1 ? '' : 's') : '')
                    + '.</p>'
                    + noteCallout(md.note)
                    + '<p>Their card is held, not charged. Confirm within 48 hours to '
                    + 'take the booking; if you can’t make it, decline and the hold is '
                    + 'released.</p>'
                    + button(SITE_URL + '/services/dashboard#order-' + order.id, 'View the request'),
                    'You’re receiving this because you offer experiences on Galloway Getaways.'
                )
            );
        }
    } catch (mailErr) {
        console.error('[requestOrder] service order notify failed', mailErr);
    }

    return { created: true, orderId: order.id };
}
