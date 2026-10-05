// The one property question a host is asked when they enquire with a gardener
// or a window cleaner — moved here from the listing editor's old "For local
// services" section. The answer still lives on the listing (listings.plot_band
// / listings.storey_band), so anything already saved is the starting answer and
// one answer serves every later enquiry for that property.
//
// Framework-free: the enquiry form asks with it and the enquiry route checks
// with it, so the two can't disagree about which trade gets which question.

import { PLOT_BANDS, STOREY_BANDS, bandForPlot, bandForStoreys } from './serviceProviders';

export type PropertyColumn = 'plot_band' | 'storey_band';

export interface PropertyQuestion {
    column: PropertyColumn;
    label: string;
    // Shown on the tradesman's email beside the answer.
    rowLabel: string;
    options: ReadonlyArray<{ key: string; label: string }>;
}

const QUESTIONS: Record<string, PropertyQuestion> = {
    trees: { column: 'plot_band', label: 'The garden or grounds', rowLabel: 'Garden', options: PLOT_BANDS },
    droplet: { column: 'storey_band', label: 'How high the windows go', rowLabel: 'Windows', options: STOREY_BANDS },
};

export function propertyQuestionFor(trade: string | null | undefined): PropertyQuestion | null {
    return QUESTIONS[String(trade || '')] || null;
}

// A valid answer for this trade's question, or null. A blank or unknown value
// is null, which the route treats as "not answered" — never as "clear the
// answer already saved".
export function propertyAnswer(trade: string | null | undefined, value: unknown): { column: PropertyColumn; key: string } | null {
    const q = propertyQuestionFor(trade);
    if (!q) return null;
    const key = q.column === 'plot_band' ? bandForPlot(String(value || '')) : bandForStoreys(String(value || ''));
    return key ? { column: q.column, key } : null;
}

// The answer's words for the email row, or null when the listing has none.
export function propertyAnswerLabel(trade: string | null | undefined, listing: any): string | null {
    const q = propertyQuestionFor(trade);
    if (!q || !listing) return null;
    const found = q.options.find((o) => o.key === listing[q.column]);
    return found ? found.label : null;
}
