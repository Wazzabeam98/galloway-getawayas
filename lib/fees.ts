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
// A host-sold extra — a sauna pack, a hamper — is the host's own supply, and we
// take nothing on it (Airbnb takes nothing on a Resolution-Center extra). So the
// commissionable amount is what was collected MINUS the extras' share of it.
//
// The deposit, the balance and any refund all move in proportion to the booking
// total, so the extras' share of what has actually been collected is the same
// fraction at every stage — extras_total over the frozen total_price. A booking
// with no extras (extrasTotal 0) returns the whole collected figure unchanged,
// so every existing booking's payout is identical to the penny.
export function commissionableCollected(collected: number, totalPrice: number, extrasTotal: number): number {
    const total = Number(totalPrice) || 0;
    const extras = Number(extrasTotal) || 0;
    const kept = Number(collected) || 0;
    if (!(total > 0) || !(extras > 0)) return Math.round(kept * 100) / 100;
    const commissionableFraction = Math.max(0, (total - extras) / total);
    return Math.round(kept * commissionableFraction * 100) / 100;
}
