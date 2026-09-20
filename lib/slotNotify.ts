// Telling both sides when an ADDED place (a per-person slot top-up) is
// confirmed. One helper, called from the two places a hold turns into a
// confirmed order: the Stripe webhook, and the reconcile sweep — which confirms
// a paid-but-webhook-lost order SILENTLY today, so a top-up settled that way
// would raise the party with nobody told. Both call this, so they cannot drift.
//
// A top-up is NOT a new booking, so it does not send the "new booking" emails;
// it sends the count-went-up ones, with the new party size and the new family
// total. Best-effort throughout: a mail failure is logged, never thrown — the
// money and the seats are already settled by the time this runs.
//
// Relative imports on purpose, matching lib/experienceCancel.ts: this may be
// exercised by a unit test, and the '@/' alias is a build-time path Node cannot
// resolve at runtime.
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from './email';
import { foldOrderFamily } from './orderFamily';

// A confirmed top-up child order, as the webhook / sweep hands it over. Only the
// fields the emails need.
export interface ConfirmedTopUp {
    id: string;
    parent_order_id: string;
    provider_id: string;
    service_date: string | null;
    service_time: string | null;
    item_name: string | null;
    provider_business_name: string | null;
    quantity: number | null;   // the ADDED places on this child
    price: number | null;      // the delta charged on this child
    guest_email: string | null;
}

function timeLabel(t: string | null): string {
    return t ? ' at ' + String(t).slice(0, 5) : '';
}

/**
 * Notify the provider and the payer that added places are confirmed. `admin` is
 * the service-role client. Safe to call more than once only if the caller
 * guarded on a fresh confirm — this sends every time it is invoked.
 */
export async function notifyTopUpConfirmed(admin: any, child: ConfirmedTopUp): Promise<void> {
    const added = Number(child.quantity) || 1;
    const placeWord = added === 1 ? 'place' : 'places';
    const date = escapeHtml(String(child.service_date || ''));
    const when = date + escapeHtml(timeLabel(child.service_time));
    const business = child.provider_business_name || 'your experience';
    const itemName = child.item_name || business;

    // The new party and the new family total, folded from the parent plus every
    // confirmed child (this one included). The provider reads the new size they
    // are setting out for and the new total across the family.
    let headcount = added;
    let familyTotal: number | null = Number(child.price) || null;
    try {
        const { data: parent } = await admin
            .from('service_orders')
            .select('quantity, attendees, adults, children, price, item_unit')
            .eq('id', child.parent_order_id)
            .maybeSingle();
        const { data: children } = await admin
            .from('service_orders')
            .select('quantity, attendees, adults, children, price, item_unit')
            .eq('parent_order_id', child.parent_order_id)
            .eq('status', 'confirmed');
        if (parent) {
            const folded = foldOrderFamily(parent, children || []);
            headcount = folded.headcount;
            if (folded.total != null) familyTotal = folded.total;
        }
    } catch { /* fall back to this child's own figures */ }

    // The provider's diary notification — the count went up.
    try {
        const { data: prov } = await admin
            .from('service_providers').select('contact_email').eq('id', child.provider_id).maybeSingle();
        if (prov && prov.contact_email) {
            await sendEmail(
                prov.contact_email,
                'A guest added ' + added + ' ' + placeWord + ' — ' + String(child.service_date || ''),
                emailLayout(
                    '<p>A guest has added <strong>' + added + ' more ' + placeWord + '</strong> to their booking of '
                    + escapeHtml(itemName) + ' on <strong>' + when + '</strong>.</p>'
                    + '<p>The party is now <strong>' + headcount + '</strong>'
                    + (familyTotal != null ? ', for a total of <strong>£' + familyTotal.toFixed(2) + '</strong>' : '')
                    + '.</p>'
                    + button(SITE_URL + '/services/dashboard', 'View your bookings'),
                    'You’re receiving this because you offer experiences on Galloway Getaways.'
                )
            );
        }
    } catch (err) {
        console.error('[slotNotify] provider top-up notify failed', err);
    }

    // The payer's receipt for the added places.
    try {
        if (child.guest_email) {
            await sendEmail(
                child.guest_email,
                'Your added ' + placeWord + (added === 1 ? ' is' : ' are') + ' confirmed',
                emailLayout(
                    '<p>You’ve added <strong>' + added + ' more ' + placeWord + '</strong> to your booking of '
                    + escapeHtml(itemName) + ' with ' + escapeHtml(business) + ' on <strong>' + when + '</strong>.</p>'
                    + (child.price != null ? '<p>You paid £' + Number(child.price).toFixed(2) + ' for the added ' + placeWord + '.</p>' : '')
                    + button(SITE_URL + '/experiences/order/' + child.parent_order_id, 'View your booking'),
                    'You’re receiving this because you booked an experience on Galloway Getaways.'
                )
            );
        }
    } catch (err) {
        console.error('[slotNotify] guest top-up receipt failed', err);
    }
}
