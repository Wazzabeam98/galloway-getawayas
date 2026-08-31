import { createHash, createHmac } from 'crypto';

// The card link, derived in one place and recognised in one place.
//
// WHY A TOKEN AND NOT A LOGIN
//
// The same reason the enquiry reply link is a token: a tradesman has nowhere
// to sign in. `service_providers` is written by the sign-up and read by the
// admin queue, and there is no provider-facing page on the site. An emailed
// link that works on its own is not a convenience here, it is the entire
// mechanism — and the man we are asking for £20 a month is, quite often, up a
// ladder.
//
// WHY THIS ONE IS DERIVED AND THE ENQUIRY ONE IS RANDOM
//
// The enquiry token is minted once, stored as a hash, and put in exactly one
// email. This one goes in up to four emails sent weeks apart, and all four
// have to keep working: a man who opens the fourteen-day email three days late
// must not be told his link is dead. Only the hash is stored, so a random
// token could not be put in a second email without either storing it in the
// clear or re-minting and killing the first link.
//
// So it is derived: HMAC of the provider's id under a server-side secret. The
// same provider always produces the same link, no clear token is ever stored,
// and a leaked database row still does not yield a working link because the
// secret is not in the database.
//
// BILLING_TOKEN_SECRET IS ITS OWN SECRET, deliberately not borrowed from the
// service role key or the cron secret. A secret used for two purposes cannot
// be rotated for one of them, and the day somebody rotates the cron secret
// every card link in every inbox would quietly stop working.
//
// WHAT A LEAKED TOKEN CAN AND CANNOT DO
//
// It can open a Stripe Checkout page for that provider's subscription. That is
// the whole of it. Whoever holds it can volunteer to pay somebody else's bill,
// which is not an attack anybody runs.
//
// It cannot read anything the site does not already show — the billing page
// gives the business name and the price. It cannot move, cancel or view an
// existing subscription: Stripe holds all of that and this is not a Stripe
// credential. And it cannot be replayed into a charge, because the card is
// authorised on Stripe's own page by whoever is sitting at it.
//
// SERVER ONLY. It imports node crypto, so it must never be pulled into a
// client component.

export function billingSecret(): string | null {
    const s = process.env.BILLING_TOKEN_SECRET;
    return s ? String(s) : null;
}

// The link for one provider. Null when the secret is not configured, so the
// caller can refuse to send an email containing a broken link rather than
// sending one and finding out from the tradesman.
export function billingTokenFor(providerId: string): string | null {
    const secret = billingSecret();
    if (!secret) return null;
    if (!providerId) return null;

    return createHmac('sha256', secret)
        .update('billing:' + String(providerId))
        .digest('base64url')
        // 32 characters, matching the reply token's length so both links look
        // the same in an email and neither wraps differently.
        .slice(0, 32);
}

// What is stored and looked up. Hashing a derived token is not redundant: it
// means a database dump does not contain the token even in the presence of a
// leaked secret being used later, and it keeps the lookup identical in shape
// to the enquiry one.
export function hashBillingToken(token: string): string {
    return createHash('sha256').update(String(token || '')).digest('hex');
}
