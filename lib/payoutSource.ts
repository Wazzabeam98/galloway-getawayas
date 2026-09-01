// Which charge a payout is drawn from.
//
// WHY THIS EXISTS AT ALL
//
// A transfer with no `source_transaction` is paid out of the platform's
// AVAILABLE balance. Card money does not land there — it lands in PENDING and
// takes about a week to become available on a UK account. The payout engine
// runs the day after check-in, so a guest who booked and paid a few days
// before arriving is paid out of money that has not settled, and the transfer
// fails with `balance_insufficient`.
//
// It self-heals — the booking is retried the next day — but the host is not
// paid when we said, and the first real payout is the likeliest of all to hit
// it, because the platform balance starts at nothing.
//
// Naming the charge fixes it. Stripe then draws the transfer against that
// specific payment and does not care whether it has settled yet.
//
// WHAT THIS CANNOT DO, AND WHY THAT IS ALL RIGHT
//
// One transfer may name one charge, and may not exceed it. A stay paid as a
// deposit and then a balance has TWO charges, and the host's 90% share is
// usually larger than either of them on its own — so no single charge covers
// it and there is nothing to name. Those fall back to an untied transfer,
// which is what every payout did before this existed.
//
// That fallback is not the dangerous case. A balance is charged thirty days
// before check-in and a deposit earlier still, so both have settled long
// before the payout runs. The money is available and an untied transfer is
// fine. What this covers is the case where it is NOT — a late booking paid in
// full close to arrival, one charge, still pending, which is exactly the
// booking a single `source_transaction` can name.

export interface SourceCharge {
    id: string;
    /** Gross amount of the charge, in pence. */
    amount: number;
}

/**
 * The charge to draw a payout from, or null to leave the transfer untied.
 *
 * Picks the SMALLEST charge that covers the amount. Any covering charge works,
 * and taking the smallest leaves the larger ones free for other bookings that
 * might need them — a charge can only be drawn down to zero across all the
 * transfers naming it.
 */
export function chargeToDrawOn(
    charges: Array<SourceCharge | null | undefined>,
    amountPence: number
): string | null {
    if (!(amountPence > 0)) return null;

    const usable = (charges || [])
        .filter((c): c is SourceCharge => !!c && !!c.id && Number(c.amount) >= amountPence)
        .sort((a, b) => Number(a.amount) - Number(b.amount));

    return usable.length ? usable[0].id : null;
}
