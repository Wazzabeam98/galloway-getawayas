import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { isAdmin, recordAdminAction, cleanReason } from '@/lib/adminAudit';
import { reactivationBillingPatches } from '@/lib/providerTakedown';
import { sendEmail, emailLayout, button, escapeHtml, SITE_URL, NEUTRAL_SUBTITLE } from '@/lib/email';
import { firstName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Bringing a deactivated account back — the Reactivate button on
// /admin/accounts. NOT self-serve: a suspended login cannot sign in to undo its
// own suspension, which is the point. The person asks us, and one of us presses
// the button. Built like the take-down buttons: is_admin checked here, a reason
// required, an admin_actions row ('account_reactivated', host_id = the person).
//
// WHAT COMES BACK, AND WHAT DOESN'T (reactivate_account, 20261004130329):
//   * the login and the profile — yes;
//   * their listings, experiences and trade — NO. Listings stay hidden and
//     experiences/trades come back paused (owner_paused); the person relists
//     each one themselves when they're ready, the way Airbnb leaves it to the
//     host. An admin take-down (admin_hidden_at) is never lifted.
//
// A trade's Stripe subscription is NOT restarted (a cancelled subscription
// can't be revived). The dead subscription is cleared off their row and they go
// back on the card ladder with a fresh grace period, exactly as an admin Relist
// does (lib/providerTakedown.reactivationBillingPatches, #295).
//
// Then a short email: your account is active again.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession() — see the listings visibility route.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }
        if (!(await isAdmin(user.id))) {
            return NextResponse.json({ ok: false, error: 'Not allowed' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const target: string = String((body && body.userId) || '');
        const reason = cleanReason(body && body.reason);
        if (!target) {
            return NextResponse.json({ ok: false, error: 'Missing userId' }, { status: 400 });
        }
        if (!reason) {
            return NextResponse.json(
                { ok: false, error: 'Give a reason — it goes in the log against your name.' },
                { status: 400 }
            );
        }

        const admin = adminClient();

        const { data: profile } = await admin
            .from('profiles')
            .select('id, full_name, preferred_name, show_full_name, deactivated_at, anonymised_at')
            .eq('id', target)
            .maybeSingle();
        if (!profile) {
            return NextResponse.json({ ok: false, error: 'No such account' }, { status: 404 });
        }
        // Only a deactivated account comes back. An erased one never does, and
        // an active one has nothing to reactivate (a second press is a no-op).
        if (profile.anonymised_at) {
            return NextResponse.json({ ok: false, error: 'That account was deleted, so it can’t be brought back.' }, { status: 409 });
        }
        if (!profile.deactivated_at) {
            return NextResponse.json({ ok: true, unchanged: true });
        }

        // What the deactivation took down, read BEFORE the RPC clears the
        // stamps: the listings (for the email and the trail) and the providers
        // (whose subscription the deactivation cancelled).
        const [{ data: listings }, { data: revived }] = await Promise.all([
            admin.from('listings').select('id').eq('host_id', target).not('deactivated_at', 'is', null),
            admin.from('service_providers')
                .select('id, business_name, plan, stripe_subscription_id, subscription_status, trial_ends_at, reminders_sent')
                .eq('owner_id', target).not('deactivated_at', 'is', null),
        ]);
        const listingCount = (listings || []).length;
        const providerCount = (revived || []).length;

        const { error } = await admin.rpc('reactivate_account', { target });
        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
        }

        // The billing: a dead subscription off the row, and back on the card
        // ladder. A failure here doesn't undo the reactivation — it is reported,
        // and the trade stays unbillable-but-paused rather than listed for free.
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
        }

        await recordAdminAction({
            adminId: user.id,
            action: 'account_reactivated',
            hostId: target,
            reason,
            detail: {
                listings_left_hidden: listingCount,
                providers_left_paused: providerCount,
                billing_reset: patches.length,
                ...(billingProblems.length ? { billing_problems: billingProblems } : {}),
            },
        });

        // The email. After the work, and its failure never undoes it — the
        // account is back either way; we just say so in the reply.
        let emailed = false;
        try {
            const { data: authUser } = await admin.auth.admin.getUserById(target);
            const to = authUser && authUser.user && authUser.user.email;
            if (to) {
                const name = escapeHtml(firstName(profile as any, 'there'));
                const down = listingCount + providerCount;
                emailed = await sendEmail(
                    to,
                    'Your account is active again',
                    emailLayout(
                        '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">Your account is active again</h1>'
                        + '<p style="margin:0 0 16px;">Hi ' + name + ', your Galloway Getaways account is active again. You can sign in as normal.</p>'
                        + (down > 0
                            ? '<p style="margin:0 0 16px;">' + (down === 1 ? 'Your listing is' : 'Your listings are')
                                + ' still off the site. Put ' + (down === 1 ? 'it' : 'each one') + ' back up from your dashboard when you’re ready.</p>'
                            : '')
                        + button(SITE_URL, 'Sign in'),
                        'You’re receiving this because your Galloway Getaways account was reactivated.',
                        undefined,
                        NEUTRAL_SUBTITLE,
                    ),
                );
            }
        } catch (mailErr: any) {
            await logError('[admin/account/reactivate] the account is back but the email did not go', mailErr, { path: 'api/admin/account/reactivate' });
        }

        return NextResponse.json({
            ok: true,
            emailed,
            listingsLeftHidden: listingCount,
            providersLeftPaused: providerCount,
            billingReset: patches.length,
            ...(billingProblems.length
                ? { warning: 'Reactivated, but we couldn’t reset their trade subscription — they may not be able to add a card. It’s in /admin/errors.' }
                : {}),
        });
    } catch (err: any) {
        await logError('[admin/account/reactivate] failed', err, { path: 'api/admin/account/reactivate' });
        return NextResponse.json({ ok: false, error: 'Could not reactivate the account.' }, { status: 500 });
    }
}
