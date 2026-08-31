import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { hashBillingToken } from '@/lib/serviceBillingToken';
import { logError } from '@/lib/logError';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import { SUBSCRIPTION_MONTHLY } from '@/lib/serviceProviders';
import { hasCard } from '@/lib/serviceSubscription';

export const dynamic = 'force-dynamic';

// A tradesman putting a card on file, without signing in.
//
// WHY THIS IS A POST AND THE EMAIL LINK IS NOT
//
// Exactly the reasoning in app/api/services/enquiries/respond/route.ts, and it
// matters more here. The email links to a page; the page shows him what he is
// agreeing to and he presses a button, and the button lands here. Answering
// straight from the link would be shorter and wrong, because mail scanners,
// corporate filters and link previewers fetch every URL in an email before a
// person has read a word of it. A GET that opens a subscription gets opened by
// a virus scanner at four in the morning.
//
// WHY STRIPE BILLING AND NOT A CHARGING CRON
//
// The instinct is to save a card and charge it monthly from a cron, mirroring
// app/api/cron/balance-charges. That route exists because a booking balance is
// a one-off amount on a date Stripe knows nothing about. £20 a month is
// precisely what Stripe Billing already does, and it brings retries, dunning,
// card-expiry updates and proration with it — every one of which is otherwise
// something written here, tested here, and got wrong at somebody else's
// expense.
//
// THE PART THAT IS EASY TO GET WRONG: trial_end
//
// The subscription is created with `trial_end` set from the provider's
// existing `trial_ends_at`, NOT with a fresh trial period. A tradesman who
// puts his card in the day the fourteen-day email arrives must keep the
// fourteen days he has left; billing him thirty days from the moment he was
// organised would punish him for being organised, and it would contradict the
// date we put in writing.
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(function () { return {}; });
        const token = String((body && body.token) || '');

        if (!token) {
            return NextResponse.json({ ok: false, error: 'No link.' }, { status: 400 });
        }

        const priceId = process.env.STRIPE_SUBSCRIPTION_PRICE_ID;
        if (!priceId) {
            // Loudly, and to us rather than to him. A tradesman who presses the
            // button and is told "something went wrong" will not press it
            // again, and this is the one button the whole model rests on.
            await logError('service-billing-price-missing', {
                error: 'STRIPE_SUBSCRIPTION_PRICE_ID is not set',
            });
            return NextResponse.json(
                { ok: false, error: 'We cannot take a card just now. We have been told and will sort it.' },
                { status: 503 }
            );
        }

        const admin = adminClient();

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, business_name, contact_email, plan, status, trial_ends_at, stripe_customer_id, stripe_subscription_id, subscription_status')
            .eq('billing_token_hash', hashBillingToken(token))
            .maybeSingle();

        if (!provider) {
            return NextResponse.json({ ok: false, error: 'That link is not valid.' }, { status: 404 });
        }

        // Nothing to sell them. A commission trade pays per job and has no
        // subscription to start; this is belt and braces, because the only way
        // to reach here is a link we sent.
        if (String(provider.plan || '') !== 'subscription') {
            return NextResponse.json(
                { ok: false, error: 'There is nothing to pay on your listing.' },
                { status: 400 }
            );
        }

        // ALREADY PAYING. Pressing twice, or an old email opened after a new
        // one, must not open a second subscription — that is two £20 charges a
        // month to the same man for the same listing, and he would be right to
        // never speak to us again. The unique index on stripe_subscription_id
        // is the second line of the same defence.
        if (hasCard(provider)) {
            return NextResponse.json({
                ok: true,
                already: true,
                message: 'You are already set up — there is nothing more to do.',
            });
        }

        // WHERE THE FREE PERIOD ENDS, HONOURED RATHER THAN RESTARTED.
        //
        // Stripe wants a unix timestamp. Two edges:
        //
        //   * a trial that has already run out (he is in the grace period)
        //   * a trial ending within the next couple of days
        //
        // Both are handled the same way, and deliberately in his favour: the
        // trial is set to 48 hours from now rather than to a past date Stripe
        // would refuse or a date so close that the charge lands before he has
        // put his phone down. Erring the other way would charge a man early on
        // the day he did what we asked, which is the one moment he is paying
        // us attention.
        const now = Date.now();
        const promised = provider.trial_ends_at ? new Date(String(provider.trial_ends_at)).getTime() : 0;
        const floor = now + 48 * 60 * 60 * 1000;
        const trialEnd = Math.floor((promised > floor ? promised : floor) / 1000);

        const session = await stripeRequest('POST', '/checkout/sessions', {
            mode: 'subscription',
            // An existing customer if we have one, so a provider who abandoned
            // checkout once does not accumulate a customer per attempt.
            customer: provider.stripe_customer_id || undefined,
            customer_email: provider.stripe_customer_id ? undefined : (provider.contact_email || undefined),
            line_items: [{ price: priceId, quantity: 1 }],
            subscription_data: {
                trial_end: trialEnd,
                metadata: {
                    kind: 'provider_subscription',
                    provider_id: provider.id,
                },
            },
            // On the session as well as the subscription. The webhook reads
            // checkout.session.completed, which carries the session's metadata,
            // not the subscription's.
            metadata: {
                kind: 'provider_subscription',
                provider_id: provider.id,
            },
            success_url: SITE_URL + '/services/billing/' + token + '?done=1',
            cancel_url: SITE_URL + '/services/billing/' + token,
        });
        // NO IDEMPOTENCY KEY, on purpose, and this is the exception that proves
        // the house rule rather than a hole in it.
        //
        // The rule exists to stop a retried request becoming a second CHARGE.
        // Creating a Checkout session charges nobody — it opens a page. Sending
        // a fixed key would replay the first session for ever, including after
        // it expired, so a tradesman who came back a day later would be handed
        // a dead link and no way to pay. What actually prevents a double
        // subscription is the `hasCard` guard above, the unique index on
        // stripe_subscription_id, and the fact that Stripe will not complete
        // two checkouts for one subscription.

        if (!session || !session.url) {
            await logError('service-billing-session', {
                provider: String(provider.id),
                error: 'no url on the checkout session',
            });
            return NextResponse.json(
                { ok: false, error: 'We could not open the payment page. Please try again.' },
                { status: 502 }
            );
        }

        // The customer id is worth keeping the moment it exists, so a second
        // attempt reuses it. The subscription id is NOT written here — it is
        // written by the webhook when the session actually completes, because
        // an abandoned checkout must not leave a row claiming he pays us.
        if (session.customer && !provider.stripe_customer_id) {
            await admin
                .from('service_providers')
                .update({ stripe_customer_id: String(session.customer), updated_at: new Date().toISOString() })
                .eq('id', provider.id);
        }

        return NextResponse.json({ ok: true, url: session.url, monthly: SUBSCRIPTION_MONTHLY });
    } catch (err: any) {
        await logError('service-billing', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
