import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { reactivationBillingPatches } from '@/lib/providerTakedown';

export const dynamic = 'force-dynamic';

// Bringing a deactivated account back is NOT self-serve — a suspended login
// cannot sign in to undo its own suspension, which is the point. The person
// asks us, and one of us runs this. is_admin is checked on the server (a client
// claim means nothing), then the service-role RPC lifts the suspension,
// un-hides the profile and republishes exactly the listings/experiences we hid.
//
// A trade's Stripe subscription is NOT restarted here (a cancelled subscription
// can't be revived) — the trade re-subscribes through the normal billing flow.
// For that to work, the dead subscription is cleared off their row and they go
// back on the card ladder with a fresh grace period, exactly as an admin Relist
// does (lib/providerTakedown.reactivationBillingPatches).
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const admin = adminClient();
        const { data: me } = await admin
            .from('profiles')
            .select('is_admin')
            .eq('id', user.id)
            .maybeSingle();
        if (!me || me.is_admin !== true) {
            return NextResponse.json({ ok: false, error: 'Not allowed' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const target: string = body && body.userId;
        if (!target) {
            return NextResponse.json({ ok: false, error: 'Missing userId' }, { status: 400 });
        }

        // The trades the deactivation took down, read BEFORE the RPC clears
        // their deactivated_at stamp — those are the ones whose subscription it
        // cancelled.
        const { data: revived } = await admin
            .from('service_providers')
            .select('id, plan, stripe_subscription_id, subscription_status, trial_ends_at, reminders_sent')
            .eq('owner_id', target)
            .not('deactivated_at', 'is', null);

        const { error } = await admin.rpc('reactivate_account', { target });
        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
        }

        // The account is back. Now the billing: a dead subscription off the row,
        // and back on the card ladder. A failure here doesn't undo the
        // reactivation — it is reported, and the trade stays hidden (unpaid)
        // rather than listed for free, until it is fixed.
        const billingProblems: string[] = [];
        const { patches, unread } = await reactivationBillingPatches(revived || [], new Date());
        for (const { id, patch } of patches) {
            const { error: patchError } = await admin.from('service_providers').update(patch).eq('id', id);
            if (patchError) billingProblems.push(id);
        }
        billingProblems.push(...unread);
        if (billingProblems.length) {
            await logError('[admin/account/reactivate] reactivated, but could not reset a trade’s cancelled subscription', {
                user_id: target, provider_ids: billingProblems,
            }, { path: 'api/admin/account/reactivate' });
            return NextResponse.json({
                ok: true,
                warning: 'Reactivated, but we couldn’t reset their trade subscription — they may not be able to add a card. It’s in /admin/errors.',
            });
        }

        return NextResponse.json({ ok: true, billingReset: patches.length });
    } catch (err: any) {
        await logError('[admin/account/reactivate] failed', err, { path: 'api/admin/account/reactivate' });
        return NextResponse.json({ ok: false, error: 'Could not reactivate the account.' }, { status: 500 });
    }
}
