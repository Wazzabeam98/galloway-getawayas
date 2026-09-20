// Who may see a booked experience, and — the wall — who may see what it cost.
//
// The order page admits the booker and, now, an accepted companion (the same way
// the cottage side lets a companion see the arrival page). A companion may see
// the reservation but NEVER the price, and that exclusion is SERVER-SIDE, not a
// hidden element: the price is a curtain if the page merely declines to render
// it, a wall only if the number never leaves the server for that viewer.
//
// Two layers make it a wall, mirroring /api/trips' money-strip:
//   1. The order is read with a column list that OMITS every money field, so a
//      companion's query cannot fetch the price at all. The price is fetched in
//      a SECOND query that runs ONLY for the booker.
//   2. Defence in depth: the order object is stripped of any money key before it
//      is returned, so even a future change that widened the select cannot leak
//      the number into a companion's payload.

// Every column the order page reads that is NOT money — safe for anyone allowed
// to see the reservation (the booker or an accepted companion).
export const ORDER_SAFE_COLUMNS =
    'id, guest_id, provider_id, listing_id, booking_id, parent_order_id, status, shape, service_date, service_time, item_unit, ' +
    'item_name, item_description, provider_business_name, allergy, note, attendees, adults, children, ' +
    'duration_minutes, fulfilment, service_address';

// The money fields on a service_order — HOW MUCH. Added to the select only for
// the booker, and stripped from any object bound for a companion.
export const ORDER_MONEY_COLUMNS = ['price', 'unit_price', 'commission_rate', 'amount_refunded'] as const;

// The select the order page issues, per viewer. A companion never gets the money
// columns in the string, so PostgREST never returns them.
export function orderColumns(canSeeMoney: boolean): string {
    return canSeeMoney
        ? ORDER_SAFE_COLUMNS + ', ' + ORDER_MONEY_COLUMNS.join(', ')
        : ORDER_SAFE_COLUMNS;
}

// Drop every money key from an order-shaped object. Used on the companion path so
// no amount can ride out even if the row arrived carrying one.
export function stripMoney<T extends Record<string, unknown>>(order: T): T {
    const copy: Record<string, unknown> = { ...order };
    for (const key of ORDER_MONEY_COLUMNS) delete copy[key];
    return copy as T;
}

export type ViewerRole = 'booker' | 'companion';

export interface LoadedExperienceOrder {
    // The order, money-stripped. Null when there is no order, or the viewer is
    // neither the booker nor an accepted companion (the caller then redirects).
    order: Record<string, any> | null;
    role: ViewerRole | null;
    // The price, in the order's currency units, for the BOOKER only. Always null
    // for a companion — the wall.
    price: number | null;
}

// A minimal shape for the admin (service-role) client, enough to test against a
// stub. The real one is @supabase/supabase-js createClient.
interface AdminLike {
    from: (table: string) => any;
}

// Load an experience order for a viewer, applying the money wall. `admin` is the
// service-role client; RLS is enforced here in code, not by the client, exactly
// as the rest of the order page does its own ownership checks.
export async function loadExperienceOrder(
    admin: AdminLike,
    orderId: string,
    userId: string,
): Promise<LoadedExperienceOrder> {
    // Step 1 — the safe columns only. No money field is even named, so the price
    // cannot come back on this query whoever the viewer turns out to be.
    const { data: raw } = await admin
        .from('service_orders')
        .select(ORDER_SAFE_COLUMNS)
        .eq('id', orderId)
        .maybeSingle();
    if (!raw) return { order: null, role: null, price: null };

    let role: ViewerRole | null = raw.guest_id === userId ? 'booker' : null;
    if (!role) {
        // An accepted companion on THIS order — a booking_guests row keyed on the
        // order, claimed by this user. `booking_id` is null for such a row, so an
        // experience companion never matches the stay's door-code entitlement.
        const { data: seat } = await admin
            .from('booking_guests')
            .select('id')
            .eq('order_id', orderId)
            .eq('user_id', userId)
            .eq('status', 'active')
            .maybeSingle();
        if (seat) role = 'companion';
    }
    if (!role) return { order: null, role: null, price: null };

    // Always hand back a money-stripped order (belt-and-braces layer 2).
    const order = stripMoney(raw as Record<string, unknown>);

    // Step 2 — the price, in its own query, for the booker alone.
    let price: number | null = null;
    if (role === 'booker') {
        const { data: money } = await admin
            .from('service_orders')
            .select('price')
            .eq('id', orderId)
            .maybeSingle();
        price = money && money.price != null ? Number(money.price) : null;
    }

    return { order, role, price };
}
