import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isAdmin, recordAdminAction, cleanReason } from '@/lib/adminAudit';
import { adminTakeDown, relistPatch } from '@/lib/providerTakedown';

export const dynamic = 'force-dynamic';

// An admin taking an experience or a trade off the site, or putting it back.
// Built like /api/admin/listings/visibility (the accommodation hide): a reason
// is required, every press writes an admin_actions row, and Relist undoes it.
//
// Separate from /api/services/listing/pause, which is the provider's own control
// and asks for no reason. This one is moderation, and the provider can't lift it
// — their "Put it back up" only clears their own pause.
//
// A take-down of a TRADE also cancels their £20 subscription at Stripe (before
// the listing comes down — money first). Relist puts them back in the ordinary
// card ladder (lib/providerTakedown.relistPatch).
//
// Nothing here touches orders, enquiries or jobs. The row stays 'approved', so
// the provider keeps their dashboard and the work already in it, and a guest or
// host who booked keeps their booking.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession() — see the listings route.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }
        if (!(await isAdmin(user.id))) {
            return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const providerId: string = String((body && body.providerId) || '');
        const hidden: boolean = !!(body && body.hidden);
        const reason = cleanReason(body && body.reason);

        if (!providerId) {
            return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        }
        if (!reason) {
            return NextResponse.json(
                { ok: false, error: 'Give a reason — it goes in the log against your name.' },
                { status: 400 }
            );
        }

        const admin = adminClient();
        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id, business_name, audience, status, plan, admin_hidden_at, stripe_subscription_id, subscription_status, trial_ends_at, reminders_sent')
            .eq('id', providerId)
            .maybeSingle();

        if (!provider) {
            return NextResponse.json({ ok: false, error: 'No such listing' }, { status: 404 });
        }

        // Only an approved listing is on the site. An application is decided in
        // the review queue, not taken down.
        if (provider.status !== 'approved') {
            return NextResponse.json(
                { ok: false, error: 'That listing isn’t live, so it is not on the site.' },
                { status: 400 }
            );
        }

        const isHidden = !!provider.admin_hidden_at;
        if (isHidden === hidden) {
            return NextResponse.json({ ok: true, hidden, unchanged: true });
        }

        const now = new Date();
        let patch: Record<string, any>;
        let billing: string | null = null;

        if (hidden) {
            const down = await adminTakeDown(admin, provider, now.toISOString());
            if (!down.ok || !down.patch) {
                return NextResponse.json({ ok: false, error: down.error }, { status: down.status });
            }
            patch = down.patch;
            billing = down.billing || null;
        } else {
            patch = relistPatch(provider, now);
        }

        const { error } = await admin
            .from('service_providers')
            .update(patch)
            .eq('id', providerId);

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        await recordAdminAction({
            adminId: user.id,
            action: hidden ? 'provider_hidden' : 'provider_relisted',
            providerId: providerId,
            hostId: provider.owner_id,
            reason: reason,
            detail: {
                business_name: provider.business_name,
                audience: provider.audience,
                // What happened to their £20 subscription, if they had one:
                // cancelled / none / already_gone on the way down.
                ...(hidden ? { subscription: billing, subscription_id: provider.stripe_subscription_id || null } : {}),
                ...(!hidden && patch.subscription_status ? { back_on_card_ladder: true, trial_ends_at: patch.trial_ends_at || provider.trial_ends_at } : {}),
            },
        });

        return NextResponse.json({ ok: true, hidden, billing });
    } catch (err: any) {
        console.error('[admin/providers/visibility]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not change that' },
            { status: 500 }
        );
    }
}
