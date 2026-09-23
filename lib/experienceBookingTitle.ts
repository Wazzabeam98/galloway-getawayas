// How a booked experience names itself across the guest's surfaces (the order
// page, Your trips, the homepage upcoming panel and the emails).
//
// A booking leads with the LISTING name — the provider's business name, e.g.
// "Harbour Yoga", "Galloway Bakehouse" or "Solway Table" — and carries the
// chosen item ("Sunrise yoga class", "Celebration cake", "Whole private dinner")
// beneath as a detail. A listing is the thing you booked; the item is which of
// its options you picked, so the item reads as a particular of the booking, not
// its identity. Only when there is no business name to lead with does the item
// stand in as the title.
export function experienceBookingTitle(o: {
    shape?: string | null;
    item_name?: string | null;
    provider_business_name?: string | null;
}): { title: string; detail: string | null } {
    const item = o.item_name || null;
    const provider = o.provider_business_name || null;
    if (provider) {
        return { title: provider, detail: item };
    }
    return { title: item || 'Experience', detail: null };
}
