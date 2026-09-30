export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { formatGBP } from '@/lib/formatMoney';
import { ukDate, shiftDayKey } from '@/lib/dayKey';
import { adminName } from '@/lib/utils';
import { orderReference } from '@/lib/serviceOrders';
import { fundsFlowOf } from '@/lib/experienceFunds';
import { orderIsRefundable } from '@/lib/adminOrderRefund';
import AdminOrderRefund from '@/components/admin/AdminOrderRefund';

// Paid experience orders, newest experience first, each with the admin refund.
// The money columns (payouts, fees, what was refunded) are revoked from the
// browser roles, so this page reads them with the service role — behind
// requireAdmin, which is what actually keeps everyone else out.

const r2 = (n: number) => Math.round(n * 100) / 100;

function statusLabel(o: any): string {
    if (o.status === 'refunded') return 'Refunded';
    if (o.status === 'cancelled') return 'Guest cancelled — money kept';
    if (Number(o.amount_refunded || 0) > 0) return 'Confirmed — part refunded';
    return 'Confirmed';
}

function payoutLine(o: any): string {
    if (fundsFlowOf(o) === 'direct') return 'Older order — paid to the provider by Stripe at payment';
    if (o.paid_out_at) {
        let line = 'Paid out ' + formatGBP(o.payout_amount || 0) + ' on ' + ukDate(String(o.paid_out_at));
        if (Number(o.payout_reversed || 0) > 0) line += ' · ' + formatGBP(o.payout_reversed) + ' taken back';
        if (Number(o.payout_clawback_owed || 0) > 0) line += ' · ' + formatGBP(o.payout_clawback_owed) + ' still owed';
        return line;
    }
    if (o.status === 'refunded') return 'Held — not paid out';
    return 'Held — pays out ' + ukDate(shiftDayKey(String(o.service_date).slice(0, 10), 1));
}

export default async function AdminExperienceOrders() {
    await requireAdmin();
    const admin = adminClient();

    const { data } = await admin
        .from('service_orders')
        .select('id, parent_order_id, provider_id, guest_id, status, cancel_ack, service_date, price, amount_refunded, item_name, provider_business_name, guest_name, stripe_payment_intent_id, funds_flow, paid_out_at, payout_amount, payout_transfer_id, payout_reversed, payout_clawback_owed, created_at')
        .not('stripe_payment_intent_id', 'is', null)
        .in('status', ['confirmed', 'cancelled', 'refunded'])
        .order('service_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100);
    // A cancel before payment has no money on it; only a walk-away (cancel_ack) does.
    const orders = (data || []).filter((o: any) => o.status !== 'cancelled' || o.cancel_ack);

    const guestIds = Array.from(new Set(orders.map((o: any) => o.guest_id).filter(Boolean)));
    const { data: people } = guestIds.length
        ? await admin.from('profiles').select('id, full_name, preferred_name').in('id', guestIds)
        : { data: [] };
    const nameById: Record<string, string> = {};
    (people || []).forEach((p: any) => { nameById[p.id] = adminName(p, ''); });

    const orderIds = orders.map((o: any) => o.id);
    const { data: refunds } = orderIds.length
        ? await admin.from('service_order_refunds')
            .select('id, order_id, admin_id, amount, reason, status, after_payout, reversed, shortfall, created_at')
            .in('order_id', orderIds)
            .in('status', ['succeeded', 'pending'])
            .order('created_at', { ascending: true })
        : { data: [] };
    const refundsByOrder: Record<string, any[]> = {};
    (refunds || []).forEach((r: any) => { (refundsByOrder[r.order_id] = refundsByOrder[r.order_id] || []).push(r); });
    const adminIds = Array.from(new Set((refunds || []).map((r: any) => r.admin_id)));
    const { data: admins } = adminIds.length
        ? await admin.from('profiles').select('id, full_name, preferred_name').in('id', adminIds)
        : { data: [] };
    const adminById: Record<string, string> = {};
    (admins || []).forEach((p: any) => { adminById[p.id] = adminName(p, 'An admin'); });

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:underline">&larr; Owner tools</Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">Experience orders</h1>
            <p className="text-sm text-slate-500 mb-8">
                Paid experience bookings, latest date first. Refund all or part of one: before the
                payout run it comes from the money we hold and the provider is paid only on what is
                left; after it, the provider&apos;s share is taken back from their Stripe balance.
            </p>

            {orders.length === 0 ? (
                <div className="border rounded-2xl p-10 text-center">
                    <h2 className="font-semibold text-slate-800">No paid experience orders yet</h2>
                </div>
            ) : (
                <div className="space-y-4">
                    {orders.map((o: any) => {
                        const refunded = r2(Number(o.amount_refunded || 0));
                        const refundable = r2(Number(o.price || 0) - refunded);
                        const history = refundsByOrder[o.id] || [];
                        const guest = nameById[o.guest_id] || String(o.guest_name || '').trim() || 'Guest';
                        return (
                            <div key={o.id} className="border border-slate-200 rounded-2xl p-5">
                                <div className="flex items-baseline justify-between gap-4 flex-wrap">
                                    <div className="font-semibold text-slate-900">
                                        {o.provider_business_name || 'Experience'}
                                        {o.item_name ? <span className="font-normal text-slate-500"> · {o.item_name}</span> : null}
                                    </div>
                                    <div className="font-semibold text-slate-900">{formatGBP(o.price || 0)}</div>
                                </div>
                                <div className="text-[13px] text-slate-500 mt-0.5">
                                    {orderReference(o.id)} · {ukDate(o.service_date)} · {guest}
                                    {o.parent_order_id ? ' · added guests' : ''}
                                </div>
                                <div className="text-[13px] text-slate-500 mt-2">
                                    {statusLabel(o)}{refunded > 0 ? ' · ' + formatGBP(refunded) + ' refunded' : ''}
                                </div>
                                <div className="text-[13px] text-slate-500">{payoutLine(o)}</div>

                                {history.length > 0 && (
                                    <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                                        {history.map((r: any) => (
                                            <li key={r.id} className="text-[13px] text-slate-600">
                                                {formatGBP(r.amount)} refunded by {adminById[r.admin_id] || 'an admin'} on {ukDate(String(r.created_at))}
                                                {r.status === 'pending' ? ' (in progress)' : ''}
                                                {r.after_payout && Number(r.reversed) > 0 ? ' · ' + formatGBP(r.reversed) + ' taken back' : ''}
                                                {Number(r.shortfall) > 0 ? ' · ' + formatGBP(r.shortfall) + ' owed' : ''}
                                                <span className="block text-slate-500">&ldquo;{r.reason}&rdquo;</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                {orderIsRefundable(o) && refundable > 0 && (
                                    <AdminOrderRefund
                                        orderId={o.id}
                                        refundable={refundable}
                                        amountRefunded={refunded}
                                        moneyNote={
                                            fundsFlowOf(o) === 'direct'
                                                ? 'An older order: the provider was paid at payment, so their share of the refund is reversed from their Stripe account.'
                                                : o.payout_transfer_id
                                                    ? 'The provider has been paid for this. The refund comes from us and their share is taken back from their Stripe balance; anything it can’t cover is recorded and emailed to the directors.'
                                                    : 'The provider hasn’t been paid yet. The refund comes from the money we hold, and they are paid only on what is left.'
                                        }
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
