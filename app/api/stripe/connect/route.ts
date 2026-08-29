import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the auth
        // cookie and never checks its signature, so the id it returns is
        // whatever the caller wrote there — a forged cookie carrying anyone's
        // id is accepted. This route moves money, so the identity it acts on
        // has to be verified against the auth server, which getUser() does.
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const uid = user.id;
        const body = await request.json().catch(function () { return {}; });
        const action = (body && body.action) || 'onboard';

        const admin = adminClient();

        const { data: profile } = await admin
            .from('profiles')
            .select('stripe_account_id, full_name, stripe_payouts_enabled')
            .eq('id', uid)
            .maybeSingle();

        let accountId = profile && profile.stripe_account_id;

        // -------------------------------------------------------------
        // Open the Express dashboard for a host who's already set up.
        // -------------------------------------------------------------
        if (action === 'dashboard') {
            if (!accountId) {
                return NextResponse.json({ ok: false, error: 'No payout account yet' }, { status: 400 });
            }
            const link = await stripeRequest('POST', '/accounts/' + accountId + '/login_links');
            return NextResponse.json({ ok: true, url: link.url });
        }

        // -------------------------------------------------------------
        // Create the connected account the first time round.
        // -------------------------------------------------------------
        if (!accountId) {
            const account = await stripeRequest('POST', '/accounts', {
                type: 'express',
                country: 'GB',
                email: user.email,
                default_currency: 'gbp',
                business_type: 'individual',
                capabilities: {
                    transfers: { requested: 'true' },
                    card_payments: { requested: 'true' },
                },
                business_profile: {
                    // MCC 7011 — lodging. Tells Stripe what this host sells.
                    mcc: '7011',
                    url: SITE_URL,
                    product_description: 'Self-catering holiday accommodation let through Galloway Getaways.',
                },
                settings: {
                    payouts: {
                        // Daily, so a payout is created every day rather than
                        // sitting until a host logs into Stripe and releases
                        // it, which no host expects to do.
                        //
                        // Daily is how often a payout is *made*, not how fast
                        // it lands. 'minimum' resolves to whatever settlement
                        // wait Stripe sets for the account — seven days on
                        // every UK account checked, shortening as the account
                        // builds history. The wording hosts see is generated
                        // from the account's real delay_days in
                        // lib/payoutTiming.ts rather than written down here,
                        // because a number written down here goes stale
                        // silently.
                        schedule: { interval: 'daily', delay_days: 'minimum' },
                    },
                },
                metadata: {
                    galloway_user_id: uid,
                },
            });

            accountId = account.id;

            await admin
                .from('profiles')
                .update({
                    stripe_account_id: accountId,
                    stripe_updated_at: new Date().toISOString(),
                })
                .eq('id', uid);
        }

        // -------------------------------------------------------------
        // A fresh onboarding link. These expire quickly and are single
        // use, so one is generated every time rather than being stored.
        // -------------------------------------------------------------
        const accountLink = await stripeRequest('POST', '/account_links', {
            account: accountId,
            refresh_url: SITE_URL + '/account?section=payments&refresh=1',
            return_url: SITE_URL + '/account?section=payments&done=1',
            type: 'account_onboarding',
            collection_options: {
                fields: 'eventually_due',
            },
        });

        return NextResponse.json({ ok: true, url: accountLink.url });
    } catch (err: any) {
        console.error('[stripe/connect]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Something went wrong' },
            { status: 500 }
        );
    }
}

// Lets the Payments section read live status without waiting for a webhook.
export async function GET() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the auth
        // cookie and never checks its signature, so the id it returns is
        // whatever the caller wrote there — a forged cookie carrying anyone's
        // id is accepted. This route moves money, so the identity it acts on
        // has to be verified against the auth server, which getUser() does.
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const admin = adminClient();
        const { data: profile } = await admin
            .from('profiles')
            .select('stripe_account_id')
            .eq('id', user.id)
            .maybeSingle();

        if (!profile || !profile.stripe_account_id) {
            return NextResponse.json({ ok: true, connected: false });
        }

        const account = await stripeRequest('GET', '/accounts/' + profile.stripe_account_id);

        const due: string[] = (account.requirements && account.requirements.currently_due) || [];

        await admin
            .from('profiles')
            .update({
                stripe_charges_enabled: account.charges_enabled === true,
                stripe_payouts_enabled: account.payouts_enabled === true,
                stripe_details_submitted: account.details_submitted === true,
                stripe_requirements_due: due.length ? due.join(', ') : null,
                identity_verified: account.payouts_enabled === true,
                identity_verified_at: account.payouts_enabled === true ? new Date().toISOString() : null,
                stripe_updated_at: new Date().toISOString(),
            })
            .eq('id', user.id);

        return NextResponse.json({
            ok: true,
            connected: true,
            charges_enabled: account.charges_enabled === true,
            payouts_enabled: account.payouts_enabled === true,
            details_submitted: account.details_submitted === true,
            requirements_due: due,
        });
    } catch (err: any) {
        console.error('[stripe/connect GET]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not check your payout account' }, { status: 500 });
    }
}
