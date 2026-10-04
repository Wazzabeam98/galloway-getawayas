import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { formatGBP } from '@/lib/formatMoney';
import { outstandingOf } from '@/lib/hostDebt';
import { DEBT_SELECT, debtTitle, attachBookings, type HostDebt } from '@/lib/hostDebtView';
import { toPence } from '@/lib/resolutions';

export const dynamic = 'force-dynamic';

// A host paying a debt now, rather than waiting for it to come off a payout.
//
// The same shape as a host's "send money" resolution: a one-off Stripe Checkout
// into the platform's balance — no transfer, no fee, and the card is not kept.
// Nothing is marked paid here. The webhook (kind 'host_debt_settle') applies the
// payment once Stripe says it cleared, through apply_host_debt_payment, which
// takes no more than is still outstanding and hands back any excess to refund.
//
// Only the host the debt belongs to. A co-host with earnings access sees the
// owner's payouts but never the owner's debts, and cannot pay them.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const payoutId: string = body && body.payoutId;
        if (!payoutId) return NextResponse.json({ ok: false, error: 'Missing debt' }, { status: 400 });

        const admin = adminClient();
        const { data: row } = await admin.from('payouts').select(DEBT_SELECT).eq('id', payoutId).maybeSingle();
        if (!row || row.host_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
        }
        if (row.status === 'disputed') {
            return NextResponse.json({ ok: false, error: 'This is under review. You can pay it once we have decided.' }, { status: 409 });
        }
        const outstanding = row.status === 'owed' ? outstandingOf(row as HostDebt) : 0;
        if (!(outstanding > 0)) {
            return NextResponse.json({ ok: false, error: 'There is nothing left to pay on this.' }, { status: 409 });
        }

        const [debt] = await attachBookings(admin, [row as HostDebt]);
        const stay = debt.booking && debt.booking.listing_title ? ' — ' + debt.booking.listing_title : '';
        const pence = toPence(outstanding);

        const checkout = await stripeRequest('POST', '/checkout/sessions', {
            mode: 'payment',
            customer_email: user.email || undefined,
            payment_method_types: ['card'],
            line_items: [{
                quantity: 1,
                price_data: {
                    currency: 'gbp',
                    unit_amount: pence,
                    product_data: {
                        name: 'Amount owed to Galloway Getaways' + stay,
                        description: debtTitle(debt) + '. Paying ' + formatGBP(outstanding) + ' settles it.',
                    },
                },
            }],
            // No transfer, no application fee: this settles a debt to the
            // platform. No setup_future_usage: the card is not kept.
            payment_intent_data: {
                description: 'Galloway Getaways — host debt ' + payoutId,
                metadata: { kind: 'host_debt_settle', payout_id: payoutId, host_id: user.id },
            },
            success_url: SITE_URL + '/dashboard/earnings?debt=paid#owed',
            cancel_url: SITE_URL + '/dashboard/earnings?debt=cancelled#owed',
            metadata: { kind: 'host_debt_settle', payout_id: payoutId, host_id: user.id, amount_pence: String(pence) },
        }, 'host-debt-pay-' + payoutId + '-' + pence + '-' + Math.floor(Date.now() / 600000));

        return NextResponse.json({ ok: true, url: checkout.url });
    } catch (err: any) {
        await logError('[host-debts/pay] could not start the payment', err, { path: 'api/host-debts/pay' });
        return NextResponse.json({ ok: false, error: 'Could not start the payment. Try again.' }, { status: 502 });
    }
}
