import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { billingTokenFor, hashBillingToken } from '@/lib/serviceBillingToken';
import { sendReminder, billingLink } from '@/lib/serviceSubscriptionAlert';
import { remindersDue, graceExpired } from '@/lib/serviceSubscription';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The ladder, and the day the listing comes down.
//
// WHY THIS IS THE ROUTE THE SUBSCRIPTION ACTUALLY DEPENDS ON
//
// Nobody has a card on file until the end of their ninety days, because we ask
// for one near the end on purpose. That means there is no charge to retry and
// no dunning to lean on for the whole trial: if these emails do not go out,
// nobody ever pays, and the failure is completely silent — the listings stay
// up, the tradesmen stay happy, and no money arrives.
//
// WHY DAILY AND NOT EVERY FIVE MINUTES
//
// The enquiry sweep runs every five minutes because an emergency expires in
// twenty. Nothing here is remotely that sharp: the shortest interval that
// matters is a day, and a reminder that goes out at nine in the morning rather
// than nine at night is the same reminder.
//
// CATCHING UP RATHER THAN SKIPPING
//
// remindersDue returns EVERY reminder whose day has passed and which has not
// been sent, not just today's. A bad deploy or an outage that eats a day must
// not mean a tradesman never gets told his card is due — he gets the missed
// one late, which is the right failure. Recording each send by key is what
// makes catching up safe.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const now = new Date();

    // Everybody with a clock running. The partial index from 20260827135718
    // covers exactly this. A provider with no trial_ends_at has not had a first
    // enquiry yet and is owed nothing.
    const { data: providers, error } = await admin
        .from('service_providers')
        .select('id, business_name, contact_email, trade, plan, status, trial_ends_at, stripe_subscription_id, subscription_status, reminders_sent, billing_token_hash')
        .eq('plan', 'subscription')
        .eq('status', 'approved')
        .not('trial_ends_at', 'is', null)
        .limit(500);

    if (error) {
        await logError('service-subscription-read', { error: String(error.message) });
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    let sent = 0;
    let hidden = 0;

    for (const provider of providers || []) {
        try {
            const due = remindersDue(provider, now);

            if (due.length) {
                const token = billingTokenFor(String(provider.id));

                // The hash is stored the first time a link is needed, because
                // the billing page looks the provider up by it. The token
                // itself is derived rather than minted, so this is idempotent
                // and a second write changes nothing.
                if (token) {
                    const hash = hashBillingToken(token);
                    if (provider.billing_token_hash !== hash) {
                        await admin
                            .from('service_providers')
                            .update({ billing_token_hash: hash, updated_at: now.toISOString() })
                            .eq('id', provider.id);
                    }
                }

                for (const reminder of due) {
                    const ok = await sendReminder(reminder, provider, billingLink(token));

                    if (!ok) {
                        // The ask is the one that costs money when it goes
                        // missing, so it is reported rather than counted as
                        // done. Not recording it means the next run tries
                        // again, which is what we want from a transient
                        // failure and harmless from a permanent one.
                        if (reminder.asks) {
                            await logError('service-subscription-email', {
                                provider: String(provider.id),
                                reminder: reminder.key,
                                error: 'the card reminder did not send',
                            });
                        }
                        continue;
                    }

                    // Recorded only on a successful send, and guarded in the
                    // statement as well: `not cs` refuses the write if the key
                    // is already in the array, so two runs overlapping cannot
                    // append it twice.
                    const already: string[] = Array.isArray(provider.reminders_sent)
                        ? provider.reminders_sent
                        : [];

                    const { error: markError } = await admin
                        .from('service_providers')
                        .update({
                            reminders_sent: already.concat([reminder.key]),
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', provider.id)
                        .not('reminders_sent', 'cs', '{' + reminder.key + '}');

                    if (markError) {
                        // He has had the email. Failing to record that is how
                        // he gets it again tomorrow, which is worth knowing
                        // about but not worth stopping for.
                        await logError('service-subscription-mark', {
                            provider: String(provider.id),
                            reminder: reminder.key,
                            error: String(markError.message),
                        });
                    }

                    already.push(reminder.key);
                    sent++;
                }
            }

            // THE LISTING COMES DOWN.
            //
            // Seven days after the free period ended, for somebody who never
            // gave us a card. Its own column, never `status` — see the
            // migration for the collision that would cause in the admin
            // approve route.
            //
            // Re-read rather than trusting the row from the top of the loop: a
            // tradesman may have paid in the seconds since, and hiding
            // somebody who has just handed over a card is the worst version of
            // this.
            const { data: fresh } = await admin
                .from('service_providers')
                .select('id, plan, status, trial_ends_at, stripe_subscription_id, subscription_status')
                .eq('id', provider.id)
                .maybeSingle();

            if (fresh && graceExpired(fresh, now)) {
                const { error: hideError } = await admin
                    .from('service_providers')
                    .update({ subscription_status: 'unpaid', updated_at: new Date().toISOString() })
                    .eq('id', provider.id)
                    // Guarded on there still being no subscription. If the
                    // webhook wrote one between the read and this write, the
                    // update matches nothing and he stays listed.
                    .is('stripe_subscription_id', null);

                if (hideError) {
                    await logError('service-subscription-hide', {
                        provider: String(provider.id),
                        error: String(hideError.message),
                    });
                } else {
                    hidden++;
                }
            }
        } catch (err: any) {
            // One provider's failure must not stop the ladder for everybody
            // behind them in the list.
            await logError('service-subscription', {
                provider: String(provider.id),
                error: String(err && err.message),
            });
        }
    }

    return NextResponse.json({ ok: true, considered: (providers || []).length, sent, hidden });
}
