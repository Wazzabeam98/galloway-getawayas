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

    const delta = round2(nightsDelta + guestFeeDelta + petFeeDelta);
    return { delta, newTotal: round2(Number(i.oldTotal) + delta), addedNights: added.length, removedNights: removed.length };
}
