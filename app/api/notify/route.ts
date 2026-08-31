import { formatTime } from '@/lib/utils';
import { round2 } from '@/lib/hostDebt';
// =====================================================================
// GALLOWAY GETAWAYS — notification sender
// WHERE THIS GOES: GitHub → app/api/notify/route.ts   (NEW FILE)
//
// The browser asks this route to send a notification. It never trusts
// what it's told: it works out the recipient itself from the booking,
// and refuses if the caller isn't part of that booking.
// =====================================================================

import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import {
    sendEmail,
    emailLayout,
    escapeHtml,
    formatDate,
    button,
    detailRows,
    SITE_URL,
} from '@/lib/email';

export const dynamic = 'force-dynamic';

// Reads auth.users and other people's rows, so it uses the service role
// key. This only ever runs on the server.
async function emailFor(admin: any, userId: string): Promise<string> {
    const { data } = await admin.auth.admin.getUserById(userId);
    return (data && data.user && data.user.email) || '';
}

async function firstNameFor(admin: any, userId: string, fallback: string): Promise<string> {
    const { data } = await admin
        .from('profiles')
        .select('full_name, preferred_name')
        .eq('id', userId)
        .maybeSingle();

    const name = (data && (data.preferred_name || data.full_name)) || '';
    const first = name.trim().split(' ')[0];
    return first || fallback;
}

// Optional emails only. Transactional ones ignore this entirely.
async function wants(admin: any, userId: string, column: string): Promise<boolean> {
    const { data } = await admin
        .from('notification_preferences')
        .select(column)
        .eq('user_id', userId)
        .maybeSingle();

    // No row yet means they've never opted out — default to sending.
    if (!data) return true;
    return (data as any)[column] !== false;
}

