// The rules for an admin refunding an experience order — ONE place, read by the
// admin form (components/admin/AdminOrderRefund.tsx) to explain itself and by
// the route (app/api/admin/experience-orders/refund) to refuse. The browser's
// check is a courtesy; the route's is the wall, and they are the same function.
//
// Pure, with no imports, so the client bundle and the unit tests can both load it.

export const REFUND_REASON_MIN = 10;
export const REFUND_REASON_MAX = 1000;

const r2 = (n: number) => Math.round(n * 100) / 100;

export type RefundCheck =
    | { ok: true; amount: number; reason: string }
    | { ok: false; error: string; field: 'amount' | 'reason' };

// `refundable` is what is still left to give back, in pounds. On the server it
// is read from Stripe and the order — never from the browser — so a figure the
// browser was shown can only ever make the form stricter, not the route looser.
export function checkAdminOrderRefund(input: { amount: unknown; reason: unknown; refundable: number }): RefundCheck {
    const refundable = r2(Math.max(0, Number(input.refundable) || 0));
    const raw = typeof input.amount === 'string' ? input.amount.trim() : input.amount;
    const amount = Number(raw);

    if (refundable <= 0) return { ok: false, field: 'amount', error: 'There is nothing left to refund on this order.' };
    if (raw === '' || raw === null || raw === undefined || !Number.isFinite(amount) || amount <= 0) {
        return { ok: false, field: 'amount', error: 'Enter an amount to refund.' };
    }
    // Pounds and pence, no fractions of a penny — a refund is sent to Stripe in
    // whole pence, and rounding one the admin typed would refund a figure they
    // did not choose.
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
        return { ok: false, field: 'amount', error: 'Enter the amount in pounds and pence.' };
    }
    if (r2(amount) > refundable) {
        return { ok: false, field: 'amount', error: 'That is more than the £' + refundable.toFixed(2) + ' left to refund.' };
    }

    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < REFUND_REASON_MIN) {
        return { ok: false, field: 'reason', error: 'Say why, in a sentence — the guest and the provider both see it.' };
    }
    if (reason.length > REFUND_REASON_MAX) {
        return { ok: false, field: 'reason', error: 'Keep the reason under ' + REFUND_REASON_MAX + ' characters.' };
    }

    return { ok: true, amount: r2(amount), reason };
}

// THE STRIPE IDEMPOTENCY KEY FOR AN ADMIN REFUND.
//
// Built from the id of the service_order_refunds row, which the DATABASE
// generates and which is written BEFORE Stripe is called. Why that and nothing
// else:
//   * it is never reset — the row exists once and its id never changes, so a
//     retry of this request (a network drop, Stripe's own replay) is the same
//     refund, not a second one;
//   * it is unique per refund decision — an admin refunding £20 today and
//     another £20 tomorrow makes two rows and two keys, where a key built from
//     the order id plus the amount would replay the first and silently send
//     nothing (or, after Stripe forgets it at 24h, send it twice);
//   * nothing the browser sends is in it, and no timestamp is.
// A double-click is stopped before it gets this far: only one refund row per
// order may be 'pending' (a unique index), so the second click has no row and
// never reaches Stripe.
export function adminRefundKey(requestId: string): string {
    if (!requestId) throw new Error('adminRefundKey: no refund request id');
    return 'admin-exp-refund-' + requestId;
}

// Which orders can be refunded here: money that was actually taken and is still
// ours or the provider's — a confirmed order, or a guest walk-away (cancelled
// inside the window with the money kept, cancel_ack set). An authorised hold has
// nothing captured (cancel it, don't refund it); a declined, expired or already
// refunded order has nothing left.
export function orderIsRefundable(order: { status?: string | null; cancel_ack?: unknown; stripe_payment_intent_id?: string | null } | null | undefined): boolean {
    if (!order || !order.stripe_payment_intent_id) return false;
    if (order.status === 'confirmed') return true;
    return order.status === 'cancelled' && !!order.cancel_ack;
}
