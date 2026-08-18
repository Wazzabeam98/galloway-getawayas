// One place for what the platform charges.
//
// Almost every listing is on the standard rate. A listing may carry its own
// rate — a host given free hosting in exchange for something else, say — and
// that is set only by an owner on the admin screen. A listing with no rate of
// its own falls back to the standard one.

export const DEFAULT_COMMISSION_PERCENT = 10;

// A missing or unreadable rate always means the standard rate, never zero, so
// a glitch can't quietly give away free hosting.
export function rateFor(listing: { commission_rate?: number | null } | null | undefined): number {
    if (!listing) return DEFAULT_COMMISSION_PERCENT;
    const rate = listing.commission_rate;
    if (rate === null || rate === undefined) return DEFAULT_COMMISSION_PERCENT;
    const parsed = Number(rate);
    return isNaN(parsed) ? DEFAULT_COMMISSION_PERCENT : parsed;
}

export function netOfFee(gross: number, percent: number): number {
    return Math.round(gross * (1 - percent / 100) * 100) / 100;
}

export function feeAmount(gross: number, percent: number): number {
    return Math.round(gross * (percent / 100) * 100) / 100;
}
