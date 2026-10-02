import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { logMoneyFailure } from '@/lib/moneyAlert';
import {
    deactivationBlockers,
    cancelOwnUpcomingTrips,
    providerSubscriptionIds,
} from '@/lib/deactivateAccount';
import { cancelProviderSubscription } from '@/lib/cancelSubscription';

export const dynamic = 'force-dynamic';

// Deactivation: reversible account closure. Unlike /api/account/delete (which
// anonymises for good), this keeps every row and suspends the login so the
// account can be brought back by us on request.
//
// Order matters and is deliberate (see lib/deactivateAccount.ts):
//   1. Refuse, touching nothing, if other people's reservations/requests are
//      still live on the person's listings/experiences/trades. The block is
//      reported per listing so the UI can point at the one to sort out.
//   2. Cancel the person's OWN upcoming trips, refunding under the policy.
//      Money moves here, before any status changes.
//   3. Stop any trade subscription at Stripe, so a hidden listing is not billed.
//   4. Only then suspend the account (the DB worker), and sign the person out.
export async function POST() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(): this moves money, so the identity has to
        // be verified against the auth server, not read from the cookie.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'You must be signed in.' }, { status: 401 });
        }
        const uid = user.id;
        const admin = adminClient();

        // 1. The block. Nothing is touched if anything is live.
        const blockers = await deactivationBlockers(admin, uid);
        if (blockers.length > 0) {
            return NextResponse.json({ ok: false, blocked: blockers }, { status: 409 });
        }

        // 2. Cancel the person's own upcoming trips (money first).
        const trips = await cancelOwnUpcomingTrips(admin, uid, user.email || null);
        if (trips.failures.length > 0) {
            // Some of the person's money is unresolved — do NOT deactivate. The
            // trips that did cancel stay cancelled; a retry resumes the rest.
            return NextResponse.json(
                {
                    ok: false,
                    error: 'We couldn’t refund one or more of your upcoming trips, so your account has been left active. Please try again, or contact us and we’ll sort it out.',
                },
                { status: 500 },
            );
        }

        // 3. Stop any trade subscription so a hidden listing is not billed.
        const subIds = await providerSubscriptionIds(admin, uid);
        for (const subId of subIds) {
            const result = await cancelProviderSubscription(subId);
            if (!result.ok) {
                await logMoneyFailure(
                    '[account/deactivate] could not cancel a trade subscription, so the account was left active to avoid hiding a listing that is still being billed',
                    { subscription_id: subId, error: result.error },
                    { path: 'api/account/deactivate', userId: uid },
                );
                return NextResponse.json(
                    {
                        ok: false,
                        error: 'We couldn’t stop your trade subscription, so your account has been left active. Please try again, or contact us.',
                    },
                    { status: 500 },
                );
            }
        }

        // 4. Suspend the account. The RPC re-runs the block check as a hard
        //    guard, hides the profile and listings, and suspends the login. It
        //    runs as the signed-in user (auth.uid()), like anonymise_own_account.
        const { error: rpcError } = await supabase.rpc('deactivate_own_account');
        if (rpcError) {
            return NextResponse.json({ ok: false, error: rpcError.message }, { status: 400 });
        }

        // The login is now suspended and the session killed server-side; clear
        // the cookie too so the browser doesn't carry a dead session around.
        await supabase.auth.signOut();

        return NextResponse.json({
            ok: true,
            tripsCancelled: trips.cancelled,
            refunded: trips.refundedTotal,
            subscriptionsStopped: subIds.length,
        });
    } catch (err: any) {
        await logError('[account/deactivate] failed', err, { path: 'api/account/deactivate' });
        return NextResponse.json(
            { ok: false, error: 'Something went wrong deactivating your account. Please try again or contact support.' },
            { status: 500 },
        );
    }
}
