import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { DEFAULT_COMMISSION_PERCENT, netOfFee, feeAmount } from '@/lib/fees';
import { sendEmail, emailLayout, escapeHtml, formatDate, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { outstandingOf, spread } from '@/lib/hostDebt';
import { readSchedule, arrivalSentence } from '@/lib/payoutTiming';
import { chargeToDrawOn } from '@/lib/payoutSource';
import { isAutomatedTestAddress } from '@/lib/testAddresses';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

// The charge to draw a payout from, resolved from the booking's payment
// intents. Null means "nothing covers it", and the transfer goes untied.
//
// Reads Stripe rather than the database because the database stores payment
// INTENTS and a transfer must name a CHARGE. Any failure here returns null:
// this is an optimisation on where the money comes from, and it must never be
// the reason a host goes unpaid.
async function sourceChargeFor(booking: any, amountPence: number): Promise<string | null> {
    const intentIds = [booking.stripe_payment_intent_id, booking.balance_payment_intent_id]
        .filter(function (id) { return !!id; });

    if (!intentIds.length) return null;

    try {
        const charges = await Promise.all(
            intentIds.map(async function (id: string) {
                const intent = await stripeRequest('GET', '/payment_intents/' + id);
                const chargeId = intent && intent.latest_charge;
                if (!chargeId) return null;

                // The intent's amount is what was asked for; the charge's is
                // what was taken. A partial capture makes them differ, and the
                // transfer is limited by what was actually taken.
                const charge = await stripeRequest('GET', '/charges/' + String(chargeId));
                if (!charge || !charge.id || charge.refunded) return null;

                return {
                    id: String(charge.id),
                    amount: Number(charge.amount || 0) - Number(charge.amount_refunded || 0),
                };
            })
        );

        return chargeToDrawOn(charges, amountPence);
    } catch (err) {
        return null;
    }
}

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();

    // A stay pays out the day after check-in, so anything checking in
    // yesterday or earlier is due.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 1);
    const cutoffDate = cutoff.toISOString().split('T')[0];

    // A refund before check-in leaves the stay confirmed but moves the
    // payment to 'partially_refunded', so matching on 'paid' alone meant the
    // host was never paid the remainder. Cancellations set status to
    // 'cancelled' and are still excluded; a stay refunded down to nothing is
    // caught by the `collected <= 0` check below.
    const { data: due, error: dueError } = await admin
        .from('bookings')
        .select('id, listing_id, host_id, check_in, total_price, amount_paid, amount_refunded, commission_rate, status, payment_status, paid_out_at, stripe_payment_intent_id, balance_payment_intent_id')
        .eq('status', 'confirmed')
        .in('payment_status', ['paid', 'partially_refunded'])
        .is('paid_out_at', null)
        .lte('check_in', cutoffDate);

    // Without this the query could fail, `due` would come back empty, and the
    // run would report a cheerful ok:true with nothing sent — identical to a
    // day with no payouts due. Hosts would simply not be paid, quietly.
    if (dueError) {
        await logError('host-payouts: could not load the bookings due for payout', dueError, {
            path: '/api/cron/host-payouts',
        });
        return NextResponse.json(
            { ok: false, error: 'Could not load the bookings due for payout' },
            { status: 500 }
        );
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    // Hosts who cannot be paid because they have not finished onboarding.
    //
    // Counted per host rather than per booking so the report is "Morag has
    // three stays waiting" rather than three separate lines, and so a host who
    // never onboards produces one line a day instead of one per stay for ever.
    const waiting = new Map<string, { stays: number; total: number }>();

    for (const booking of due || []) {
        try {
            const { data: host } = await admin
                .from('profiles')
                .select('id, stripe_account_id, stripe_payouts_enabled, payout_balance_owed')
                .eq('id', booking.host_id)
                .maybeSingle();

            // Nothing can be sent until the host has finished onboarding, so
            // the booking simply waits. It will be picked up next time.
            //
            // "Next time" was doing a lot of work in that sentence. A host who
            // never finishes onboarding is skipped every day for ever, in
            // silence, while their stays pile up — the site believes it is
            // working and the host is simply not paid. So it is recorded, and
            // reported once at the end of the run.
            if (!host || !host.stripe_account_id || host.stripe_payouts_enabled !== true) {
                const held = round2(
                    Number(booking.amount_paid || 0) - Number(booking.amount_refunded || 0)
                );
                const seen = waiting.get(booking.host_id) || { stays: 0, total: 0 };
                waiting.set(booking.host_id, {
                    stays: seen.stays + 1,
                    total: round2(seen.total + held),
                });

                skipped++;
                continue;
            }

            const { data: listing } = await admin
                .from('listings')
                .select('title, commission_rate')
                .eq('id', booking.listing_id)
                .maybeSingle();

            const rate =
                booking.commission_rate === null || booking.commission_rate === undefined
                    ? (listing && listing.commission_rate !== null && listing.commission_rate !== undefined
                        ? Number(listing.commission_rate)
                        : DEFAULT_COMMISSION_PERCENT)
                    : Number(booking.commission_rate);

            // Only what was actually collected and kept is shared out, never
            // the headline price.
            const collected = round2(
                Number(booking.amount_paid || 0) - Number(booking.amount_refunded || 0)
            );

            if (collected <= 0) {
                skipped++;
                continue;
            }

            const hostShare = netOfFee(collected, rate);
            const commission = feeAmount(collected, rate);

            // Anything the host already owes comes off this payout first.
            const owed = round2(Number(host.payout_balance_owed || 0));
            const deduction = Math.min(owed, hostShare);
            const toSend = round2(hostShare - deduction);

            if (toSend > 0) {
                // WHICH MONEY THIS IS PAID OUT OF.
                //
                // Without a source_transaction a transfer comes out of the
                // platform's AVAILABLE balance, and card money sits in PENDING
                // for about a week first. This runs the day after check-in, so
                // a guest who booked and paid days before arriving is paid out
                // of money that has not settled — the transfer fails
                // balance_insufficient, and the host is not paid when we said
                // they would be. It is the first real payout that is likeliest
                // to hit it, because the balance starts at nothing.
                //
                // Naming the charge removes the question: Stripe draws against
                // that payment whether it has settled or not.
                //
                // A stay paid as a deposit and then a balance has two charges,
                // and one transfer may name only one. The host's share is
                // usually bigger than either half, so those find nothing to
                // name and fall back to an untied transfer — which is safe,
                // because a balance is charged thirty days before check-in and
                // has long since settled. See lib/payoutSource.ts.
                const toSendPence = Math.round(toSend * 100);
                const source = await sourceChargeFor(booking, toSendPence);

                const transfer = await stripeRequest(
                    'POST',
                    '/transfers',
                    {
                        amount: toSendPence,
                        currency: 'gbp',
                        destination: host.stripe_account_id,
                        transfer_group: 'booking_' + booking.id,
                        // Omitted rather than sent as null when nothing covers
                        // it: encodeForm drops undefined, and Stripe rejects an
                        // empty string here.
                        source_transaction: source || undefined,
                        metadata: {
                            booking_id: booking.id,
                            host_id: booking.host_id,
                            commission_percent: String(rate),
                            drawn_from: source || 'platform balance',
                        },
                    },
                    // Built from the booking alone, so this stay can never pay
                    // out twice however the data is later edited.
                    'payout-' + booking.id
                );

                await admin.from('payouts').insert({
                    booking_id: booking.id,
                    host_id: booking.host_id,
                    amount: toSend,
                    kind: 'transfer',
                    status: 'succeeded',
                    stripe_transfer_id: transfer && transfer.id,
                    note: deduction > 0 ? 'After £' + deduction.toFixed(2) + ' owed was deducted' : null,
                });

                await admin
                    .from('bookings')
                    .update({
                        paid_out_at: new Date().toISOString(),
                        payout_amount: toSend,
                        payout_transfer_id: transfer && transfer.id,
                    })
                    .eq('id', booking.id);
            } else {
                // The whole payout went towards what was owed.
                await admin.from('payouts').insert({
                    booking_id: booking.id,
                    host_id: booking.host_id,
                    amount: 0,
                    kind: 'transfer',
                    status: 'withheld',
                    note: 'Held back against £' + deduction.toFixed(2) + ' owed',
                });

                await admin
                    .from('bookings')
                    .update({
                        paid_out_at: new Date().toISOString(),
                        payout_amount: 0,
                    })
                    .eq('id', booking.id);
            }

            if (deduction > 0) {
                // One statement, inside the database. `owed` was read before
                // the transfer above, so a debt arriving while we were waiting
                // on Stripe used to be wiped out by this write — the widest
                // window of the three places that move this number, because a
                // network round trip sits inside it. Subtracting what we
                // actually recovered, rather than writing a total worked out
                // from a stale read, closes it.
                const { data: newBalance, error: balanceError } = await admin.rpc(
                    'adjust_payout_balance',
                    { p_host: booking.host_id, p_delta: -deduction }
                );

                if (balanceError || newBalance === null) {
                    // The money has already moved. The debt is recovered and
                    // the record of it is not, which is the direction that
                    // over-charges a host next time round.
                    await logError(
                        'host-payouts: recovered £' + deduction.toFixed(2)
                            + ' but could not bring down what the host owes',
                        balanceError || 'no profile for that host',
                        { path: '/api/cron/host-payouts', userId: booking.host_id }
                    );
                } else if (round2(Number(newBalance)) < round2(owed - deduction)) {
                    // Lower than it should be, which only happens if something
                    // else took the same debt off at the same time. A larger
                    // figure is fine and expected — that is a new debt landing
                    // while the transfer was in flight, which is precisely what
                    // this change stopped losing.
                    await logError(
                        'host-payouts: the same debt looks to have been recovered twice',
                        {
                            expected: round2(owed - deduction),
                            actual: round2(Number(newBalance)),
                            deducted: deduction,
                            booking_id: booking.id,
                        },
                        { path: '/api/cron/host-payouts', userId: booking.host_id }
                    );
                }

                // Close off the individual debts this has just paid down.
                //
                // Until now only the running total moved and the rows behind
                // it were left saying 'owed' for ever, so anything itemising
                // what a host still owed kept listing debts already recovered.
                // The total and the rows have to agree — they are the same
                // money counted two ways, and the rows are the ones a host
                // would be shown if they queried a deduction.
                //
                // Oldest first, and partial recovery is recorded as partial:
                // a £45 debt against a £30 payout is £30 off this row, not a
                // row marked settled. The original amount is never rewritten;
                // it is the evidence of what was charged and why.
                //
                // Deliberately after the money has moved and after the balance
                // has come down. If this fails, the debt is recovered and the
                // bookkeeping is behind, which owner tools can see and put
                // right — the other order would show a settled debt that was
                // never actually taken.
                try {
                    const { data: debts } = await admin
                        .from('payouts')
                        .select('id, amount, settled_amount, status')
                        .eq('host_id', booking.host_id)
                        .eq('status', 'owed')
                        .order('created_at', { ascending: true });

                    const rows = debts || [];
                    const shares = spread(
                        deduction,
                        rows.map(function (r: any) { return outstandingOf(r); })
                    );

                    for (let i = 0; i < rows.length; i++) {
                        const share = shares[i];
                        if (share <= 0) continue;

                        const row = rows[i];
                        const recovered = round2(Number(row.settled_amount || 0) + share);
                        const fully = recovered >= round2(Math.abs(Number(row.amount || 0)));

                        await admin
                            .from('payouts')
                            .update({
                                settled_amount: recovered,
                                status: fully ? 'settled' : 'owed',
                                settled_at: fully ? new Date().toISOString() : null,
                            })
                            .eq('id', row.id);
                    }
                } catch (err) {
                    await logError(
                        'host-payouts: recovered £' + deduction.toFixed(2)
                            + ' on booking ' + booking.id
                            + ' but could not mark the debts settled',
                        err,
                        { path: '/api/cron/host-payouts' }
                    );
                }
            }

            const { data: hostUser } = await admin.auth.admin.getUserById(booking.host_id);
            const rawHostEmail = (hostUser && hostUser.user && hostUser.user.email) || '';

            // A seeded or scripted host must not be emailed. Every other alert
            // in this codebase decides that on the address rather than on an
            // environment variable — see lib/testAddresses.ts — and this one
            // did not, so a test run posted "You've been paid" to a reserved
            // .test domain and generated a bounce for every payout.
            const hostEmail = isAutomatedTestAddress(rawHostEmail) ? '' : rawHostEmail;

            // One read per host we are actually emailing. Returns null on any
            // failure, which falls back to the vaguer wording rather than
            // holding up a payout that has already gone.
            const hostSchedule = (hostEmail && toSend > 0)
                ? await readSchedule(host.stripe_account_id)
                : null;
            const payoutDelayDays = hostSchedule ? hostSchedule.delayDays : null;

            // NOTHING ARRIVED, AND THAT NEEDS SAYING MORE THAN A PAYMENT DOES.
            //
            // A host whose whole payout went against what they owed used to be
            // told nothing at all: no money and no explanation, on the one
            // occasion they are certain to ask. The email that says "we kept
            // it, here is why, here is what is left" is the difference between
            // a system that looks broken and one that looks strict.
            if (hostEmail && toSend <= 0 && deduction > 0) {
                const remaining = round2(owed - deduction);

                await sendEmail(
                    hostEmail,
                    'Your payout went towards what you owed',
                    emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;">Your stay at <strong>'
                            + escapeHtml((listing && listing.title) || 'your property')
                            + '</strong>, checked in ' + formatDate(booking.check_in)
                            + ', has been settled — but nothing has been sent to your bank this'
                            + ' time.</p>'
                        + '<p style="margin:0 0 16px;font-size:16px;">The guest paid \u00A3'
                            + collected.toFixed(2)
                            + (rate > 0 ? ', less \u00A3' + commission.toFixed(2) + ' service fee (' + rate + '%)' : ', with no service fee')
                            + ', leaving \u00A3' + hostShare.toFixed(2)
                            + '. All of it has gone against the \u00A3' + owed.toFixed(2)
                            + ' you owed.</p>'
                        + (remaining > 0
                            ? '<p style="margin:0 0 16px;font-size:16px;">That leaves <strong>\u00A3'
                                + remaining.toFixed(2) + '</strong> still owed, which will come out'
                                + ' of your next payouts in the same way until it is clear.</p>'
                            : '<p style="margin:0 0 16px;font-size:16px;"><strong>That clears what you'
                                + ' owed.</strong> Your next payout comes to you in full.</p>')
                        + button(SITE_URL + '/dashboard/earnings', 'See your earnings'),
                        'You are receiving this because you host on Galloway Getaways.'
                    )
                );
            }

            if (hostEmail && toSend > 0) {
                await sendEmail(
                    hostEmail,
                    'You\u2019ve been paid \u00A3' + toSend.toFixed(2),
                    emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;">Your payout for <strong>'
                            + escapeHtml((listing && listing.title) || 'your property')
                            + '</strong>, checked in '
                            + formatDate(booking.check_in)
                            + ', is on its way to your bank account.</p>'
                            + '<p style="margin:0 0 16px;font-size:16px;">Guest paid \u00A3'
                            + collected.toFixed(2)
                            + (rate > 0 ? ', less \u00A3' + commission.toFixed(2) + ' service fee (' + rate + '%)' : ', with no service fee')
                            + (deduction > 0 ? ', less \u00A3' + deduction.toFixed(2) + ' previously owed' : '')
                            + '. <strong>\u00A3' + toSend.toFixed(2) + '</strong> is yours.</p>'
                            // Read off this host's own account rather than
                            // printed. It said "a couple of working days",
                            // which was the day-after release described as the
                            // bank arrival; the accounts checked all said
                            // seven. This is the email a host reads while
                            // waiting, so it is the sentence that has to be
                            // true.
                            + '<p style="margin:0 0 16px;font-size:16px;">'
                            + arrivalSentence(payoutDelayDays)
                            + '</p>'
                            + button(SITE_URL + '/dashboard/earnings', 'View your earnings'),
                        'You\u2019re receiving this because you host on Galloway Getaways.'
                    )
                );
            }

            sent++;
        } catch (err: any) {
            console.error('[cron/host-payouts]', booking.id, err && err.message);

            // Money failing to reach a host is exactly what /admin/errors is
            // for. The console alone is nobody's alarm.
            await logError('host-payouts: transfer failed', err, {
                path: '/api/cron/host-payouts',
                userId: booking.host_id,
            });

            await admin.from('payouts').insert({
                booking_id: booking.id,
                host_id: booking.host_id,
                amount: 0,
                kind: 'transfer',
                status: 'failed',
                note: (err && err.message) || 'Transfer failed',
            });

            failed++;
        }
    }

    // HOSTS WHO CANNOT BE PAID, SAID OUT LOUD.
    //
    // Skipping was silent, and silence here looks exactly like a quiet day:
    // the run reports ok, nothing errors, and a host who never finished
    // onboarding simply never gets their money. Reported once per host per
    // run, after the loop, so a host with three stays waiting is one line and
    // not three.
    //
    // It repeats daily until they onboard, which is the point — it is a
    // standing debt to a real person, not a transient failure.
    // Array.from rather than iterating the Map directly — the test build
    // targets an older ES level and will not iterate one.
    for (const [hostId, held] of Array.from(waiting.entries())) {
        await logError(
            'host-payouts: ' + held.stays + ' stay' + (held.stays === 1 ? '' : 's')
                + ' worth \u00A3' + held.total.toFixed(2)
                + ' cannot be paid — the host has not finished setting up payouts',
            'no Stripe account, or payouts not yet enabled on it',
            { path: '/api/cron/host-payouts', userId: hostId }
        );
    }

    return NextResponse.json({
        ok: true,
        sent: sent,
        skipped: skipped,
        failed: failed,
        // Named separately from `skipped`, which also counts stays that
        // collected nothing and have no host to chase.
        hostsWaitingToOnboard: waiting.size,
    });
}