export async function POST(request: Request) {
    // Held outside the try so the catch can say WHICH notification failed.
    // Inside it they are out of scope down there, and "a notification was not
    // sent" without saying which one is barely better than silence.
    let notificationType: string | null = null;
    let notificationBookingId: string | null = null;

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
        const type: string = body && body.type;
        const bookingId: string = body && body.bookingId;
        notificationType = type || null;
        notificationBookingId = bookingId || null;

        if (!type || !bookingId) {
            return NextResponse.json({ ok: false, error: 'Missing type or bookingId' }, { status: 400 });
        }

        const admin = adminClient();
        const uid = user.id;

        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_in, check_out, guests, total_price, status, amount_paid, amount_refunded, balance_amount, balance_due_date, free_cancel_until')
            .eq('id', bookingId)
            .maybeSingle();

        if (!booking) {
            return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
        }

        // Hard gate: you must be one of the two people on this booking.
        if (booking.guest_id !== uid && booking.host_id !== uid) {
            return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
        }

        const { data: listing } = await admin
            .from('listings')
            .select('title, check_in_time, check_in_end_time, check_out_time')
            .eq('id', booking.listing_id)
            .maybeSingle();

        const listingTitle = escapeHtml((listing && listing.title) || 'your listing');

        // "Arrive from 3pm until 8pm. Leave by 11am." — empty when the host has
        // set nothing, so the email never states a time nobody chose.
        const arrivalLine = [
            formatTime(listing?.check_in_time)
                ? 'Arrive from ' + formatTime(listing?.check_in_time)
                    + (formatTime(listing?.check_in_end_time)
                        ? ' until ' + formatTime(listing?.check_in_end_time)
                        : '')
                : '',
            formatTime(listing?.check_out_time)
                ? 'Leave by ' + formatTime(listing?.check_out_time)
                : '',
        ].filter(Boolean).join('. ');
        const nights = escapeHtml(
            formatDate(booking.check_in) + ' to ' + formatDate(booking.check_out)
        );

        // -------------------------------------------------------------
        // A guest has just booked or requested. The HOST is told.
        // Transactional — always sends.
        // -------------------------------------------------------------
        if (type === 'booking_created') {
            if (booking.guest_id !== uid) {
                return NextResponse.json({ ok: false, error: 'Only the guest can trigger this' }, { status: 403 });
            }

            const to = await emailFor(admin, booking.host_id);
            const hostFirst = escapeHtml(await firstNameFor(admin, booking.host_id, 'there'));
            const guestFirst = escapeHtml(await firstNameFor(admin, booking.guest_id, 'A guest'));
            const instant = booking.status === 'confirmed';

            const heading = instant ? 'New booking' : 'New booking request';
            const intro = instant
                ? guestFirst + ' has booked ' + listingTitle + ' using Instant Book. The dates are already confirmed and blocked out on your calendar.'
                : guestFirst + ' would like to book ' + listingTitle + '. Have a look and confirm or decline — until you do, the dates are held but not confirmed.';

            const html = emailLayout(
                '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">' + heading + '</h1>' +
                '<p style="margin:0;">Hi ' + hostFirst + ' &mdash; ' + intro + '</p>' +
                detailRows([
                    { label: 'Property', value: listingTitle },
                    { label: 'Guest', value: guestFirst },
                    { label: 'Dates', value: nights },
                    { label: 'Guests', value: String(booking.guests || 1) },
                    { label: 'Total', value: '&pound;' + Number(booking.total_price || 0).toFixed(2) },
                ]) +
                button(SITE_URL + '/dashboard/bookings/' + booking.id, instant ? 'View the booking' : 'Review this request'),
                "You're receiving this because you host on Galloway Getaways. Booking emails can't be switched off."
            );

            await sendEmail(to, heading + ' \u2014 ' + ((listing && listing.title) || 'Galloway Getaways'), html);
            return NextResponse.json({ ok: true });
        }

        // -------------------------------------------------------------
        // A host has confirmed, declined or cancelled. The GUEST is told.
        // Transactional — always sends.
        // -------------------------------------------------------------
        if (type === 'booking_status') {
            if (booking.host_id !== uid) {
                return NextResponse.json({ ok: false, error: 'Only the host can trigger this' }, { status: 403 });
            }

            const to = await emailFor(admin, booking.guest_id);
            const guestFirst = escapeHtml(await firstNameFor(admin, booking.guest_id, 'there'));

            let heading = '';
            let intro = '';

            if (booking.status === 'confirmed') {
                heading = "You're booked";
                intro = 'Good news &mdash; your stay at ' + listingTitle + ' is confirmed. Your host will be in touch with the check-in details before you arrive.';
            } else if (booking.status === 'declined') {
                heading = 'Your booking request wasn&rsquo;t accepted';
                intro = 'Unfortunately the host can&rsquo;t take your booking at ' + listingTitle + ' for these dates. Nothing has been charged, and there are other places to stay across Dumfries &amp; Galloway.';
            } else if (booking.status === 'cancelled') {
                heading = 'Your booking has been cancelled';
                intro = 'Your booking at ' + listingTitle + ' has been cancelled by the host. If you have questions about this, reply to this email and we&rsquo;ll help.';
            } else {
                return NextResponse.json({ ok: true, skipped: 'no email for this status' });
            }

            // The three questions a guest asks in the ten minutes after
            // paying: when does the rest come out, how long can I change my
            // mind, and what do I get back if I do. All three were on the
            // confirmation page and in none of the email, which is the thing
            // they keep.
            //
            // Every figure is read off the booking as stored, not recalculated
            // here. free_cancel_until and balance_due_date were stamped by the
            // checkout route when the guest agreed to them, and this email is
            // quoting the agreement back — working them out again would let
            // the email and the booking drift apart.
            const paidSoFar = round2(
                Number(booking.amount_paid || 0) - Number(booking.amount_refunded || 0)
            );
            const balanceLeft = round2(Number(booking.balance_amount || 0));

            const moneyRows = booking.status === 'confirmed'
                ? [
                    ...(paidSoFar > 0
                        ? [{ label: 'Paid so far', value: '&pound;' + paidSoFar.toFixed(2) }]
                        : []),
                    ...(balanceLeft > 0
                        ? [{
                            label: 'Still to pay',
                            value: '&pound;' + balanceLeft.toFixed(2)
                                + (booking.balance_due_date
                                    ? ', taken from the same card on '
                                        + escapeHtml(formatDate(booking.balance_due_date))
                                    : ', due before you arrive')
                                + '. You can pay it sooner from your trips page.',
                        }]
                        : [{ label: 'Still to pay', value: 'Nothing &mdash; your stay is paid in full.' }]),
                    ...(booking.free_cancel_until
                        ? [{
                            label: 'Free cancellation',
                            value: 'Cancel by ' + escapeHtml(formatDate(booking.free_cancel_until))
                                + ' and you get back everything you have paid'
                                + (paidSoFar > 0 ? ' — &pound;' + paidSoFar.toFixed(2) + ' today' : '')
                                + '. After that a share is kept, depending on how close to your stay it is.',
                        }]
                        : [{
                            label: 'Cancelling',
                            value: 'These dates are outside the free-cancellation window, so a'
                                + ' cancellation now would not be refunded in full. Get in touch'
                                + ' if something changes and we will see what we can do.',
                        }]),
                ]
                : [];

            const html = emailLayout(
                '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">' + heading + '</h1>' +
                '<p style="margin:0;">Hi ' + guestFirst + ' &mdash; ' + intro + '</p>' +
                detailRows([
                    { label: 'Property', value: listingTitle },
                    { label: 'Dates', value: nights },
                    ...(arrivalLine ? [{ label: 'Times', value: escapeHtml(arrivalLine + '.') }] : []),
                    { label: 'Guests', value: String(booking.guests || 1) },
                    { label: 'Total', value: '&pound;' + Number(booking.total_price || 0).toFixed(2) },
                    ...moneyRows,
                ]) +
                button(SITE_URL + '/trips', 'View your trip'),
                "You're receiving this because you have a booking with Galloway Getaways. Booking emails can't be switched off."
            );

            await sendEmail(to, heading.split('&rsquo;').join("'") + ' \u2014 Galloway Getaways', html);
            return NextResponse.json({ ok: true });
        }

        // -------------------------------------------------------------
        // Somebody sent a message. The OTHER party is told.
        // Optional — respects the new_message toggle.
        // -------------------------------------------------------------
        if (type === 'new_message') {
            const recipientId = booking.guest_id === uid ? booking.host_id : booking.guest_id;

            const allowed = await wants(admin, recipientId, 'new_message');
            if (!allowed) {
                return NextResponse.json({ ok: true, skipped: 'opted out' });
            }

            const to = await emailFor(admin, recipientId);
            const recipientFirst = escapeHtml(await firstNameFor(admin, recipientId, 'there'));
            const senderFirst = escapeHtml(await firstNameFor(admin, uid, 'Someone'));

            const rawPreview = String((body && body.preview) || '').slice(0, 180);
            const preview = escapeHtml(rawPreview) + (rawPreview.length >= 180 ? '&hellip;' : '');

            const { data: prefs } = await admin
                .from('notification_preferences')
                .select('unsubscribe_token')
                .eq('user_id', recipientId)
                .maybeSingle();

            const html = emailLayout(
                '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">New message from ' + senderFirst + '</h1>' +
                '<p style="margin:0 0 4px 0;">Hi ' + recipientFirst + ' &mdash; you have a new message about ' + listingTitle + '.</p>' +
                '<div style="margin:20px 0;padding:16px 18px;background-color:#f9fafb;border-left:3px solid #047857;border-radius:6px;color:#374151;font-size:15px;">' +
                (preview || '<em>No message text</em>') +
                '</div>' +
                button(SITE_URL + '/messages/' + booking.id, 'Read and reply') +
                '<p style="margin:0;font-size:14px;color:#6b7280;">Reply on Galloway Getaways rather than by email, so the whole conversation stays in one place.</p>',
                "You're receiving this because message alerts are switched on in your notification settings.",
                prefs && prefs.unsubscribe_token
                    ? SITE_URL + '/unsubscribe?token=' + prefs.unsubscribe_token + '&type=new_message'
                    : undefined
            );

            await sendEmail(to, 'New message from ' + senderFirst + ' \u2014 Galloway Getaways', html);
            return NextResponse.json({ ok: true });
        }

        return NextResponse.json({ ok: false, error: 'Unknown notification type' }, { status: 400 });
    } catch (err: any) {
        // Never surface a failure to the browser — the booking or message
        // itself already succeeded, and telling a guest their booking failed
        // because an email did not send would be a lie about the money.
        //
        // BUT NOT SILENTLY, AND THE 200 IS WHY. Every notification on this
        // site funnels through this route, and it answers 200 with
        // { ok: false } whatever happens — so the caller cannot tell either.
        // Two layers of quiet: nothing thrown, nothing reported, and a status
        // code that says it went fine. A guest who is never told their card
        // failed, a host never told they have been paid, and a booking
        // confirmation that never arrives all look like this from here.
        console.error('[notify] failed:', err && err.message);

        await logError('[notify] a notification was not sent', {
            type: notificationType,
            booking_id: notificationBookingId,
            error: (err && err.message) || String(err),
            stack: err && err.stack,
        }, { path: 'api/notify' });

        return NextResponse.json({ ok: false }, { status: 200 });
    }
}
