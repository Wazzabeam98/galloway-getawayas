import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import { quoteBooking, totalsMatch, dateFromKey, dateKey } from '@/lib/pricing';
import { blockedNightsFromEvents } from '@/lib/availability';
import { rateFor } from '@/lib/fees';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

const DEPOSIT_FRACTION = 0.25;
const BALANCE_DAYS_BEFORE_CHECKIN = 30;

// How long a guest who has reached the Stripe page holds the dates for.
//
// A booking sitting at 'pending_payment' is deliberately not counted as taking
// the dates — a card declined at checkout, or a guest who wandered off, must
// not block a calendar for ever. But counting it for nothing meant two guests
// could both reach the payment page for the same nights and both pay, and the
// first anyone would know is two confirmed stays on one week.
//
// So it holds, briefly. Long enough to type a card in, short enough that an
// abandoned attempt frees the dates again within the half hour.
const HOLD_MINUTES = 30;

function pence(amount: number): number {
    return Math.round(amount * 100);
}

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession() — getSession() trusts an unsigned
        // cookie, so a forged one impersonates any user. getUser() verifies
        // the token against the auth server. Matches the admin/services routes.
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const bookingId: string = body && body.bookingId;
        const plan: string = (body && body.plan) === 'deposit' ? 'deposit' : 'full';

        if (!bookingId) {
            return NextResponse.json({ ok: false, error: 'Missing booking' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_in, check_out, total_price, status, payment_status, adults, children, pets, created_at')
            .eq('id', bookingId)
            .maybeSingle();

        if (!booking) {
            return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        }
        if (booking.guest_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        }
        if (booking.payment_status !== 'unpaid') {
            return NextResponse.json({ ok: false, error: 'This booking has already been paid' }, { status: 400 });
        }

        const { data: listing } = await admin
            .from('listings')
            .select('title, cancellation_policy, price_per_night, weekend_price, cleaning_fee, pet_fee, extra_guest_fee, extra_guest_after, extra_guest_period, max_guests, commission_rate, damage_deposit')
            .eq('id', booking.listing_id)
            .maybeSingle();

        if (!listing) {
            return NextResponse.json({ ok: false, error: 'Listing not found' }, { status: 404 });
        }

        const checkIn = dateFromKey(booking.check_in);
        const checkOut = dateFromKey(booking.check_out);

        // ------------------------------------------------------------------
        // Nothing the browser sent about money is trusted. The price is worked
        // out again here, from the listing and the dates, and the payment is
        // only ever for this figure.
        // ------------------------------------------------------------------
        const { data: overrideRows } = await admin
            .from('calendar_overrides')
            .select('date, is_blocked, price_override')
            .eq('listing_id', booking.listing_id);

        const overrides: Record<string, number> = {};
        const blockedDates: Record<string, boolean> = {};
        (overrideRows || []).forEach(function (row: any) {
            const key = String(row.date).split('T')[0];
            if (row.price_override) overrides[key] = Number(row.price_override);
            if (row.is_blocked) blockedDates[key] = true;
        });

        const quote = quoteBooking(
            listing,
            overrides,
            checkIn,
            checkOut,
            Number(booking.adults || 0),
            Number(booking.children || 0),
            Number(booking.pets || 0)
        );

        if (quote.nights <= 0) {
            return NextResponse.json(
                { ok: false, error: 'Those dates don\u2019t make a valid stay.' },
                { status: 400 }
            );
        }

        const guestCount = Number(booking.adults || 0) + Number(booking.children || 0);
        if (listing.max_guests && guestCount > Number(listing.max_guests)) {
            return NextResponse.json(
                { ok: false, error: 'That is more guests than this place allows.' },
                { status: 400 }
            );
        }

        // The price shown in the browser is what the guest agreed to. If it no
        // longer matches, the booking stops rather than quietly charging a
        // different amount.
        if (!totalsMatch(quote.total, Number(booking.total_price))) {
            await admin
                .from('bookings')
                .update({ total_price: quote.total })
                .eq('id', booking.id);

            return NextResponse.json(
                {
                    ok: false,
                    error: 'The price for these dates has changed to \u00A3'
                        + quote.total.toFixed(2)
                        + '. Please refresh the page and book again.',
                },
                { status: 409 }
            );
        }

        // ------------------------------------------------------------------
        // Availability, settled here rather than in the browser — two guests
        // can be looking at the same free dates at the same time.
        // ------------------------------------------------------------------

        // Dates taken on Airbnb, Booking.com and the like. The calendar a
        // guest saw may be up to a few hours old, since those platforms only
        // publish a file for us to read rather than telling us anything. This
        // is the last chance to catch a stay that was sold elsewhere while
        // this guest was deciding.
        const { data: icalFeeds } = await admin
            .from('listing_ical_feeds')
            .select('id, label, events')
            .eq('listing_id', booking.listing_id);

        // Expanded by lib/availability, which is also what search filters
        // with — so a stay search calls free and a stay checkout calls taken
        // cannot come apart.
        (icalFeeds || []).forEach(function (feed: any) {
            blockedNightsFromEvents(feed.events).forEach(function (night: string) {
                blockedDates[night] = true;
            });
        });

        const cursor = new Date(checkIn.getTime());
        for (let i = 0; i < quote.nights; i++) {
            if (blockedDates[dateKey(cursor)]) {
                // Logged because a feed that blocks dates it shouldn't turns
                // guests away silently, and nobody would otherwise notice.
                console.log('[checkout] blocked date', booking.listing_id, dateKey(cursor));

                return NextResponse.json(
                    {
                        ok: false,
                        error: 'Sorry — those dates have just been taken. Please pick different ones.',
                    },
                    { status: 409 }
                );
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        const { data: clashes } = await admin
            .from('bookings')
            .select('id')
            .eq('listing_id', booking.listing_id)
            .neq('id', booking.id)
            .in('status', ['pending', 'confirmed'])
            .lt('check_in', booking.check_out)
            .gt('check_out', booking.check_in);

        if (clashes && clashes.length > 0) {
            return NextResponse.json(
                { ok: false, error: 'Sorry \u2014 those dates have just been booked by someone else.' },
                { status: 409 }
            );
        }

        // Somebody else is at the payment page for these nights right now.
        //
        // Only an *earlier* attempt holds. Both guests arrive here within
        // milliseconds of each other, so a rule that simply says 'someone else
        // is here' turns both away and neither gets the dates. Whoever started
        // first keeps them, which is decidable the same way by both requests
        // however they interleave.
        const holdSince = new Date(Date.now() - HOLD_MINUTES * 60 * 1000).toISOString();

        const { data: held } = await admin
            .from('bookings')
            .select('id')
            .eq('listing_id', booking.listing_id)
            .neq('id', booking.id)
            .eq('status', 'pending_payment')
            .gt('created_at', holdSince)
            .lt('created_at', booking.created_at)
            .lt('check_in', booking.check_out)
            .gt('check_out', booking.check_in);

        if (held && held.length > 0) {
            return NextResponse.json(
                {
                    ok: false,
                    error: 'Someone else is paying for those dates right now. '
                        + 'Give it a few minutes and try again \u2014 if they don\u2019t go through, '
                        + 'the dates come back.',
                },
                { status: 409 }
            );
        }

        const total = quote.total;

        // A deposit only makes sense while there's time to collect the
        // balance. Inside the balance window it's the full amount.
        const balanceDue = new Date(booking.check_in);
        balanceDue.setDate(balanceDue.getDate() - BALANCE_DAYS_BEFORE_CHECKIN);
        const depositAllowed = balanceDue.getTime() > Date.now();

        const useDeposit = plan === 'deposit' && depositAllowed;
        const dueNow = useDeposit ? Math.round(total * DEPOSIT_FRACTION * 100) / 100 : total;
        const balance = Math.round((total - dueNow) * 100) / 100;

        // A deposit is only workable if the balance can be taken automatically
        // 30 days before check-in, and only a card can be charged that way.
        // Klarna and the wallets are one-off agreements for the amount shown,
        // so they are offered on the pay-in-full path only.
        // A damage deposit means the card has to be kept on file, and only a
        // card can be. Klarna and the wallets can't be charged later.
        const keepCard = useDeposit || Number(listing.damage_deposit || 0) > 0;

        const methods = keepCard
            ? ['card']
            : ['card', 'klarna', 'link'];

        const checkout = await stripeRequest('POST', '/checkout/sessions', {
            mode: 'payment',
            customer_email: user.email,
            client_reference_id: booking.id,
            payment_method_types: methods,
            // GBP only, at the price on the listing.
            //
            // Stripe's Adaptive Pricing is on by default and converts the
            // price into whatever currency it decides the guest's country
            // wants — which is why a Scottish cottage priced in pounds was
            // offering euros at checkout. Off here as well as in the
            // Dashboard: the toggle is per account and per mode and can be
            // turned back on by anyone with a login, whereas this travels
            // with the code.
            //
            // Nothing about the money was ever at risk from it. The session
            // and the payment intent always reported this currency and this
            // amount, so commission, payouts and refunds were unaffected —
            // it was only what the guest was shown, plus the 2-4% conversion
            // fee they would have paid for the privilege.
            adaptive_pricing: { enabled: false },
            // Forced on the deposit path so there is always a customer to
            // charge the balance against later.
            customer_creation: keepCard ? 'always' : 'if_required',
            // Lands on a page that confirms the payment from the booking id
            // alone, so a session lost on the way back from Stripe never leaves
            // a guest staring at a login screen.
            success_url: SITE_URL + '/booking-confirmed/' + booking.id,
            cancel_url: SITE_URL + '/homes/' + booking.listing_id + '?cancelled=1',
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: 'gbp',
                        unit_amount: pence(dueNow),
                        product_data: {
                            name: (listing && listing.title) || 'Your stay',
                            description: useDeposit
                                ? 'Part payment now \u2014 the rest is charged 30 days before check-in'
                                : 'Full payment for your stay',
                        },
                    },
                },
            ],
            payment_intent_data: {
                // Saving the card is what lets the balance be taken later
                // without the guest having to do anything. Nothing further is
                // ever charged on a paid-in-full booking, so it is not saved
                // there.
                setup_future_usage: keepCard ? 'off_session' : undefined,
                description: 'Galloway Getaways booking ' + booking.id,
                metadata: {
                    booking_id: booking.id,
                    kind: useDeposit ? 'deposit' : 'full',
                },
            },
            metadata: {
                booking_id: booking.id,
                kind: useDeposit ? 'deposit' : 'full',
            },
        });

        await admin
            .from('bookings')
            .update({
                payment_plan: useDeposit ? 'deposit' : 'full',
                deposit_amount: useDeposit ? dueNow : null,
                // Zero, not null, on the pay-in-full path. Nothing is
                // outstanding, and the column that says what is outstanding
                // has to be able to say so — a null reads as 'unknown' and
                // turns into NaN the moment anything does arithmetic on it.
                balance_amount: useDeposit ? balance : 0,
                balance_due_date: useDeposit ? balanceDue.toISOString().split('T')[0] : null,
                // free_cancel_until is no longer stored: every surface computes
                // the deadline live from check_in and the stamped policy, so
                // there is one answer and it cannot drift a day early (the old
                // toISOString store did, under BST) or fall out of step with the
                // cards. The column stays, unwritten, so no migration is needed.
                // Stamped on now and never changed. If the listing's rate is
                // altered later, this booking's history stays true to what
                // was actually agreed at the time.
                commission_rate: rateFor(listing),
                // Same reasoning, same moment. A cancellation gives the
                // cleaning fee back in full, so a refund has to know what was
                // charged for it — not what the host has set since. Taken from
                // the server-side quote and never from the browser: the
                // booking row is created client-side, so a value arriving with
                // it would be the guest's claim rather than ours.
                cleaning_fee: quote.cleaningFeeTotal,
                status: 'pending_payment',
            })
            .eq('id', booking.id);

        return NextResponse.json({ ok: true, url: checkout.url });
    } catch (err: any) {
        console.error('[stripe/checkout]', err && err.message);
        await logError('[stripe/checkout] ' + ((err && err.message) || 'failed'), err, { path: 'stripe/checkout' });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not start checkout' },
            { status: 500 }
        );
    }
}
