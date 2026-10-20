// The cancellation terms an experience order was BOOKED under.
//
// An order carries its own copy of the provider's terms, stamped at checkout
// (service_orders.cancellation_window_hours + no_refund, migration
// 20261020113926) — the experience twin of bookings.cancellation_policy. Every
// rule about an existing order (the cancel route's refund, the change/move
// windows, the "free to cancel" line a guest is shown) reads the order's stamp
// through here, so a provider changing their policy later never rewrites the
// terms of an order already paid for.
//
// The provider's live terms are used for two things only: stamping a NEW order
// (termsToStamp), and an order written before the stamp existed (a null window).

export interface OrderCancelTerms {
    windowHours: number;
    noRefund: boolean;
}

type ProviderTerms = { cancellation_window_hours?: number | null; guest_details?: any } | null | undefined;
type OrderStamp = { cancellation_window_hours?: number | null; no_refund?: boolean | null } | null | undefined;

// A window of 0 (or nothing readable) reads as the 48-hour default, as every
// refund path has always done; "No refund" is carried by noRefund, not by 0.
function windowOf(raw: any): number {
    return Number(raw) || 48;
}

// What a NEW order is stamped with — the provider's terms right now, stored as
// they are (the migration's backfill copies the raw column the same way).
export function termsToStamp(provider: ProviderTerms): { cancellation_window_hours: number; no_refund: boolean } {
    const raw = provider && provider.cancellation_window_hours;
    return {
        cancellation_window_hours: raw == null ? 48 : Math.max(0, Math.floor(Number(raw) || 0)),
        no_refund: !!(provider && provider.guest_details && provider.guest_details.no_refund === true),
    };
}

// The same stamp, as Stripe metadata strings, for an order the webhook writes
// from a Checkout session (the request/cart shape).
export function termsMetadata(provider: ProviderTerms): { cancellation_window_hours: string; no_refund: string } {
    const t = termsToStamp(provider);
    return { cancellation_window_hours: String(t.cancellation_window_hours), no_refund: t.no_refund ? '1' : '' };
}

// Read the stamp back out of that metadata. A session created before the stamp
// carries neither key → null, and the order falls back to the live terms.
export function termsFromMetadata(md: any): { cancellation_window_hours: number; no_refund: boolean } | null {
    if (!md || md.cancellation_window_hours === undefined || md.cancellation_window_hours === '') return null;
    const h = Math.floor(Number(md.cancellation_window_hours));
    if (!Number.isFinite(h) || h < 0) return null;
    return { cancellation_window_hours: h, no_refund: md.no_refund === '1' };
}

// The terms that govern THIS order: its stamp, or — only for an order written
// before the stamp existed — the provider's live terms.
export function orderCancelTerms(order: OrderStamp, provider: ProviderTerms): OrderCancelTerms {
    if (order && order.cancellation_window_hours != null) {
        return { windowHours: windowOf(order.cancellation_window_hours), noRefund: order.no_refund === true };
    }
    return {
        windowHours: windowOf(provider && provider.cancellation_window_hours),
        noRefund: !!(provider && provider.guest_details && provider.guest_details.no_refund),
    };
}

// A child row (added places, a guest-count change) rides on its parent's terms —
// the cancel route settles the family under the parent's — so it carries the
// parent's stamp, not whatever the provider's policy is by the time it is added.
export function inheritedStamp(parent: OrderStamp, provider: ProviderTerms): { cancellation_window_hours: number; no_refund: boolean } {
    if (parent && parent.cancellation_window_hours != null) {
        return { cancellation_window_hours: Number(parent.cancellation_window_hours), no_refund: parent.no_refund === true };
    }
    return termsToStamp(provider);
}
