import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import { stripeProfileForProvider } from '@/lib/serviceOrders';

export const dynamic = 'force-dynamic';

// A guest-trade provider setting up payouts — the step a subscription trade
// never needed, because a subscription trade never receives money through us.
//
// This is the host connect route's sibling (app/api/stripe/connect), with the
// two differences that matter for a provider:
//
//   * the account is its own, stored on service_providers, not the profile's
//     lodging account — one person can be a host and a provider and their two
//     businesses must not share one Stripe category. See migration
//     20260829030000.
//   * it is created with the trade's own MCC, from stripeProfileForTrade, never
//     7011. A wrong category is a payout hold nobody traces back.
//
// getUser(), not getSession(): this stands up a money account, so the identity
// has to be verified against the auth server, not read from a forgeable cookie.
//
// APPROVAL FIRST, THEN THIS. Onboarding is only offered to an approved
// provider — there is no point asking someone to hand Stripe their passport
// before you have said their business is real. "Approved" and "payout-ready"
// are two gates, and this is the second one.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json().catch(function () { return {}; });
        const providerId: string = body && body.providerId;
        const action = (body && body.action) || 'onboard';

        if (!providerId) {
            return NextResponse.json({ ok: false, error: 'Missing provider' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id, trade, status, business_name, stripe_account_id, stripe_mcc, stripe_product_description')
            .eq('id', providerId)
            .maybeSingle();

        if (!provider) {
            return NextResponse.json({ ok: false, error: 'No such provider' }, { status: 404 });
        }
        // Verified id against a verified owner — a forged cookie cannot set up
        // payouts on someone else's business.
        if (provider.owner_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        }

        let accountId = provider.stripe_account_id;

        // Open the Express dashboard for a provider already set up.
        if (action === 'dashboard') {
            if (!accountId) {
                return NextResponse.json({ ok: false, error: 'No payout account yet' }, { status: 400 });
            }
            const link = await stripeRequest('POST', '/accounts/' + accountId + '/login_links');
            return NextResponse.json({ ok: true, url: link.url });
        }

        // Approval is the first gate. No onboarding before it.
        if (provider.status !== 'approved') {
            return NextResponse.json(
                { ok: false, error: 'Your application has to be approved before you can set up payouts.' },
                { status: 400 }
            );
        }

        // There must be a category. A fixed trade reads it from the trade; an
        // "other" provider reads the code the owner assigned at approval. Either
        // way, no code means no onboarding — that is a decision for a person,
        // not a default (see lib/serviceOrders mccForProvider). For an "other"
        // provider this is exactly the gate that holds them until the owner has
        // picked a code, so it can never be reached before the category exists.
        const profile = stripeProfileForProvider(provider);
        if (!profile) {
            return NextResponse.json(
                { ok: false, error: 'This business is not set up for payouts yet.' },
                { status: 400 }
            );
        }

        // Create the connected account the first time round, with the trade's
        // own category — never the host's lodging one.
        if (!accountId) {
            const account = await stripeRequest('POST', '/accounts', {
                type: 'express',
                country: 'GB',
                email: user.email,
                default_currency: 'gbp',
                business_type: 'individual',
                capabilities: {
                    // card_payments so the provider can be the merchant of
                    // record on a guest's charge (on_behalf_of); transfers so
                    // the money can reach them.
                    transfers: { requested: 'true' },
                    card_payments: { requested: 'true' },
                },
                business_profile: {
                    mcc: profile.mcc,
                    url: SITE_URL,
                    product_description: profile.product_description,
                },
                settings: {
                    payouts: {
                        // Daily/minimum, the same as hosts — a payout is made
                        // as soon as the settlement wait allows rather than
                        // sitting until the provider logs into Stripe.
                        schedule: { interval: 'daily', delay_days: 'minimum' },
                    },
                },
                metadata: {
                    galloway_user_id: user.id,
                    galloway_provider_id: provider.id,
                    galloway_trade: provider.trade,
                },
            });

            accountId = account.id;

            await admin
                .from('service_providers')
                .update({
                    stripe_account_id: accountId,
                    stripe_updated_at: new Date().toISOString(),
                })
                .eq('id', provider.id);
        }

        // A fresh single-use onboarding link every time — Stripe's expire fast,
        // and the refresh_url catches an expired one mid-flow and comes back
        // here for a new one, so a stale link is never a dead end.
        const accountLink = await stripeRequest('POST', '/account_links', {
            account: accountId,
            refresh_url: SITE_URL + '/services/join?payouts=refresh&provider=' + provider.id,
            return_url: SITE_URL + '/services/join?payouts=done&provider=' + provider.id,
            type: 'account_onboarding',
            collection_options: { fields: 'eventually_due' },
        });

        return NextResponse.json({ ok: true, url: accountLink.url });
    } catch (err: any) {
        console.error('[services/connect]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not start payout setup' },
            { status: 500 }
        );
    }
}

// Reads live payout status for one of the caller's providers and stores it, so
// the provider dashboard and the guest gate both read the same truth.
export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const providerId = new URL(request.url).searchParams.get('provider') || '';
        if (!providerId) {
            return NextResponse.json({ ok: false, error: 'Missing provider' }, { status: 400 });
        }

        const admin = adminClient();
        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id, stripe_account_id')
            .eq('id', providerId)
            .maybeSingle();

        if (!provider) {
            return NextResponse.json({ ok: false, error: 'No such provider' }, { status: 404 });
        }
        if (provider.owner_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        }

        if (!provider.stripe_account_id) {
            return NextResponse.json({ ok: true, connected: false });
        }

        const account = await stripeRequest('GET', '/accounts/' + provider.stripe_account_id);
        const due: string[] = (account.requirements && account.requirements.currently_due) || [];

        await admin
            .from('service_providers')
            .update({
                stripe_charges_enabled: account.charges_enabled === true,
                stripe_payouts_enabled: account.payouts_enabled === true,
                stripe_details_submitted: account.details_submitted === true,
                stripe_requirements_due: due.length ? due.join(', ') : null,
                stripe_updated_at: new Date().toISOString(),
            })
            .eq('id', provider.id);

        return NextResponse.json({
            ok: true,
            connected: true,
            charges_enabled: account.charges_enabled === true,
            payouts_enabled: account.payouts_enabled === true,
            details_submitted: account.details_submitted === true,
            requirements_due: due,
        });
    } catch (err: any) {
        console.error('[services/connect GET]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not check payout status' }, { status: 500 });
    }
}
