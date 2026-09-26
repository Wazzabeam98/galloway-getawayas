// The money for a reservation change, done as a DIFF, not a fresh re-quote.
//
// The bug a re-quote caused: pricing the whole new stay at today's rates and
// subtracting the old total meant adding a night could come back as a REFUND
// whenever current rates were below what the guest first paid. That is wrong —
// a guest who adds a night should never be paid to do so.
//
// The rule instead:
//   * nights already booked KEEP the price the guest paid (they don't move);
//   * ADDED nights are charged at today's rate;
//   * REMOVED nights are refunded at what was paid for them;
//   * the extra-guest fee covers only its own nights and guests.
// So an extension or an extra guest is a charge (or zero), never a refund; only
// giving nights or guests back returns money. new_total is the old total plus
// this diff, so the two can never disagree.

function round2(v: number): number {
    return Math.round(Number(v || 0) * 100) / 100;
}

export interface ChangeMoneyInput {
    oldNightKeys: string[];                 // the old stay's night date keys
    newNightKeys: string[];                 // the new stay's night date keys
    paidRate: Record<string, number>;       // date key -> room rate the guest PAID (nightly_breakdown)
    currentRate: Record<string, number>;    // date key -> today's room rate (for added nights)
    oldChargeableGuests: number;            // guests above the included number, old
    newChargeableGuests: number;            // guests above the included number, new
    extraGuestFee: number;                  // per chargeable guest (per night, or per stay)
    perNightGuestFee: boolean;              // extra_guest_period !== 'stay'
    oldPets: number;
    newPets: number;
    petFee: number;                         // charged once per stay when pets > 0
    oldTotal: number;
}

export interface ChangeMoney {
    delta: number;        // new_total - old_total: > 0 charge, < 0 refund, 0 no money
    newTotal: number;
    addedNights: number;
    removedNights: number;
    // The change split so a caller can apply the cancellation policy to exactly
    // the part the policy governs — a NET LOSS of nights — and nothing else.
    //   * nightNet   — added nights (today's rate) MINUS removed nights (what was
    //                  paid). The removed nights net against the added ones, so a
    //                  date MOVE onto pricier nights is a charge, onto cheaper
    //                  nights a refund, with no cancellation penalty on top.
    //   * feeNet     — the guest- and pet-fee change (+ charge, − refund). Never a
    //                  night, so never scaled by the policy.
    //   * removedNightsValue — what was paid for the dropped nights, for the copy
    //                  that tells a guest how much a shortening forfeits.
    // nightNet + feeNet === delta.
    nightNet: number;
    feeNet: number;
    removedNightsValue: number;
}

export function changeMoney(i: ChangeMoneyInput): ChangeMoney {
    const oldSet = new Set(i.oldNightKeys);
    const newSet = new Set(i.newNightKeys);
    const added = i.newNightKeys.filter((k) => !oldSet.has(k));
    const removed = i.oldNightKeys.filter((k) => !newSet.has(k));

    // Added nights at today's rate; removed nights refunded at what was paid
    // (falling back to today's rate only when there is no stored price).
    const addedSum = added.reduce((s, k) => s + Number(i.currentRate[k] || 0), 0);
    const removedSum = removed.reduce((s, k) => {
        const paid = i.paidRate[k];
        return s + Number(paid !== undefined ? paid : (i.currentRate[k] || 0));
    }, 0);
    const nightsDelta = addedSum - removedSum;

    const oldNights = i.oldNightKeys.length;
    const newNights = i.newNightKeys.length;
    // The extra-guest fee is (fee x chargeable-guests) per night, or per stay.
    // Diffing new against old means an added guest or an added night can only add
    // to it, and only giving one back subtracts — never a refund on an extension.
    const guestFeeDelta = i.perNightGuestFee
        ? i.extraGuestFee * (i.newChargeableGuests * newNights - i.oldChargeableGuests * oldNights)
        : i.extraGuestFee * (i.newChargeableGuests - i.oldChargeableGuests);

    // The pet fee is a single per-stay charge: gained if pets appear, refunded if
    // they go, otherwise unchanged.
    const petFeeDelta = i.petFee * ((i.newPets > 0 ? 1 : 0) - (i.oldPets > 0 ? 1 : 0));

    // Nights net against nights (a move), fees against fees. Keeping them apart is
    // what lets the policy touch only a net loss of nights and leave a move — or a
    // fee change — settling in full.
    const nightNet = round2(nightsDelta);
    const feeNet = round2(guestFeeDelta + petFeeDelta);

    const delta = round2(nightNet + feeNet);
    return {
        delta, newTotal: round2(Number(i.oldTotal) + delta),
        addedNights: added.length, removedNights: removed.length,
        nightNet, feeNet, removedNightsValue: round2(removedSum),
    };
}

