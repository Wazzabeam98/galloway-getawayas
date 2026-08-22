import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { logError } from '@/lib/logError';
import { readSchedule, payoutTimingText } from '@/lib/payoutTiming';

export const dynamic = 'force-dynamic';

const INTERVALS = ['daily', 'weekly', 'monthly'];
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// The host's own connected account, or null. Everything here is scoped to the
// signed-in user's own row — a payout destination is not something one host
// may look at, never mind change, on behalf of another.
async function accountFor(uid: string): Promise<string | null> {
    const { data } = await adminClient()
        .from('profiles')
        .select('stripe_account_id')
        .eq('id', uid)
        .maybeSingle();

    return (data && data.stripe_account_id) || null;
}

// Where the money goes, for display only.
//
// Reading external accounts is permitted for a connected account without the
// full Stripe Dashboard, and returns the last four digits and the sort code —
// never the account number. Changing them is deliberately not done here: see
// the note on the POST below.
async function bankFor(accountId: string) {
    try {
        const list = await stripeRequest(
            'GET',
            '/accounts/' + accountId + '/external_accounts?object=bank_account&limit=1'
        );
        const bank = list && list.data && list.data[0];
        if (!bank) return null;

        return {
            bank_name: bank.bank_name || null,
            last4: bank.last4 || null,
            sort_code: bank.routing_number || null,
            currency: (bank.currency || '').toUpperCase(),
        };
    } catch (err) {
        return null;
    }
}

export async function GET() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const accountId = await accountFor(session.user.id);
        if (!accountId) {
            return NextResponse.json({ ok: true, connected: false });
        }

        const schedule = await readSchedule(accountId);
        const bank = await bankFor(accountId);

        return NextResponse.json({
            ok: true,
            connected: true,
            schedule: schedule,
            bank: bank,
            // Built from the account's own delay_days rather than a number
            // written down once — Stripe shortens it as an account builds
            // history, and a host should be told what is true today.
            timing: payoutTimingText(schedule ? schedule.delayDays : null),
        });
    } catch (err: any) {
        await logError('[payout-schedule GET] ' + ((err && err.message) || 'failed'), err, {
            path: 'stripe/payout-schedule',
        });
        return NextResponse.json({ ok: false, error: 'Could not read your payout settings' }, { status: 500 });
    }
}

// Change how often Stripe pays a host's balance into their bank.
//
// This changes the second hop only. It does not touch when Galloway releases
// money, and it cannot reach a payout Stripe has already created — those carry
// their own destination and timing from the moment they are made.
//
// What it deliberately does NOT do:
//
//   delay_days is never sent. That is the settlement wait Stripe sets per
//   account, the one thing here that changes when money actually lands, and
//   it is not ours to shorten on a host's behalf.
//
//   Bank details are not changed. The API permits it in test mode despite the
//   documentation saying otherwise for accounts with the Express Dashboard,
//   but repointing where a host's money goes from a form on our own site
//   removes the identity check Stripe puts in front of exactly that change.
//   The host does it in the Express Dashboard, via the link on the settings
//   page, and Stripe verifies it is really them.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json().catch(function () { return {}; });
        const interval: string = (body && body.interval) || '';

        if (INTERVALS.indexOf(interval) === -1) {
            return NextResponse.json(
                { ok: false, error: 'Choose daily, weekly or monthly.' },
                { status: 400 }
            );
        }

        const accountId = await accountFor(session.user.id);
        if (!accountId) {
            return NextResponse.json(
                { ok: false, error: 'You have not set up payouts yet.' },
                { status: 400 }
            );
        }

        // Only the anchor belonging to the chosen interval goes up. Stripe
        // rejects a weekly_anchor on a monthly schedule outright, so sending
        // both would fail every time somebody switched.
        const schedule: Record<string, any> = { interval: interval };

        if (interval === 'weekly') {
            const day = String((body && body.weekly_anchor) || 'friday').toLowerCase();
            if (WEEKDAYS.indexOf(day) === -1) {
                return NextResponse.json({ ok: false, error: 'Pick a day of the week.' }, { status: 400 });
            }
            schedule.weekly_anchor = day;
        }

        if (interval === 'monthly') {
            const dayOfMonth = parseInt(String((body && body.monthly_anchor) || '1'), 10);
            // 29th to 31st do not exist in every month, and Stripe refuses
            // them rather than guessing. 28 is the last date that is always
            // there.
            if (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
                return NextResponse.json(
                    { ok: false, error: 'Pick a date from 1 to 28 — later dates do not exist in every month.' },
                    { status: 400 }
                );
            }
            schedule.monthly_anchor = dayOfMonth;
        }

        await stripeRequest('POST', '/accounts/' + accountId, {
            settings: { payouts: { schedule: schedule } },
        });

        // Read it back rather than echoing what we asked for. Stripe normalises
        // some of this — a weekly schedule comes back with weekly_payout_days
        // alongside the anchor — and the host should be shown what is actually
        // stored, not our request.
        const saved = await readSchedule(accountId);

        return NextResponse.json({
            ok: true,
            schedule: saved,
            timing: payoutTimingText(saved ? saved.delayDays : null),
        });
    } catch (err: any) {
        await logError('[payout-schedule POST] ' + ((err && err.message) || 'failed'), err, {
            path: 'stripe/payout-schedule',
        });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not change your payout schedule' },
            { status: 500 }
        );
    }
}
