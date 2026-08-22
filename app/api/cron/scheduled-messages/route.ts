import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { displayName } from '@/lib/utils';
import {
    timingFor,
    isDue,
    hasRealContent,
    appliesToListing,
    fillPlaceholders,
} from '@/lib/scheduledMessages';
import type { Template, BookingLike } from '@/lib/scheduledMessages';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Sends the messages hosts have already written.
//
// The templates have existed for a long time and nothing has ever sent them.
// A host writes their check-in details — the key safe code, where to park —
// sees "Saved", and the guest never receives it. Only the booking-confirmation
// template with no delay goes out, posted inline when a host accepts.
//
// Hourly, because a host can choose the hour their message goes out.
//
// The one thing this must never do is send twice. `sent_scheduled_messages`
// has a unique constraint on (booking_id, template_type), so the row is
// claimed *before* the message is written: if the insert is refused, another
// run already has it. Same reasoning as the payment idempotency keys — the
// record that it was sent and the thing preventing a second send are one
// object, so they cannot disagree.

function formatDate(value: string): string {
    const parts = String(value).split('T')[0].split('-');
    const d = new Date(
        parseInt(parts[0], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[2], 10)
    );
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const now = new Date();

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    try {
        const { data: templates, error: templateError } = await admin
            .from('message_templates')
            .select('user_id, template_type, body, enabled, anchor, days_offset, send_hour, minutes_after, hours_after, hours_before, listing_ids')
            .eq('enabled', true);

        // A failed read here would leave `templates` empty and the run would
        // report a cheerful ok:true having sent nothing — indistinguishable
        // from a quiet hour. The same trap the payout run had.
        if (templateError) {
            await logError('scheduled-messages: could not load the templates', templateError, {
                path: '/api/cron/scheduled-messages',
            });
            return NextResponse.json(
                { ok: false, error: 'Could not load the templates' },
                { status: 500 }
            );
        }

        const live = (templates || []).filter((t: Template) => hasRealContent(t.body));
        if (live.length === 0) {
            return NextResponse.json({ ok: true, sent: 0, skipped: 0, failed: 0 });
        }

        // Stays that are actually happening. A window either side keeps the
        // query small without cutting off a template anchored a fortnight out
        // or one that trails a check-out.
        const from = new Date(now.getTime() - 40 * 86400000).toISOString().split('T')[0];
        const to = new Date(now.getTime() + 40 * 86400000).toISOString().split('T')[0];

        const hostIds = Array.from(new Set(live.map((t: Template) => t.user_id)));
        const COLUMNS = 'id, host_id, guest_id, listing_id, check_in, check_out, status, confirmed_at';

        const { data: byStayDates, error: bookingError } = await admin
            .from('bookings')
            .select(COLUMNS)
            .in('host_id', hostIds)
            .eq('status', 'confirmed')
            .gte('check_out', from)
            .lte('check_in', to);

        if (bookingError) {
            await logError('scheduled-messages: could not load the bookings', bookingError, {
                path: '/api/cron/scheduled-messages',
            });
            return NextResponse.json(
                { ok: false, error: 'Could not load the bookings' },
                { status: 500 }
            );
        }

        // A booking-anchored template counts from when the host accepted, not
        // from the dates of the stay — so the window above is the wrong
        // question for it entirely. Somebody accepting a booking today for a
        // stay in six months would never have got their welcome message: the
        // stay is outside the window, so the booking was never looked at.
        //
        // Only asked when such a template is actually live, and bounded by how
        // recently the booking was accepted rather than by its dates, so it
        // stays a small query.
        const hasBookingAnchored = live.some((t: Template) => t.anchor === 'booking');

        let byConfirmedAt: any[] = [];
        if (hasBookingAnchored) {
            const acceptedSince = new Date(now.getTime() - 7 * 86400000).toISOString();

            const { data: recent, error: recentError } = await admin
                .from('bookings')
                .select(COLUMNS)
                .in('host_id', hostIds)
                .eq('status', 'confirmed')
                .gte('confirmed_at', acceptedSince);

            if (recentError) {
                await logError(
                    'scheduled-messages: could not load recently accepted bookings',
                    recentError,
                    { path: '/api/cron/scheduled-messages' }
                );
                return NextResponse.json(
                    { ok: false, error: 'Could not load the bookings' },
                    { status: 500 }
                );
            }

            byConfirmedAt = recent || [];
        }

        // The two queries overlap for anything both recent and soon, so the
        // same booking must not be considered twice — it would claim, send,
        // and then find its own claim already there.
        const seen: Record<string, boolean> = {};
        const bookings: any[] = [];
        (byStayDates || []).concat(byConfirmedAt).forEach(function (b: any) {
            if (seen[b.id]) return;
            seen[b.id] = true;
            bookings.push(b);
        });

        if (bookings.length === 0) {
            return NextResponse.json({ ok: true, sent: 0, skipped: 0, failed: 0 });
        }

        const listingIds = Array.from(new Set(bookings.map((b: BookingLike) => b.listing_id)));
        const guestIds = Array.from(new Set(bookings.map((b: BookingLike) => b.guest_id)));

        const { data: listings } = await admin
            .from('listings')
            .select('id, title, check_in_time, check_out_time')
            .in('id', listingIds);

        const { data: guests } = await admin
            .from('profiles')
            .select('id, full_name, preferred_name, show_full_name')
            .in('id', guestIds);

        const listingById: Record<string, any> = {};
        (listings || []).forEach((l: any) => { listingById[l.id] = l; });

        const guestById: Record<string, any> = {};
        (guests || []).forEach((g: any) => { guestById[g.id] = g; });

        for (const template of live as Template[]) {
            for (const booking of bookings as BookingLike[]) {
                if (booking.host_id !== template.user_id) continue;
                if (!appliesToListing(template, booking.listing_id)) continue;

                const listing = listingById[booking.listing_id];
                if (!listing) continue;

                if (!isDue(timingFor(template, booking, listing), now)) {
                    continue;
                }

                // Claim it. The unique constraint on (booking_id,
                // template_type) is what makes this safe: two runs racing, or
                // one run retried, and only one insert survives.
                const { error: claimError } = await admin
                    .from('sent_scheduled_messages')
                    .insert({
                        booking_id: booking.id,
                        template_type: template.template_type,
                    });

                if (claimError) {
                    // 23505 is the unique violation — already sent, which is
                    // the system working, not a fault.
                    if (String((claimError as any).code) !== '23505') {
                        await logError(
                            'scheduled-messages: could not claim ' + template.template_type
                                + ' for booking ' + booking.id,
                            claimError,
                            { path: '/api/cron/scheduled-messages' }
                        );
                        failed++;
                    } else {
                        skipped++;
                    }
                    continue;
                }

                const guest = guestById[booking.guest_id];
                const fullName = displayName(guest, 'there');
                const firstName = fullName.split(' ')[0] || 'there';

                const body = fillPlaceholders(template.body, {
                    guestName: firstName,
                    listing: listing.title || 'your stay',
                    checkIn: formatDate(booking.check_in),
                    checkOut: formatDate(booking.check_out),
                });

                const { error: messageError } = await admin.from('messages').insert({
                    booking_id: booking.id,
                    sender_id: booking.host_id,
                    recipient_id: booking.guest_id,
                    body: body,
                });

                if (messageError) {
                    // The claim is already down, so leaving it would mean this
                    // message never sends. Release it so the next run tries
                    // again — a duplicate is possible only if the message
                    // actually did land, which this error says it did not.
                    await admin
                        .from('sent_scheduled_messages')
                        .delete()
                        .eq('booking_id', booking.id)
                        .eq('template_type', template.template_type);

                    await logError(
                        'scheduled-messages: claimed but could not send '
                            + template.template_type + ' for booking ' + booking.id,
                        messageError,
                        { path: '/api/cron/scheduled-messages' }
                    );
                    failed++;
                    continue;
                }

                sent++;
            }
        }

        return NextResponse.json({ ok: true, sent: sent, skipped: skipped, failed: failed });
    } catch (err: any) {
        await logError(
            'scheduled-messages: ' + ((err && err.message) || 'failed'),
            err,
            { path: '/api/cron/scheduled-messages' }
        );
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not send scheduled messages' },
            { status: 500 }
        );
    }
}
