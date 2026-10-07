import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { londonDayKey } from '@/lib/dayKey';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { isAutomatedTestAddress } from '@/lib/testAddresses';
import { loadHeldOrders } from '@/lib/heldPayouts';
import { planProviderReminders, providerReminderCopy } from '@/lib/experiencePayoutReminders';

export const dynamic = 'force-dynamic';

// Hourly: remind an approved experience provider with no payouts that money is
// being held for them — on their first booking, once money is waiting (the
// experience has happened), then weekly while it still is. The choosing is
// lib/experiencePayoutReminders; this reads, claims and sends.
//
// CLAIM BEFORE SEND, as the host reminders do. The provider_payout_reminders
// row is inserted first and its primary key (provider_id, kind) makes a second
// insert fail — so two overlapping runs can't both email. A send that fails
// after its claim is logged and not retried: one missed reminder beats the same
// email hourly. Moves no money.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    let sent = 0;
    let failed = 0;

    try {
        const today = londonDayKey();

        // Approved guest providers without payouts — the only ones a reminder is for.
        const { data: providers, error: providerError } = await admin
            .from('service_providers')
            .select('id, business_name, provider_name, contact_email')
            .eq('audience', 'guest')
            .eq('status', 'approved')
            .or('stripe_payouts_enabled.is.null,stripe_payouts_enabled.eq.false');
        if (providerError) throw providerError;
        if (!providers || providers.length === 0) return NextResponse.json({ ok: true, sent, failed });

        const orders = await loadHeldOrders(admin, providers.map((p: any) => p.id));
        if (orders.length === 0) return NextResponse.json({ ok: true, sent, failed });

        const { data: claimed, error: claimReadError } = await admin
            .from('provider_payout_reminders')
            .select('provider_id, kind')
            .in('provider_id', Array.from(new Set(orders.map((o) => o.provider_id))));
        if (claimReadError) throw claimReadError;
        const already = new Set<string>((claimed || []).map((r: any) => r.provider_id + ':' + r.kind));

        const plan = planProviderReminders(orders, already, today);
        const byId = new Map<string, any>(providers.map((p: any) => [p.id, p]));

        for (const p of plan) {
            const provider = byId.get(p.providerId);
            const to = provider && String(provider.contact_email || '');
            if (!to || isAutomatedTestAddress(to)) continue;

            const rows = [{ provider_id: p.providerId, kind: p.kind }];
            if (p.alsoClaim) rows.push({ provider_id: p.providerId, kind: p.alsoClaim });
            const { error: claimError } = await admin.from('provider_payout_reminders').insert(rows);
            if (claimError) continue; // another run got there first

            const copy = providerReminderCopy(p);
            const name = escapeHtml(String(provider.provider_name || '').split(' ')[0] || 'there');
            const ok = await sendEmail(
                to,
                copy.subject,
                emailLayout(
                    `<p style="margin:0 0 16px;font-size:16px;">Hello ${name},</p>`
                    + copy.paragraphs.map((t) => `<p style="margin:0 0 16px;font-size:16px;">${escapeHtml(t)}</p>`).join('')
                    + button(SITE_URL + '/services/dashboard', 'Set up payouts'),
                    'You’re receiving this because you offer experiences on Galloway Getaways and haven’t set up payouts yet.'
                )
            );
            if (ok) sent += 1;
            else {
                failed += 1;
                await logError('experience-payout-reminders: reminder email did not send',
                    { provider: p.providerId, kind: p.kind },
                    { path: '/api/cron/experience-payout-reminders' });
            }
        }

        return NextResponse.json({ ok: true, sent, failed });
    } catch (err: any) {
        await logError('experience-payout-reminders: run failed', err, { path: '/api/cron/experience-payout-reminders' });
        return NextResponse.json({ ok: false, error: 'Run failed', sent, failed }, { status: 500 });
    }
}
