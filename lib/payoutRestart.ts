// Changing who a payout account is for (an individual or a company) after the
// host has started Stripe's form.
//
// Stripe owns business_type on an Express account once its onboarding has
// begun: our update is refused ("This application does not have the required
// permissions for the parameter 'business_type'"). Stripe's answer is a new
// account of the right type. That's only safe while the old one has never been
// usable — no details submitted, no charges, no payouts — so no money can ever
// have been routed to it. Then the host starts Stripe's form again; nothing on
// our side changes except which Stripe account their profile points at.

export type BusinessType = 'individual' | 'company';

export function isBusinessType(v: unknown): v is BusinessType {
    return v === 'individual' || v === 'company';
}

/** The old account was never finished or used, so replacing it loses nothing that matters. */
export function mayRestartPayoutAccount(account: any): boolean {
    return !!account
        && account.details_submitted !== true
        && account.charges_enabled !== true
        && account.payouts_enabled !== true;
}

export function typeLabel(t: unknown): string {
    return t === 'company' ? 'a company' : 'an individual';
}

/** What to tell a host whose change Stripe refused. */
export function restartMessage(current: unknown, wanted: BusinessType, canRestart: boolean): string {
    if (!canRestart) {
        return 'Your payout account is already set up for ' + typeLabel(current) + '. To change it to '
            + typeLabel(wanted) + ', reply to any of our emails or contact us and we’ll set it up again with you.';
    }
    return 'You started payout setup with Stripe as ' + typeLabel(current) + ', and Stripe can’t change that part-way through. '
        + 'To be paid as ' + typeLabel(wanted) + ', start Stripe’s form again. Nothing on Galloway Getaways changes, and your payouts stay safe with us until it’s done.';
}
