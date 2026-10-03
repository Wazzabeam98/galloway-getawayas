import { stripeRequest } from '@/lib/stripe';
import { logError } from '@/lib/logError';
import { logMoneyFailure } from '@/lib/moneyAlert';
import { sendEmail, emailLayout, button, SITE_URL } from '@/lib/email';
import { round2 } from '@/lib/hostDebt';

// Put a completed "Pay now" Checkout session against the host's debt.
//
// ONE function, called by the webhook (checkout.session.completed, kind
// 'host_debt_settle') and by the reconcile sweep in /api/cron/host-debts when
// that webhook never arrived — so the two can never drift apart. Safe to call
// any number of times for one session: apply_host_debt_payment records a
// session once and answers every later call as a duplicate, and the excess
// refund carries an idempotency key on the session.
//
// It never applies more than is still outstanding. The payout run may have
// recovered part of the debt while the host was on the payment page, or the
// host may have disputed it in the meantime; whatever was not needed is
// refunded to their card here.
export async function settleHostDebtSession(
    admin: any,
    cs: any,
): Promise<{ applied: number; excess: number; duplicate?: boolean; skipped?: string }> {
    const payoutId = cs.metadata && cs.metadata.payout_id;
    const hostId = cs.metadata && cs.metadata.host_id;
    const pi = typeof cs.payment_intent === 'string' ? cs.payment_intent : (cs.payment_intent && cs.payment_intent.id) || null;
    const paid = round2(Number(cs.amount_total || 0) / 100);

    if (!payoutId || !hostId || !pi || !(paid > 0) || cs.payment_status !== 'paid') {
        await logMoneyFailure(
            'host debt: a completed "Pay now" session was missing what is needed to apply it — check it at Stripe',
            { session: cs.id, payout_id: payoutId, host_id: hostId, payment_status: cs.payment_status },
            { path: 'lib/hostDebtSettle' },
        );
        return { applied: 0, excess: 0, skipped: 'incomplete' };
    }

    const { data: appliedRows, error: applyError } = await admin.rpc('apply_host_debt_payment', {
        p_payout: payoutId, p_host: hostId, p_amount: paid, p_session: cs.id, p_intent: pi,
    });
    const result = Array.isArray(appliedRows) ? appliedRows[0] : appliedRows;
    if (applyError || !result) {
        await logMoneyFailure(
            'host debt: a host paid £' + paid.toFixed(2) + ' but it was not put against their debt — '
                + 'the host-debts sweep retries it; if this repeats, check the debt row',
            { error: applyError, session: cs.id, payout_id: payoutId, host_id: hostId, payment_intent: pi },
            { path: 'lib/hostDebtSettle' },
        );
        return { applied: 0, excess: 0, skipped: 'not-applied' };
    }
    if (result.duplicate) return { applied: 0, excess: 0, duplicate: true };

    const applied = round2(Number(result.applied || 0));
    const excess = round2(Number(result.excess || 0));

    if (excess > 0) {
        try {
            await stripeRequest('POST', '/refunds', {
                payment_intent: pi,
                amount: Math.round(excess * 100),
                metadata: { kind: 'host_debt_excess', payout_id: payoutId },
            }, 'host-debt-excess-' + cs.id);
            await admin.from('host_debt_payments')
                .update({ excess_refunded_at: new Date().toISOString() })
                .eq('stripe_checkout_session_id', cs.id);
        } catch (refundErr) {
            await logMoneyFailure(
                'host debt: a host overpaid £' + excess.toFixed(2) + ' and it could not be refunded — refund it at Stripe',
                { error: refundErr, session: cs.id, payment_intent: pi, payout_id: payoutId },
                { path: 'lib/hostDebtSettle' },
            );
        }
    }

    try {
        const { data: hostUser } = await admin.auth.admin.getUserById(hostId);
        const hostEmail = (hostUser && hostUser.user && hostUser.user.email) || '';
        if (hostEmail) {
            await sendEmail(
                hostEmail,
                applied > 0 ? 'Thanks — £' + applied.toFixed(2) + ' paid' : 'Your payment has been refunded',
                emailLayout(
                    (applied > 0
                        ? '<p style="margin:0 0 16px;font-size:16px;">We’ve received <strong>£' + applied.toFixed(2) + '</strong> towards what you owed.</p>'
                        : '<p style="margin:0 0 16px;font-size:16px;">That amount had already been settled or is under review, so nothing was taken.</p>')
                    + (excess > 0
                        ? '<p style="margin:0 0 16px;font-size:15px;">£' + excess.toFixed(2) + ' was more than was left to pay, and goes back to your card within five to ten days.</p>'
                        : '')
                    + button(SITE_URL + '/dashboard/earnings#owed', 'See your earnings'),
                    'You’re receiving this because you host with Galloway Getaways.',
                ),
            );
        }
    } catch (mailErr) {
        await logError('host debt: receipt email', mailErr, { path: 'lib/hostDebtSettle' });
    }

    return { applied, excess };
}
