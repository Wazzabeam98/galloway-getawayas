// How a booked experience names itself across the guest's surfaces (the order
// page, Your trips, the homepage upcoming panel and the emails).
//
// A slot experience ("Sunrise yoga class") and a made-to-order one ("Celebration
// cake") each sell an item whose name reads as the experience, so the item name
// is the title. A comes-to-you experience is different: it sells a single menu
// option per booking — "Whole private dinner" — which reads like a dish, not the
// thing you booked. So its booking leads with the LISTING name (the provider's
// business name, e.g. "Solway Table") and carries the item beneath as a detail,
// matching how the other shapes already read a name first with the particulars
// underneath.
export function experienceBookingTitle(o: {
    shape?: string | null;
    item_name?: string | null;
    provider_business_name?: string | null;
}): { title: string; detail: string | null } {
    const item = o.item_name || null;
    const provider = o.provider_business_name || null;
    if (o.shape === 'comes_to_you' && provider) {
        return { title: provider, detail: item };
    }
    return { title: item || provider || 'Experience', detail: null };
}
