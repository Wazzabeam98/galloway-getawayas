import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { readSubscription, setCancelAtPeriodEnd, isLive } from '@/lib/subscriptionCancel';
import { billingTokenFor, hashBillingToken } from '@/lib/serviceBillingToken';
import { billingLink } from '@/lib/serviceSubscriptionAlert';

export const dynamic = 'force-dynamic';

// A trade managing their own £20 subscription from Edit your business.
//
//   cancel  — cancel at the end of the period they have paid for (Tradesperson
//             Agreement 3.4). The listing stays up to that date; Stripe then
//             ends the subscription and the webhook takes the listing down.
//   undo    — change their mind before that date: billing carries on.
//   restart — after it has ended, the card link to subscribe again (the same
//             billing page the reminder emails use).
//
// The ownership check is the gate; the Stripe call uses the platform key. Nothing
// local is written for cancel/undo — Stripe's customer.subscription.* events
// reach the webhook, which copies Stripe's verdict, so there is one source of
// truth for billing.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const providerId = String((body && body.providerId) || '');
        const action = String((body && body.action) || '');
        if (['cancel', 'undo', 'restart'].indexOf(action) === -1) {
            return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 });
        }

        const admin = adminClient();
        const { data: p } = await admin
            .from('service_providers')
            .select('id, owner_id, plan, status, stripe_subscription_id, subscription_status, billing_token_hash')
            .eq('id', providerId)
            .maybeSingle();
        if (!p || p.owner_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        }
        if (p.plan !== 'subscription') {
            return NextResponse.json({ ok: false, error: 'There is no subscription on your listing.' }, { status: 400 });
        }

        if (action === 'restart') {
            if (p.stripe_subscription_id) {
                return NextResponse.json({ ok: false, error: 'You already have a subscription.' }, { status: 400 });
            }
            const token = billingTokenFor(p.id);
            const link = billingLink(token);
            if (!token || !link) {
                await logError('[services/subscription] restart: BILLING_TOKEN_SECRET is not set', null, { path: 'api/services/subscription' });
                return NextResponse.json({ ok: false, error: 'We can’t open the payment page just now. Reply to any of our emails and we’ll sort it.' }, { status: 503 });
            }
            // The billing page looks the provider up by this hash; the reminder
            // cron stores it the first time it needs a link, which a trade who
            // cancelled may never have reached.
            const hash = hashBillingToken(token);
            if (p.billing_token_hash !== hash) {
                await admin.from('service_providers')
                    .update({ billing_token_hash: hash, updated_at: new Date().toISOString() })
                    .eq('id', p.id);
            }
            return NextResponse.json({ ok: true, link });
        }

        if (!p.stripe_subscription_id) {
            return NextResponse.json({ ok: false, error: 'There is no subscription to change — you haven’t added a card yet.' }, { status: 400 });
        }

        const current = await readSubscription(p.stripe_subscription_id);
        if (!isLive(current)) {
            return NextResponse.json({ ok: false, error: 'Your subscription has already ended.' }, { status: 409 });
        }
        if (action === 'cancel' && current.cancelAtPeriodEnd) {
            return NextResponse.json({ ok: true, unchanged: true, endsAt: current.endsAt });
        }
        if (action === 'undo' && !current.cancelAtPeriodEnd) {
            return NextResponse.json({ ok: true, unchanged: true, endsAt: null });
        }

        const next = await setCancelAtPeriodEnd(p.stripe_subscription_id, action === 'cancel');
        return NextResponse.json({ ok: true, endsAt: next.endsAt, periodEnd: next.periodEnd });
    } catch (err: any) {
        await logError('[services/subscription] failed', err, { path: 'api/services/subscription' });
        return NextResponse.json({ ok: false, error: 'Stripe didn’t accept that just now. Please try again.' }, { status: 502 });
    }
}
