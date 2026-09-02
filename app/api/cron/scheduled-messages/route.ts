import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { displayName } from '@/lib/utils';
import {
    timingFor,
    isDue,
    hasRealContent,
    fillPlaceholders,
    needsLockboxCode,
    usesLockboxCode,
    checkInFallbackBody,
} from '@/lib/scheduledMessages';
import type { BookingLike } from '@/lib/scheduledMessages';
import { resolveTemplate } from '@/lib/messageTemplates';
import type { ScopedTemplate } from '@/lib/messageTemplates';

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

// THE FLOOR: the guest gets the address and arrival time whether or not the
// host ever wrote a check-in template.
//
// The template loop is driven by templates, so a host who wrote nothing is
// invisible to it — their booking is never loaded — and the guest arrives with
// no address and no idea how to get in. That is the "family outside a locked
// door on a Friday night" this exists to stop. So this runs INDEPENDENTLY, and
// is called at every exit of the run (including the two early ones for "no
// templates" and "no bookings" — which is exactly the case it must cover).
//
// It sweeps confirmed stays arriving in the next three days and, for any whose
// host has no usable check-in template covering that listing (or whose template
// is held back for a door code that is not set), sends the practical minimum as
// a message in the guest's own thread. Idempotent under its own template_type,
// so it sends once and never lands on top of a host's own message. Bounded to a
// three-day horizon, so it stays a small query.
async function checkInFallbackPass(
    admin: any,
    now: Date,
    live: ScopedTemplate[]
): Promise<{ sent: number; skipped: number; failed: number }> {
    const counts = { sent: 0, skipped: 0, failed: 0 };
    try {
        const dayKey = (d: Date) => d.toISOString().split('T')[0];
        const todayKey = dayKey(now);
        const horizonKey = dayKey(new Date(now.getTime() + 3 * 86400000));

        const { data: arriving } = await admin
            .from('bookings')
            .select('id, host_id, guest_id, listing_id, check_in, check_out, status')
            .eq('status', 'confirmed')
            .gte('check_in', todayKey)
            .lte('check_in', horizonKey);

        const fb = arriving || [];
        if (fb.length === 0) return counts;

        const fbListingIds = Array.from(new Set(fb.map((b: any) => b.listing_id)));
        const fbGuestIds = Array.from(new Set(fb.map((b: any) => b.guest_id)));

        const { data: fbListings } = await admin
            .from('listings')
            .select('id, title, location, check_in_time, check_out_time, check_in_method')
            .in('id', fbListingIds);
        const fbListingById: Record<string, any> = {};
        (fbListings || []).forEach((l: any) => { fbListingById[l.id] = l; });

        const { data: fbGuests } = await admin
            .from('profiles')
            .select('id, full_name, preferred_name, show_full_name')
            .in('id', fbGuestIds);
        const fbGuestById: Record<string, any> = {};
        (fbGuests || []).forEach((g: any) => { fbGuestById[g.id] = g; });

        // Door codes, service-role only, same as the main loop. A self-check-in
        // fallback carries the code when the host set one.
        const { data: fbCodes } = await admin
            .from('listing_access_codes')
            .select('listing_id, code')
            .in('listing_id', fbListingIds);
        const fbCodeByListing: Record<string, string> = {};
        (fbCodes || []).forEach((c: any) => { fbCodeByListing[c.listing_id] = c.code; });

        for (const booking of fb) {
            const listing = fbListingById[booking.listing_id];
            if (!listing) continue;

            // Does the host already cover this listing with a real check-in
            // template that can actually send? If so, leave it to the loop
            // above. A template that needs a door code the listing does not
            // have is NOT covered — it is held back, and the guest would
            // otherwise get nothing.
            const mine = live.filter((t) => t.user_id === booking.host_id);
            const code = fbCodeByListing[booking.listing_id] || null;
            const tmpl = resolveTemplate(mine, 'checkin_details', booking.listing_id);
            const covered = !!tmpl && !needsLockboxCode(tmpl.body, code);
            if (covered) continue;

            const { error: claimError } = await admin
                .from('sent_scheduled_messages')
                .insert({ booking_id: booking.id, template_type: 'checkin_fallback' });

            if (claimError) {
                if (String((claimError as any).code) !== '23505') {
                    await logError(
                        'scheduled-messages: could not claim checkin_fallback for booking ' + booking.id,
                        claimError,
                        { path: '/api/cron/scheduled-messages' }
                    );
                    counts.failed++;
                } else {
                    counts.skipped++;
                }
                continue;
            }

            const guest = fbGuestById[booking.guest_id];
            const firstName = displayName(guest, 'there').split(' ')[0] || 'there';
            const body = checkInFallbackBody({
                firstName,
                listing,
                checkIn: formatDate(booking.check_in),
                code,
            });

            const { error: messageError } = await admin.from('messages').insert({
                booking_id: booking.id,
                sender_id: booking.host_id,
                recipient_id: booking.guest_id,
                body,
            });

            if (messageError) {
                await admin
                    .from('sent_scheduled_messages')
                    .delete()
                    .eq('booking_id', booking.id)
                    .eq('template_type', 'checkin_fallback');
                await logError(
                    'scheduled-messages: claimed but could not send checkin_fallback for booking ' + booking.id,
                    messageError,
                    { path: '/api/cron/scheduled-messages' }
                );
                counts.failed++;
                continue;
            }

            counts.sent++;
        }
    } catch (fallbackErr: any) {
        // The floor failing must not fail the whole run — the host-authored
        // messages above have already gone.
        await logError(
            'scheduled-messages: the check-in fallback pass failed',
            fallbackErr,
            { path: '/api/cron/scheduled-messages' }
        );
    }
    return counts;
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
            // `id` is not optional here: the scope lookup below keys on it, and
            // without it every template silently reads as the catch-all — which
            // is the wrong door code going to the wrong cottage. `created_at`
            // is what breaks a tie deterministically.
            .select('id, user_id, template_type, body, enabled, anchor, days_offset, send_hour, minutes_after, hours_after, hours_before, created_at')
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

        const usable = (templates || []).filter((t: any) => hasRealContent(t.body));
        if (usable.length === 0) {
            // No host templates at all — but the check-in floor still runs, and
            // this is the commonest case it exists for.
            const fb = await checkInFallbackPass(admin, now, []);
            return NextResponse.json({ ok: true, sent: fb.sent, skipped: fb.skipped, failed: fb.failed });
        }

        // Which listings each template is scoped to. No rows means the
        // catch-all, which is what an untouched template is and what a host
        // with one property will always have.
        const { data: scopeRows, error: scopeError } = await admin
            .from('message_template_listings')
            .select('template_id, listing_id')
            .in('template_id', usable.map((t: any) => t.id));

        if (scopeError) {
            await logError('scheduled-messages: could not load template scopes', scopeError, {
                path: '/api/cron/scheduled-messages',
            });
            return NextResponse.json(
                { ok: false, error: 'Could not load the template scopes' },
                { status: 500 }
            );
        }

        const scopeByTemplate: Record<string, string[]> = {};
        (scopeRows || []).forEach((r: any) => {
            if (!scopeByTemplate[r.template_id]) scopeByTemplate[r.template_id] = [];
            scopeByTemplate[r.template_id].push(r.listing_id);
        });

        const live: ScopedTemplate[] = usable.map((t: any) => ({
            ...t,
            listingIds: scopeByTemplate[t.id] || [],
        }));

        // The types in play, so each booking is asked once per type rather
        // than once per template. That ordering is what makes "most specific
        // wins" mean anything — walking templates instead would send whichever
        // the query happened to return first.
        const templateTypes = Array.from(new Set(live.map((t) => t.template_type)));

        // Stays that are actually happening. A window either side keeps the
        // query small without cutting off a template anchored a fortnight out
        // or one that trails a check-out.
        const from = new Date(now.getTime() - 40 * 86400000).toISOString().split('T')[0];
        const to = new Date(now.getTime() + 40 * 86400000).toISOString().split('T')[0];

        const hostIds = Array.from(new Set(live.map((t) => t.user_id)));
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
        const hasBookingAnchored = live.some((t) => t.anchor === 'booking');

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
            // No template-anchored sends due — the floor still sweeps every
            // arriving stay, including those whose host has no template.
            const fb = await checkInFallbackPass(admin, now, live);
            return NextResponse.json({ ok: true, sent: fb.sent, skipped: fb.skipped, failed: fb.failed });
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

        // Door codes live in their own table with no grants to a browser, so
        // they are only ever read here, with the service role. Only fetched
        // when a live template actually asks for one.
        const codeByListing: Record<string, string> = {};
        if (live.some((t) => usesLockboxCode(t.body))) {
            const { data: codes } = await admin
                .from('listing_access_codes')
                .select('listing_id, code')
                .in('listing_id', listingIds);

            (codes || []).forEach((c: any) => { codeByListing[c.listing_id] = c.code; });
        }

        // Booking first, then type — so exactly one template is chosen per
        // type per booking, by the shared rule, instead of every matching
        // template getting a turn.
        for (const booking of bookings as BookingLike[]) {
            const listing = listingById[booking.listing_id];
            if (!listing) continue;

            for (const templateType of templateTypes) {
                const mine = live.filter((t) => t.user_id === booking.host_id);
                const template = resolveTemplate(mine, templateType, booking.listing_id);
                if (!template) continue;

                if (!isDue(timingFor(template, booking, listing), now)) {
                    continue;
                }

                // Held back rather than sent wrong.
                //
                // Checked before the claim on purpose. Claiming and then
                // refusing to send would mark it done for ever, and the guest
                // would never get their code even once somebody noticed and
                // filled it in. Left unclaimed, the next run after the code is
                // set sends it — late, but sent.
                if (needsLockboxCode(template.body, codeByListing[booking.listing_id])) {
                    await logError(
                        'scheduled-messages: held back ' + template.template_type
                            + ' for booking ' + booking.id
                            + ' — the template asks for a door code and '
                            + (listing.title || booking.listing_id) + ' has none set',
                        null,
                        { path: '/api/cron/scheduled-messages' }
                    );
                    failed++;
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
                    lockboxCode: codeByListing[booking.listing_id] || null,
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

        const fb = await checkInFallbackPass(admin, now, live);
        return NextResponse.json({
            ok: true,
            sent: sent + fb.sent,
            skipped: skipped + fb.skipped,
            failed: failed + fb.failed,
        });
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
