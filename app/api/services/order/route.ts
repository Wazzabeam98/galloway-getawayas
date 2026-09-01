import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import { isLiveToGuests, priceOrder, guestExperiencesOpen, exclusivePerDate } from '@/lib/serviceOrders';
import { dateFromKey, dateKey } from '@/lib/pricing';

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
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

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
        const providerId: string = body && body.providerId;
        const bookingId: string = body && body.bookingId;
        const serviceDate: string = body && body.serviceDate;
        const note: string = (body && body.note ? String(body.note) : '').slice(0, 500);

        if (!providerId || !bookingId || !serviceDate) {
            return NextResponse.json({ ok: false, error: 'Missing details' }, { status: 400 });
        }

        const admin = adminClient();

        // The booking is the guest's own, and it is where the dates, the place
        // and the guest count come from — never the browser.
        const { data: booking } = await admin
            .from('bookings')
            .select('id, guest_id, listing_id, check_in, check_out, guests, status')
            .eq('id', bookingId)
            .maybeSingle();

        if (!booking) {
            return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        }
        if (booking.guest_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        }

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, business_name, trade, status, stripe_account_id, stripe_payouts_enabled, experience_price, plan, commission_rate')
            .eq('id', providerId)
            .maybeSingle();

        // A provider a guest may not buy from must never be reachable here, not
        // only hidden from the surface — the gate is enforced, not decorative.
        if (!provider || !isLiveToGuests(provider) || !provider.stripe_account_id) {
            return NextResponse.json({ ok: false, error: 'That experience isn’t available.' }, { status: 400 });
        }
        if (!(Number(provider.experience_price) > 0)) {
            return NextResponse.json({ ok: false, error: 'That experience isn’t available.' }, { status: 400 });
        }

        // The service date has to fall inside the stay: check_out is the morning
        // the guest leaves, so the last night they are here is the day before.
        const start = dateFromKey(booking.check_in);
        const end = dateFromKey(booking.check_out);
        const when = dateFromKey(serviceDate);
        if (when < start || when >= end) {
            return NextResponse.json(
                { ok: false, error: 'Pick a date during your stay.' },
                { status: 400 }
            );
        }

        // One chef, one evening — but ONLY a chef. A chef cooks one dinner and
        // cannot be in two cottages at once, so a second live order for the date
        // is a clash. A baker bakes many cakes for one Saturday, a hamper maker
        // many hampers, so for them a second order is fine. exclusivePerDate is
        // the shared rule; the partial unique index (20260901160000) enforces
        // the same, chef-only, as the hard guard behind this courtesy.
        if (exclusivePerDate(String(provider.trade || ''))) {
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

        const pricing = priceOrder(provider, { bandPrice: Number(provider.experience_price) }, []);

        const label = (provider.business_name || 'Your experience');

        const checkout = await stripeRequest('POST', '/checkout/sessions', {
            mode: 'payment',
            customer_email: user.email,
            payment_method_types: ['card'],
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: 'gbp',
                        unit_amount: pricing.amountPence,
                        product_data: {
                            name: label,
                            // Named plainly so the guest sees whose experience
                            // this is at the moment they pay — the liability
                            // disclosure is on the checkout page, not buried.
                            description: 'Booked with ' + label
                                + '. Galloway Getaways takes the payment on their behalf and is not the provider.',
                        },
                    },
                },
            ],
            payment_intent_data: {
                // The hold. Captured only when the provider confirms.
                capture_method: 'manual',
                // The provider is the merchant of record; our cut is a fee.
                on_behalf_of: provider.stripe_account_id,
                application_fee_amount: pricing.applicationFeePence,
                transfer_data: { destination: provider.stripe_account_id },
                description: 'Galloway experience — ' + label,
                metadata: {
                    kind: 'service_order',
                    provider_id: provider.id,
                    booking_id: booking.id,
                },
            },
            success_url: SITE_URL + '/trips?experience=requested',
            cancel_url: SITE_URL + '/trips?experience=cancelled',
            metadata: {
                kind: 'service_order',
                provider_id: provider.id,
                booking_id: booking.id,
                guest_id: user.id,
                listing_id: booking.listing_id || '',
                service_date: dateKey(when),
                guests: String(booking.guests ?? ''),
                commission_rate: String(pricing.commissionRate),
                note: note,
            },
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
