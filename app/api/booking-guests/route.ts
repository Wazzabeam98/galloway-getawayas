import { logError } from '@/lib/logError';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { formatUk } from '@/lib/cancellation';

export const dynamic = 'force-dynamic';

// Only the person who booked can add or remove anyone. Someone invited to a
// booking cannot invite others onto it.
async function bookedBy(admin: any, bookingId: string, userId: string) {
    const { data } = await admin
        .from('bookings')
        .select('id, listing_id, guest_id, check_in, check_out, status')
        .eq('id', bookingId)
        .maybeSingle();

    if (!data || data.guest_id !== userId) return null;
    return data;
}

export async function POST(request: Request) {
    let reporterId: string | null = null;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession() — getSession() trusts an unsigned
        // cookie, so a forged one impersonates any user. getUser() verifies
        // the token against the auth server. Matches the admin/services routes.
        const { data: { user } } = await supabase.auth.getUser();
        reporterId = (user && user.id) || null;

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const action: string = (body && body.action) || 'invite';
        const admin = adminClient();

        // ---- Add someone along --------------------------------------------
        // Name and email are both optional now. Adding someone mints a seat and
        // a single-use link; the booker shares it however they like. An email,
        // when given, keeps binding the link to that address (see accept route).
        if (action === 'invite') {
            const bookingId: string = body.bookingId;
            const email: string = ((body.email || '') as string).trim().toLowerCase();
            const name: string = ((body.name || '') as string).trim();

            if (!bookingId) {
                return NextResponse.json(
                    { ok: false, error: 'Which booking?' },
                    { status: 400 }
                );
            }

            if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                return NextResponse.json(
                    { ok: false, error: 'That doesn\u2019t look like an email address.' },
                    { status: 400 }
                );
            }

            const booking = await bookedBy(admin, bookingId, user.id);
            if (!booking) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }

            if (booking.status === 'cancelled' || booking.status === 'declined') {
                return NextResponse.json(
                    { ok: false, error: 'This booking has been cancelled.' },
                    { status: 400 }
                );
            }

            if (email && email === (user.email || '').toLowerCase()) {
                return NextResponse.json(
                    { ok: false, error: 'You booked it, so you\u2019re already on it.' },
                    { status: 400 }
                );
            }

            // Only pre-match a profile when we actually have an address to match.
            const { data: existingProfile } = email
                ? await admin.from('profiles').select('id').ilike('email', email).maybeSingle()
                : { data: null };

            const { data: created, error } = await admin
                .from('booking_guests')
                .insert({
                    booking_id: bookingId,
                    email: email || null,
                    name: name || null,
                    user_id: (existingProfile && existingProfile.id) || null,
                    invited_by: user.id,
                })
                .select('id, invite_token')
                .single();

            if (error) {
                const duplicate = (error.message || '').indexOf('booking_guests_unique_person') !== -1;
                return NextResponse.json(
                    {
                        ok: false,
                        error: duplicate ? 'They\u2019re already on this trip.' : error.message,
                    },
                    { status: 400 }
                );
            }

            return NextResponse.json({
                ok: true,
                id: created.id,
                token: created.invite_token,
                link: SITE_URL + '/trip-invite/' + created.invite_token,
            });
        }

        // ---- Regenerate a link (revoke in place) ---------------------------
        // A link that's gone to the wrong place, or one that's gone cold: mint a
        // fresh token on the SAME seat. The old link dies instantly (its token
        // no longer exists), and anyone who'd already accepted on the old link
        // is dropped back to invited. The seat, the name and any email are kept.
        if (action === 'regenerate') {
            const guestRowId: string = body.guestId;
            const { data: row } = await admin
                .from('booking_guests')
                .select('id, booking_id')
                .eq('id', guestRowId)
                .maybeSingle();
            if (!row) {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }
            const booking = await bookedBy(admin, row.booking_id, user.id);
            if (!booking) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }

            const freshToken = crypto.randomUUID();
            await admin
                .from('booking_guests')
                .update({
                    invite_token: freshToken,
                    status: 'invited',
                    accepted_at: null,
                    link_sent_at: null,
                })
                .eq('id', guestRowId);

            return NextResponse.json({
                ok: true,
                token: freshToken,
                link: SITE_URL + '/trip-invite/' + freshToken,
            });
        }

        // ---- Mark a link as sent -------------------------------------------
        // Stamped when the booker actually shares a link, so the sheet can show
        // "waiting to send" until it's gone out, then "invited".
        if (action === 'mark-sent') {
            const guestRowId: string = body.guestId;
            const { data: row } = await admin
                .from('booking_guests')
                .select('id, booking_id')
                .eq('id', guestRowId)
                .maybeSingle();
            if (!row) {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }
            const booking = await bookedBy(admin, row.booking_id, user.id);
            if (!booking) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }
            await admin
                .from('booking_guests')
                .update({ link_sent_at: new Date().toISOString() })
                .eq('id', guestRowId);
            return NextResponse.json({ ok: true });
        }

        // ---- Send (or resend) the branded invite email for one companion ----
        if (action === 'email') {
            const guestRowId: string = body.guestId;
            const { data: row } = await admin
                .from('booking_guests')
                .select('id, booking_id, email, name, invite_token, status')
                .eq('id', guestRowId)
                .maybeSingle();
            if (!row || row.status === 'removed') {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }
            const booking = await bookedBy(admin, row.booking_id, user.id);
            if (!booking) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }

            const { data: listing } = await admin
                .from('listings').select('title').eq('id', booking.listing_id).maybeSingle();
            const { data: bookerProfile } = await admin
                .from('profiles').select('full_name, preferred_name').eq('id', user.id).maybeSingle();
            const bookerName =
                (bookerProfile && (bookerProfile.preferred_name || bookerProfile.full_name)) || 'Someone';

            await sendEmail(
                row.email,
                bookerName + ' has added you to a trip',
                emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;"><strong>'
                        + escapeHtml(bookerName)
                        + '</strong> has added you to their stay at <strong>'
                        + escapeHtml((listing && listing.title) || 'a property')
                        + '</strong>, '
                        + formatUk(new Date(booking.check_in))
                        + ' to '
                        + formatUk(new Date(booking.check_out))
                        + '.</p>'
                        + '<p style="margin:0 0 16px;font-size:16px;">Accept and you\u2019ll be able to see where you\u2019re going, when, how to get in (the door code and wifi), and message the host directly if you need anything.</p>'
                        + '<p style="margin:0 0 16px;font-size:14px;color:#6b7280;">Sign in with <strong>'
                        + escapeHtml(row.email)
                        + '</strong> \u2014 the address this was sent to \u2014 to accept. You won\u2019t be able to change or cancel the booking, and you won\u2019t see what was paid.</p>'
                        + button(SITE_URL + '/trip-invite/' + row.invite_token, 'See the trip'),
                    'You\u2019re receiving this because someone added you to their trip.'
                )
            );

            await admin
                .from('booking_guests')
                .update({ link_sent_at: new Date().toISOString() })
                .eq('id', row.id);

            return NextResponse.json({ ok: true });
        }

        // ---- Take someone off it -------------------------------------------
        if (action === 'remove') {
            const guestRowId: string = body.guestId;

            const { data: row } = await admin
                .from('booking_guests')
                .select('id, booking_id, user_id')
                .eq('id', guestRowId)
                .maybeSingle();

            if (!row) {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }

            const booking = await bookedBy(admin, row.booking_id, user.id);

            // The booker can remove anyone; anyone can remove themselves.
            const isSelf = row.user_id === user.id;

            if (!booking && !isSelf) {
                return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });
            }

            await admin
                .from('booking_guests')
                .update({ status: 'removed' })
                .eq('id', guestRowId);

            return NextResponse.json({ ok: true });
        }

        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
    } catch (err: any) {
        console.error('[booking-guests]', err && err.message);

        // The console is nobody's alarm. The guest never hears about the stay they were added to.
        await logError('booking-guests: a guest invitation failed', err, {
            path: 'api/booking-guests',
            userId: reporterId || undefined,
        });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Something went wrong' },
            { status: 500 }
        );
    }
}
