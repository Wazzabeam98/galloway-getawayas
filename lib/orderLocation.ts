// Where an order happens.
//
// For a SLOT the direction (the guest comes to the provider, vs the provider
// travels to the cottage) is read from the ORDER's own frozen fulfilment — never
// the provider's live setup. That direction is what the guest booked and must
// not change when the provider edits their fulfilment afterwards; the slot claim
// (app/api/services/slots/book/route.ts) snapshots `fulfilment` onto the order at
// booking, the same way price, item name and slot duration are frozen. So a later
// setup edit can never reach a booked slot.
//
// A MADE-TO-ORDER product (a baker who collects or delivers) still reads the
// provider's live fulfilment — its freeze is a follow-up (it is written in the
// Stripe webhook, a watched money path, so it rides its own change with the
// payment scenarios re-run). Passing the live value in keeps that behaviour
// exactly as it was. A comes-to-you order travels by its frozen SHAPE, so it
// needs neither.
//
// The ADDRESS is never part of this — it stays live from the provider (a moved
// studio must still direct the guest), so this returns only the direction
// booleans and the caller composes the address itself.

export interface OrderLocationInput {
    shape?: string | null;         // 'slot' | 'comes_to_you' | 'made_to_order' | …
    fulfilment?: string | null;    // the order's FROZEN direction (slots)
}

export interface OrderLocationView {
    // A slot the provider travels for → the session runs at the guest's cottage.
    slotTravels: boolean;
    // The provider comes to the cottage: a comes-to-you shape OR a travelling slot.
    comesToCottage: boolean;
    // The guest goes to the provider's address (so the collection-address block
    // shows). Delivery/travel never collects; 'both' still offers collection.
    collects: boolean;
}

// `providerFulfilment` is the provider's LIVE direction, used only for the
// non-slot shapes whose freeze hasn't landed yet. A slot ignores it entirely —
// which is the freeze: for a slot, the result depends on the order alone.
export function orderLocation(
    order: OrderLocationInput,
    providerFulfilment?: string | null,
): OrderLocationView {
    const isSlot = order.shape === 'slot';
    const slotTravels = isSlot && order.fulfilment === 'delivery';
    const comesToCottage = order.shape === 'comes_to_you' || slotTravels;
    // A slot's "collects" reads the frozen order direction; every other shape
    // reads the provider's live value, unchanged from before.
    const direction = isSlot ? order.fulfilment : (providerFulfilment ?? null);
    const collects = direction === 'collection' || direction === 'both';
    return { slotTravels, comesToCottage, collects };
}
