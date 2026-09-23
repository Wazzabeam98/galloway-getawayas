import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';

// Turn a paid-but-held CHANGE REQUEST (extra places on a comes_to_you booking)
// from 'holding' into 'authorised' — the state the provider answers within 48
// hours. This is the ONE place that transition lives, so the webhook (the normal
// path) and the reconcile sweep (when that webhook is lost) can never drift:
// both call this with the held PaymentIntent's id and its metadata.order_id.
//
// Idempotent: the update is guarded on status = 'holding', so a redelivery or a
// sweep that runs beside a late webhook is a no-op. No money moves here — the
// card is only held; respond captures on accept, or the service-orders cron
// releases an unanswered hold.
export async function authoriseChangeRequest(
    admin: { from: (t: string) => any },
    orderId: string,
    piId: string,
): Promise<{ authorised: boolean }> {
    if (!orderId || !piId) return { authorised: false };
    const { data: rows } = await admin.from('service_orders')
        .update({ status: 'authorised', stripe_payment_intent_id: piId, expires_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString() })
        .eq('id', orderId).eq('status', 'holding')
        .select('id, provider_id, quantity, item_name, service_date, price');
    const child = rows && rows[0];
    if (!child) return { authorised: false };

    try {
        const { data: prov } = await admin.from('service_providers').select('business_name, contact_email').eq('id', child.provider_id).maybeSingle();
        if (prov && prov.contact_email) {
            await sendEmail(prov.contact_email, 'A guest wants to add to a booking', emailLayout(
                '<p>A guest has asked to add ' + (child.quantity || 1) + ' more to their ' + escapeHtml(child.item_name || 'booking')
                + ' on ' + escapeHtml(String(child.service_date).slice(0, 10)) + '. Their card is held for £' + Number(child.price || 0).toFixed(2)
                + ', not charged — accept within 48 hours to take it, or decline to release it.</p>'
                + button(SITE_URL + '/services/dashboard', 'Answer the request'),
                'You’re receiving this because you offer experiences on Galloway Getaways.'));
        }
    } catch (e) { console.error('[changeRequest] notify', e); }

    return { authorised: true };
}
