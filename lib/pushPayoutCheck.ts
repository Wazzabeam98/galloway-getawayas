// "Your payout details were changed" — a security alert, so it always sends.
//
// Bank details are changed inside Stripe's own pages, and the only trace that
// reaches us is the account.updated webhook stamping stripe_updated_at. A
// trigger turns that stamp into a 'security.payout_check' row; this handles the
// row in the push job: it READS the connected account's payout destination from
// Stripe (a GET — nothing is created, moved or changed at Stripe) and compares
// its fingerprint with the one seen last time. Different → push. The first
// fingerprint seen for an account is recorded quietly as the baseline, because
// there is nothing to compare it with.

import { stripeRequest } from './stripe';
import type { RowOutcome } from './pushDispatch';
import { deliverRow } from './pushDispatch';

export function destinationFingerprint(account: any): string | null {
    const list = account && account.external_accounts && account.external_accounts.data;
    if (!Array.isArray(list) || list.length === 0) return null;
    const pick = list.find((x: any) => x && x.default_for_currency) || list[0];
    return [pick.object, pick.fingerprint || '', pick.last4 || '', pick.routing_number || pick.bank_name || ''].join(':');
}

export async function payoutCheck(admin: any, row: any, fetchAccount?: (id: string) => Promise<any>, send?: Parameters<typeof deliverRow>[2]): Promise<RowOutcome | null> {
    if (row.kind !== 'security.payout_check') return null;
    const accountId = row.context && row.context.stripe_account_id;
    if (!accountId) return { status: 'skipped', result: { reason: 'no account' } };

    const account = fetchAccount
        ? await fetchAccount(accountId)
        : await stripeRequest('GET', '/accounts/' + encodeURIComponent(accountId));
    const fingerprint = destinationFingerprint(account);
    if (!fingerprint) return { status: 'skipped', result: { reason: 'no payout destination yet' } };

    const { data: seen } = await admin
        .from('payout_destinations_seen')
        .select('fingerprint')
        .eq('stripe_account_id', accountId)
        .maybeSingle();

    await admin.from('payout_destinations_seen').upsert({
        stripe_account_id: accountId,
        user_id: row.user_id,
        fingerprint,
        seen_at: new Date().toISOString(),
    }, { onConflict: 'stripe_account_id' });

    if (!seen) return { status: 'skipped', result: { reason: 'baseline recorded' } };
    if (seen.fingerprint === fingerprint) return { status: 'skipped', result: { reason: 'unchanged' } };

    return deliverRow(admin, {
        ...row,
        title: 'Your payout details were changed',
        body: 'If you didn’t do this, contact us straight away.',
        url: row.url || '/account?section=payments',
    }, send);
}