// Fold the cancellation policy into a change's money. The policy governs ONE
// thing — a net loss of nights — and nothing else:
//
//   * A date MOVE (the same number of nights, or more) settles in full. The added
//     nights are charged at today's rate and the removed ones credited at what was
//     paid, netted against each other: moving onto pricier nights charges the
//     difference, onto cheaper nights refunds it, with no cancellation penalty.
//   * Only when nights are given back on NET (removedNights > addedNights) and that
//     net is a refund is it a partial cancellation. That net refund is scaled by
//     `fraction` — 1 inside the free window or when the host proposes it, the
//     tier's share otherwise — and the guest forfeits the rest (kept by the host,
//     so the booking total rises by exactly the retained penalty).
//   * Fees (guest / pet) are never nights, so they settle in full either way.
//
//   fraction 1  → delta === nightNet + feeNet   (the plain diff)
//   fraction <1 → applies only if nights were lost on net AND that net is a refund;
//                 the guest is refunded less and net paid, balance and payout stay
//                 in step through the higher booking total.
export function applyChangePolicy(
    oldTotal: number,
    m: { nightNet: number; feeNet: number; addedNights: number; removedNights: number },
    fraction: number,
): { delta: number; newTotal: number } {
    const f = Math.max(0, Math.min(1, Number(fraction)));
    const netLossOfNights = Number(m.removedNights || 0) > Number(m.addedNights || 0);
    // Scale only a net-loss refund. A charge (nightNet ≥ 0), or a move that nets a
    // refund without losing nights, is paid/refunded in full.
    const nightContribution = (netLossOfNights && Number(m.nightNet) < 0)
        ? round2(Number(m.nightNet) * f)
        : round2(Number(m.nightNet || 0));
    const net = round2(nightContribution + Number(m.feeNet || 0));
    return { delta: net, newTotal: round2(Number(oldTotal || 0) + net) };
}

// The plain-language warning a guest must see before sending a shortening that
// won't come back in full: only for a guest-proposed net loss of nights whose net
// is a refund and whose fraction is below 1. Returns null when there is nothing to
// warn about (a move, an increase, a host proposal, or a full refund).
export function shorteningNotice(
    m: { nightNet: number; addedNights: number; removedNights: number },
    fraction: number,
    policyName: string,
): string | null {
    const f = Math.max(0, Math.min(1, Number(fraction)));
    const netLossOfNights = Number(m.removedNights || 0) > Number(m.addedNights || 0);
    if (!netLossOfNights || Number(m.nightNet) >= 0 || f >= 1) return null;
    const forfeit = round2(Math.abs(Number(m.nightNet)) * (1 - f));
    if (forfeit <= 0) return null;
    if (f <= 0) {
        return `Under the ${policyName} policy you won’t get a refund for the nights you drop.`;
    }
    const pct = Math.round(f * 100);
    return `Under the ${policyName} policy you’ll only get ${pct}% back on the nights you drop — you forfeit £${forfeit.toFixed(2)}.`;
}
