// MONEY HELD FOR A PROVIDER WHO HASN'T SET UP PAYOUTS — Airbnb's model.
//
// An approved experience provider is live and bookable whether or not their
// Stripe payouts are on. Every order is a held platform charge
// (lib/experienceFunds): the guest pays as normal, we keep it, and the
// experience-payouts run sends the provider their share the day after the
// experience — or, while their payouts are off, holds it and pays it on the
// first run after Stripe turns them on. Nothing here moves money; it only says
// how much is waiting, for the provider's dashboard, the reminder emails and
// the admin list, so all three read the same figures.
//
// "Waiting" is a held order the payout run would pay today if it could (the
// experience has happened and it isn't paid out). "Coming up" is a held, paid
// order whose experience is still to come. Amounts are the provider's share,
// the same orderNet figure their earnings page shows.

import { orderNet } from './serviceOrders';

export interface HeldOrder {
    id: string;
    provider_id: string;
    status: string;
    cancel_ack?: any;
    service_date: string | null;
    price: number | null;
    commission_rate: number | null;
    amount_refunded?: number | null;
    created_at?: string | null;
    paid_out_at?: string | null;
    funds_flow?: string | null;
}

export interface HeldSummary {
    // Due now — the experience has happened; paid on the first run after payouts are on.
    waiting: number;
    waitingCount: number;
    // Paid by the guest, experience still to come.
    upcoming: number;
    upcomingCount: number;
    // The earliest service date among the waiting orders (YYYY-MM-DD), or null.
    oldestWaiting: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// The orders the payout run would pay a provider — the same rule it selects on:
// held, not yet paid, and confirmed or a walk-away (cancelled with the forfeit
// record, which the provider keeps).
export function isOwedToProvider(o: HeldOrder): boolean {
    if (o.funds_flow !== 'held' || o.paid_out_at) return false;
    return o.status === 'confirmed' || (o.status === 'cancelled' && o.cancel_ack != null);
}

// `today` is the London day key. The payout run pays orders dated yesterday or
// earlier, so an order dated today is still "coming up".
export function heldSummary(orders: HeldOrder[], today: string): HeldSummary {
    const out: HeldSummary = { waiting: 0, waitingCount: 0, upcoming: 0, upcomingCount: 0, oldestWaiting: null };
    for (const o of orders) {
        if (!isOwedToProvider(o) || !o.service_date) continue;
        const share = orderNet(o).youGet;
        if (share <= 0) continue;
        if (o.service_date < today) {
            out.waiting = r2(out.waiting + share);
            out.waitingCount++;
            if (!out.oldestWaiting || o.service_date < out.oldestWaiting) out.oldestWaiting = o.service_date;
        } else {
            out.upcoming = r2(out.upcoming + share);
            out.upcomingCount++;
        }
    }
    return out;
}

export const HELD_ORDER_COLUMNS = 'id, provider_id, status, cancel_ack, service_date, price, commission_rate, amount_refunded, created_at, paid_out_at, funds_flow';

// The held, unpaid orders of these providers (server-only; admin client).
export async function loadHeldOrders(admin: any, providerIds: string[]): Promise<HeldOrder[]> {
    if (!providerIds.length) return [];
    const { data, error } = await admin
        .from('service_orders')
        .select(HELD_ORDER_COLUMNS)
        .in('provider_id', providerIds)
        .eq('funds_flow', 'held')
        .is('paid_out_at', null)
        .in('status', ['confirmed', 'cancelled']);
    if (error) throw error;
    return (data || []) as HeldOrder[];
}
