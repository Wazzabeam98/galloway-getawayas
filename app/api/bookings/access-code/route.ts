import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// A per-BOOKING door-code override.
//
// The standing code is per listing (listing_access_codes). This route is the
// only way in or out of booking_access_codes — the one-guest exception, keyed
// on the booking. That table has no grants for anon or authenticated, so a
// browser cannot read or write it however the query is phrased; this route is
// the whole surface, and it gates on can_listing (the same permission that
// guards the listing code) for the booking's own listing.
//
// The code is never returned to the guest here. The guest receives it exactly
// as they receive the standing code — on the gated arrival screen, and in the
// scheduled check-in message. When a host changes the code on a booking whose
// check-in message has ALREADY been sent (the sent copy is frozen and cannot be
// rewritten), we post a fresh message into the conversation with the new code,
// so "the guest sees the change straight away" holds however late it is made.

// The check-in message types the scheduled sender records once it has sent a
// code to a guest. If one of these exists for the booking, the guest already
// holds a code and must be told it has changed.
const CHECKIN_TYPES = ['checkin_details', 'checkin_fallback'];

async function gate(bookingId: string) {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession() — a forged session cookie must not pass.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 }) };
    if (!bookingId) return { error: NextResponse.json({ ok: false, error: 'Which booking?' }, { status: 400 }) };

    const admin = adminClient();
    const { data: booking } = await admin
        .from('bookings')
        .select('id, listing_id, host_id, guest_id, status, check_out')
        .eq('id', bookingId)
        .maybeSingle();
    if (!booking) return { error: NextResponse.json({ ok: false, error: 'No such booking.' }, { status: 404 }) };

    // The door code is listing-permission-gated, not merely booking-management:
    // a co-host with can_bookings but not can_listing never sees the code, so
    // they cannot set one either. Same wall as the listing code.
    const access = await checkListing(user.id, booking.listing_id, 'can_listing');
    if (!access) return { error: NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 }) };

    return { uid: user.id, booking, admin };
}

export async function GET(request: Request) {
    try {
        const bookingId = new URL(request.url).searchParams.get('booking') || '';
        const g = await gate(bookingId);
        if (g.error) return g.error;

        const { data } = await g.admin
            .from('booking_access_codes')
            .select('code, updated_at')
            .eq('booking_id', bookingId)
            .maybeSingle();

        return NextResponse.json({ ok: true, code: (data && data.code) || '', updated_at: (data && data.updated_at) || null });
    } catch (err: any) {
        await logError('[bookings/access-code GET] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/access-code' });
        return NextResponse.json({ ok: false, error: 'Could not read the code.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    let bookingId = '';
    try {
        const body = await request.json().catch(() => ({}));
        bookingId = (body && body.bookingId) || '';
        const code = String((body && body.code) || '').trim();

        const g = await gate(bookingId);
        if (g.error) return g.error;

        // Editing is for an upcoming booking. A cancelled or declined stay has no
        // arrival, and a stay already over cannot have its entry changed.
        if (g.booking.status === 'cancelled' || g.booking.status === 'declined') {
            return NextResponse.json({ ok: false, error: 'This booking is off — there is nothing to let anyone into.' }, { status: 400 });
        }

        if (code.length > 40) {
            return NextResponse.json({ ok: false, error: 'That is longer than any door code — check it.' }, { status: 400 });
        }

        // Clearing removes the row, so "no override" is a single state and the
        // booking falls back to the listing's standing code.
        if (!code) {
            await g.admin.from('booking_access_codes').delete().eq('booking_id', bookingId);
        } else {
            const { error } = await g.admin
                .from('booking_access_codes')
                .upsert({ booking_id: bookingId, code, updated_at: new Date().toISOString(), updated_by: g.uid }, { onConflict: 'booking_id' });
            if (error) {
                await logError('[bookings/access-code] could not save', { bookingId, message: error.message }, { path: 'bookings/access-code' });
                return NextResponse.json({ ok: false, error: 'Could not save the code.' }, { status: 500 });
            }
        }

        // What the guest should now use: the override if one is set, else the
        // listing's standing code. This is the same precedence the arrival screen
        // and the scheduled sender apply.
        let effective = code;
        if (!effective) {
            const { data: listingCode } = await g.admin
                .from('listing_access_codes').select('code').eq('listing_id', g.booking.listing_id).maybeSingle();
            effective = (listingCode && listingCode.code) || '';
        }

        // If the guest was ALREADY sent a check-in message, the code they hold is
        // now wrong. The sent copy is frozen, so we post a fresh line into the
        // conversation. Only for a confirmed stay (an unconfirmed one has had no
        // code sent), and only when a code was in fact sent.
        let notified = false;
        if (g.booking.status === 'confirmed' && effective) {
            const { data: sent } = await g.admin
                .from('sent_scheduled_messages')
                .select('id')
                .eq('booking_id', bookingId)
                .in('template_type', CHECKIN_TYPES)
                .limit(1);
            if (sent && sent.length) {
                const { data: listing } = await g.admin
                    .from('listings').select('title').eq('id', g.booking.listing_id).maybeSingle();
                const where = (listing && listing.title) || 'your stay';
                await g.admin.from('messages').insert({
                    booking_id: bookingId,
                    sender_id: g.uid,
                    recipient_id: g.booking.guest_id,
                    body: 'Quick update for ' + where + ': the door code has changed to ' + effective
                        + '. Please use this one when you arrive — it replaces the code in your earlier check-in message.',
                });
                notified = true;
            }
        }

        return NextResponse.json({ ok: true, code, effective, notified });
    } catch (err: any) {
        await logError('[bookings/access-code POST] ' + ((err && err.message) || 'failed'), { bookingId, message: String(err && err.message) }, { path: 'bookings/access-code' });
        return NextResponse.json({ ok: false, error: 'Could not save the code.' }, { status: 500 });
    }
}
