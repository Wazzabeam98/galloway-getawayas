// What a host owes back, and which payouts it comes off.
//
// A debt is not attached to the stay that caused it. A cancellation penalty or
// a clawback goes onto one running total, `profiles.payout_balance_owed`, and
// the payout run takes as much of it as each stay can bear, in check-in order:
// £45 owed against a £30 payout takes £30 now and £15 off the next one.
//
// Three places need to agree about that: the payout run doing it, the earnings
// page telling a host what to expect, and the booking screen showing why a
// figure is short. They agree by sharing this file. A host being told £126 and
// then paid £111 is the kind of thing that ends a relationship with a host, so
// the arithmetic lives in one place on purpose — the same reason
// `lib/pricing.ts` exists.

export function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export interface OwedRow {
    id: string;
    booking_id: string | null;
    host_id: string;
    // Negative, as stored: a debt is a payout in reverse.
    amount: number;
    kind: string;
    status: string;
    note: string | null;
    created_at: string;
    settled_amount?: number | null;
}

// How much of this debt is still outstanding, as a positive number.
export function outstandingOf(row: OwedRow): number {
    const charged = Math.abs(Number(row.amount || 0));
    const recovered = Number(row.settled_amount || 0);
    const left = round2(charged - recovered);
    return left > 0 ? left : 0;
}

// Walk a balance along a queue, taking as much from each place as it can bear.
//
// Returns what comes off each one, in the order given. The caller decides what
// the order means: oldest debt first when recovering, earliest stay first when
// predicting. Nothing is taken beyond the balance, and nothing beyond what a
// single item can absorb.
export function spread(balance: number, capacities: number[]): number[] {
    let left = round2(balance > 0 ? balance : 0);

    return capacities.map(function (capacity) {
        const room = round2(capacity > 0 ? capacity : 0);
        const take = round2(Math.min(left, room));
        left = round2(left - take);
        return take;
    });
}

// Why this is owed, in words a host reading it would use. The two reasons are
// genuinely different and were sharing one explanation, which described the
// clawback case and quietly mis-stated the other.
export function debtReason(kind: string): string {
    if (kind === 'penalty') {
        return 'Fee for cancelling a confirmed booking';
    }
    if (kind === 'reversal') {
        return 'Refund paid to the guest after the payout had gone';
    }
    return 'Owed back';
}

// The longer version, for the panel in owner tools where somebody may be
// working out what to say to a host who is disputing it.
export function debtExplanation(kind: string): string {
    if (kind === 'penalty') {
        return 'The host cancelled a booking a guest already had confirmed. '
            + 'Nobody had been paid for it — this is the 5% fee, taken off '
            + 'their next payout rather than invoiced.';
    }
    if (kind === 'reversal') {
        return 'A refund went to the guest after this host had already been '
            + 'paid, and it could not be taken back from their Stripe balance. '
            + 'It comes off their next payout.';
    }
    return 'Owed back, reason not recorded.';
}
