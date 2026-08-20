import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { formatUk } from '@/lib/cancellation';

export const dynamic = 'force-dynamic';

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

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
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const action: string = (body && body.action) || 'invite';
        const admin = adminClient();

        // ---- Invite someone along -----------------------------------------
        if (action === 'invite') {
            const bookingId: string = body.bookingId;
            const email: string = ((body.email || '') as string).trim().toLowerCase();
            const name: string = ((body.name || '') as string).trim();

            if (!bookingId || !email) {
                return NextResponse.json(
                    { ok: false, error: 'Enter their email address.' },
                    { status: 400 }
                );
            }

            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                return NextResponse.json(
                    { ok: false, error: 'That doesn\u2019t look like an email address.' },
                    { status: 400 }
                );
            }

            const booking = await bookedBy(admin, bookingId, session.user.id);
            if (!booking) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }

            if (booking.status === 'cancelled' || booking.status === 'declined') {
                return NextResponse.json(
                    { ok: false, error: 'This booking has been cancelled.' },
                    { status: 400 }
                );
            }

            if (email === (session.user.email || '').toLowerCase()) {
                return NextResponse.json(
                    { ok: false, error: 'You booked it, so you\u2019re already on it.' },
                    { status: 400 }
                );
            }

            const { data: existingProfile } = await admin
                .from('profiles')
                .select('id')
                .ilike('email', email)
                .maybeSingle();

            const { data: created, error } = await admin
                .from('booking_guests')
                .insert({
                    booking_id: bookingId,
                    email: email,
                    name: name || null,
                    user_id: (existingProfile && existingProfile.id) || null,
                    invited_by: session.user.id,
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

            const { data: listing } = await admin
                .from('listings')
                .select('title, location')
                .eq('id', booking.listing_id)
                .maybeSingle();

            const { data: bookerProfile } = await admin
                .from('profiles')
                .select('full_name, preferred_name')
                .eq('id', session.user.id)
                .maybeSingle();

            const bookerName =
                (bookerProfile && (bookerProfile.preferred_name || bookerProfile.full_name)) ||
                'Someone';

            await sendEmail(
                email,
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
                        + '<p style="margin:0 0 16px;font-size:16px;">Accept and you\u2019ll be able to see where you\u2019re going, when, how to get in, and message the host directly if you need anything.</p>'
                        + '<p style="margin:0 0 16px;font-size:14px;color:#6b7280;">You won\u2019t be able to change or cancel the booking, and you won\u2019t see what was paid \u2014 that stays with '
                        + escapeHtml(bookerName)
                        + '.</p>'
                        + button(SITE_URL + '/trip-invite/' + created.invite_token, 'See the trip'),
                    'You\u2019re receiving this because someone added you to their trip.'
                )
            );

            return NextResponse.json({ ok: true, id: created.id });
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

            const booking = await bookedBy(admin, row.booking_id, session.user.id);

            // The booker can remove anyone; anyone can remove themselves.
            const isSelf = row.user_id === session.user.id;

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
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Something went wrong' },
            { status: 500 }
        );
    }
}
