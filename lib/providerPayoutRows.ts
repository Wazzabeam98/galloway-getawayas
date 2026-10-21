// An experience provider's "Your payouts" list — the twin of the host's
// earnings page list (app/dashboard/earnings): what is still to come, with the
// day each is paid, and what has already been paid.
//
// Built from the payout run's own rule (app/api/cron/experience-payouts,
// lib/heldPayouts isOwedToProvider): a HELD order, not yet paid, confirmed or a
// walk-away cancel, paid on the first run after its date — the day after the
// experience. An order dated before today is due now (it goes on the next run,
// or as soon as payouts are set up). Direct orders (taken before 30/09/2026)
// were paid by Stripe at the time and never appear here.

import { orderNet } from './serviceOrders';
import { isOwedToProvider, type HeldOrder } from './heldPayouts';
import { shiftDayKey } from './dayKey';

export interface PayoutRowOrder extends HeldOrder {
    item_name?: string | null;
    payout_amount?: number | null;
}

export interface AwaitingPayout { id: string; title: string; date: string; payDate: string; dueNow: boolean; expected: number }
// `refunded` is what was later refunded on an order that had ALREADY been paid
// out — a refund that landed after the payout (the clawback case). It stays in
// the list (it was genuinely paid), with the refund shown, rather than silently
// vanishing the moment a full refund flips its status to 'refunded'. 0/undefined
// means nothing was refunded after payout.
export interface PaidPayout { id: string; title: string; date: string; paidOn: string; amount: number; refunded: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function providerPayoutRows(orders: PayoutRowOrder[], today: string): { awaiting: AwaitingPayout[]; alreadyPaid: PaidPayout[]; stillToCome: number } {
    const awaiting: AwaitingPayout[] = [];
    const alreadyPaid: PaidPayout[] = [];
    for (const o of orders) {
        if (!o.service_date) continue;
        const date = String(o.service_date).slice(0, 10);
        const title = (o.item_name || '').trim() || 'Experience';
        if (o.funds_flow === 'held' && o.paid_out_at) {
            // A refund that landed AFTER this was paid out. A full refund flips
            // the status to 'refunded'; a part refund leaves the status but sets
            // amount_refunded. Either way the payout still happened, so the row
            // stays — with what came back shown beside it — instead of dropping
            // off the list.
            alreadyPaid.push({
                id: o.id,
                title,
                date,
                paidOn: String(o.paid_out_at).slice(0, 10),
                amount: r2(Number(o.payout_amount) || 0),
                refunded: r2(Number(o.amount_refunded) || 0),
            });
            continue;
        }
        if (!isOwedToProvider(o)) continue;
        const expected = orderNet(o).youGet;
        if (expected <= 0) continue;
        awaiting.push({ id: o.id, title, date, payDate: shiftDayKey(date, 1), dueNow: date < today, expected });
    }
    awaiting.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    alreadyPaid.sort((a, b) => (a.paidOn < b.paidOn ? 1 : a.paidOn > b.paidOn ? -1 : 0));
    return { awaiting, alreadyPaid, stillToCome: r2(awaiting.reduce((s, r) => s + r.expected, 0)) };
}
