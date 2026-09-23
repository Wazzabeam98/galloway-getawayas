// The three stages of an experience, as shown on the listing and the order page.
//
// Every experience is authored as three phases (guest_details.itinerary details,
// by position). What those phases are CALLED is derived here, from the shape and
// — for a made-to-order item — its collection/delivery setting, so a category can
// never invent its own headings and a collection-only baker never reads
// "Delivery":
//
//   made_to_order → Order · Made to order · Collection|Delivery
//   everything else → Arrival · During · Finish
//
// The provider writes the text under each; this decides only the headings and
// their icons. Titles come from POSITION, never from whatever title string a row
// happens to carry, so old rows (or a seed) with per-type titles still render the
// one generic set.

import { shapeOf } from './serviceSlots';

export type StepIcon = 'arrival' | 'during' | 'finish' | 'order' | 'prep' | 'collect' | 'deliver';

export interface StepHeading {
    title: string;
    icon: StepIcon;
}

export interface ExperienceStep extends StepHeading {
    detail: string;
}

// `fulfilment` here is the RESOLVED collection/delivery answer for the item
// (see lib/serviceProviders.itemFulfilment): 'delivery' means it travels.
export function stepHeadings(shape: string | null | undefined, fulfilment: string | null | undefined): StepHeading[] {
    if (shapeOf({ shape }) === 'made_to_order') {
        const delivers = String(fulfilment || '') === 'delivery';
        return [
            { title: 'Order', icon: 'order' },
            { title: 'Made to order', icon: 'prep' },
            delivers ? { title: 'Delivery', icon: 'deliver' } : { title: 'Collection', icon: 'collect' },
        ];
    }
    return [
        { title: 'Arrival', icon: 'arrival' },
        { title: 'During', icon: 'during' },
        { title: 'Finish', icon: 'finish' },
    ];
}

// The three fixed headings, filled with the provider's authored detail by
// position. A phase with no detail is dropped, so a provider who wrote only two
// shows two — but the ones shown always carry the generic/real heading.
export function experienceSteps(
    shape: string | null | undefined,
    fulfilment: string | null | undefined,
    itinerary: Array<{ title?: string | null; detail?: string | null }> | null | undefined,
): ExperienceStep[] {
    const headings = stepHeadings(shape, fulfilment);
    const rows = Array.isArray(itinerary) ? itinerary : [];
    const out: ExperienceStep[] = [];
    for (let i = 0; i < headings.length; i++) {
        const detail = String((rows[i] && rows[i]!.detail) || '').trim();
        if (!detail) continue;
        out.push({ ...headings[i], detail });
    }
    return out;
}
