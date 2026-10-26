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

// Derived by subtraction, never rounded separately. Rounding both halves
// independently makes them sum to a penny more than was collected on about a
// quarter of pence-ending totals — so the host would be transferred one
// figure and told another. What the host keeps plus what the platform takes
// must equal what the guest paid, exactly, at every amount.
export function feeAmount(gross: number, percent: number): number {
    return Math.round((gross - netOfFee(gross, percent)) * 100) / 100;
}

// The slice of what was collected that commission is taken on.
//
// Commission is taken on the WHOLE of what the guest paid, a host-sold extra
// (a sauna pack, a hamper) included, exactly as it is on the stay itself — the
// platform's agreed cut of every pound collected. So the commissionable figure
// is simply what was collected.
//
// (This was once a carve-out that excluded the extras' share — a deliberate
// "nothing on an extra" decision. It was reversed on 26 October 2026 at the
// owner's instruction: extras now carry our normal commission, like any other
// line. The function is kept so the payout run and the referral record have
// one named source for "the base commission is worked out on".)
export function commissionableCollected(collected: number): number {
    return Math.round((Number(collected) || 0) * 100) / 100;
}
