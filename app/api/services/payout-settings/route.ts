import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { logError } from '@/lib/logError';
import { readSchedule, arrivalSentence } from '@/lib/payoutTiming';
import { scheduleFromBody, PROVIDER_RELEASE_SENTENCE } from '@/lib/payoutScheduleInput';

export const dynamic = 'force-dynamic';

// An experience provider's payout settings — the provider twin of the host's
// /api/stripe/payout-schedule (/account → Payments): where the money goes (bank
// name, sort code, last four — never the account number), how often Stripe pays
// it out (daily / weekly / monthly), and when it arrives. The bank is changed
// at Stripe, through the "Manage in Stripe" link (/api/services/connect action
// 'dashboard'), never from a form here — that change is worth Stripe's own
// identity check.
//
// OWNER ONLY, as on the host side (a host's payout settings are their own row's
// alone): the account is service_providers.stripe_account_id, and a co-host —
// even one with earnings — may see what was earned, never where it is paid.
//
//   GET  ?provider=<id>   — or no id: their own experience business (the live
//                           one first), for /account → Payments
//   POST { providerId, interval, weekly_anchor?, monthly_anchor? }

async function ownProvider(userId: string, providerId: string | null) {
    const admin = adminClient();
    let q = admin.from('service_providers')
        .select('id, owner_id, business_name, status, audience, stripe_account_id, stripe_payouts_enabled')
        .eq('owner_id', userId);
    if (providerId) q = q.eq('id', providerId);
    else q = q.eq('audience', 'guest');
    const { data } = await q.order('updated_at', { ascending: false }).limit(10);
    const rows = data || [];
    return rows.find((r: any) => r.status === 'approved') || rows[0] || null;
}

async function bankFor(accountId: string) {
    try {
        const list = await stripeRequest('GET', '/accounts/' + accountId + '/external_accounts?object=bank_account&limit=1');
        const bank = list && list.data && list.data[0];
        if (!bank) return null;
        return {
            bank_name: bank.bank_name || null,
            last4: bank.last4 || null,
            sort_code: bank.routing_number || null,
            currency: (bank.currency || '').toUpperCase(),
        };
    } catch {
        return null;
    }
}

export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const providerId = new URL(request.url).searchParams.get('provider');
        const p = await ownProvider(user.id, providerId);
        if (!p) return NextResponse.json({ ok: true, provider: null });

        const base = { id: p.id, name: p.business_name || 'Your experience', status: p.status };
        if (!p.stripe_account_id) {
            return NextResponse.json({ ok: true, provider: base, connected: false, payouts_enabled: false });
        }
        const [schedule, bank] = await Promise.all([readSchedule(p.stripe_account_id), bankFor(p.stripe_account_id)]);
        return NextResponse.json({
            ok: true,
            provider: base,
            connected: true,
            payouts_enabled: p.stripe_payouts_enabled === true,
            schedule,
            bank,
            timing: PROVIDER_RELEASE_SENTENCE + ' ' + arrivalSentence(schedule ? schedule.delayDays : null),
        });
    } catch (err: any) {
        await logError('[services/payout-settings GET] ' + ((err && err.message) || 'failed'), err, { path: 'services/payout-settings' });
        return NextResponse.json({ ok: false, error: 'Could not read your payout settings' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const providerId = String((body && body.providerId) || '');
        if (!providerId) return NextResponse.json({ ok: false, error: 'Missing business' }, { status: 400 });

        const parsed = scheduleFromBody(body);
        if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

        const p = await ownProvider(user.id, providerId);
        if (!p) return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        if (!p.stripe_account_id) return NextResponse.json({ ok: false, error: 'You have not set up payouts yet.' }, { status: 400 });

        // The second hop only (Stripe → their bank). delay_days is never sent,
        // and nothing here touches when we release the money or the bank itself.
        await stripeRequest('POST', '/accounts/' + p.stripe_account_id, { settings: { payouts: { schedule: parsed.schedule } } });
        const saved = await readSchedule(p.stripe_account_id);
        return NextResponse.json({
            ok: true,
            schedule: saved,
            timing: PROVIDER_RELEASE_SENTENCE + ' ' + arrivalSentence(saved ? saved.delayDays : null),
        });
    } catch (err: any) {
        await logError('[services/payout-settings POST] ' + ((err && err.message) || 'failed'), err, { path: 'services/payout-settings' });
        return NextResponse.json({ ok: false, error: (err && err.message) || 'Could not change your payout schedule' }, { status: 500 });
    }
}
