// The smallest amount Stripe will take in one GBP payment.
//
// Below it Stripe refuses to open the payment page ("must add up to at least
// £0.30 GBP" — the 22 August 2026 checkout error). A stay can only get there
// through a listing priced at pennies (the editor accepts any price above
// zero), but it must be refused here in plain words rather than surfacing as a
// Stripe error, and a deposit split must never leave either half under it —
// the balance is charged 30 days out, off-session, where the same rule would
// fail it with no guest present.
//
// Free of '@/' imports so the unit test can run it directly.

export const STRIPE_MIN_CHARGE_GBP = 0.3;

export function belowStripeMinimum(amount: number): boolean {
    return !(Math.round(Number(amount) * 100) >= Math.round(STRIPE_MIN_CHARGE_GBP * 100));
}

// Whether a deposit + balance split is workable: both halves must be chargeable.
export function depositSplitChargeable(dueNow: number, balance: number): boolean {
    return !belowStripeMinimum(dueNow) && !belowStripeMinimum(balance);
}
