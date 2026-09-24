import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { displayName } from '@/lib/utils';
import { sendEmail, emailLayout, button, escapeHtml, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// A host ASKS a guest for money — an extra fee, a change, damage — as opposed
// to giving it back (host-refund) or moving the booking's own price.
//
// MINIMAL by design, and honest about it: there is no host-initiated charge on
// the platform (a card can only be charged through a checkout the guest starts,
// or an off-session balance charge the system schedules). So this does not take
// money. It records the request in the conversation and emails the guest, so
// the ask is made through us with a number attached and a trail, and the two of
// them settle it. When a real host-initiated charge exists, this is where it
// would call it.
//
// Only the booking's own host may ask — not a co-host. Asking a guest for money
// is the owner's call, the same way cancelling and refunding are.

export async function POST(request: Request) {
    let bookingId = '';
    try {
        const body = await request.json().catch(() => ({}));
        bookingId = (body && body.bookingId) || '';
        const amount = Math.round(Number(body && body.amount) * 100) / 100;
        const reason = String((body && body.reason) || '').trim().slice(0, 500);

        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        if (!bookingId) return NextResponse.json({ ok: false, error: 'Which booking?' }, { status: 400 });
        if (!amount || isNaN(amount) || amount <= 0) return NextResponse.json({ ok: false, error: 'Enter how much to ask for.' }, { status: 400 });
        if (amount > 100000) return NextResponse.json({ ok: false, error: 'That is more than any stay — check it.' }, { status: 400 });
        if (!reason) return NextResponse.json({ ok: false, error: 'Say what the money is for.' }, { status: 400 });

        const admin = adminClient();
        const { data: booking } = await admin
            .from('bookings')
            .select('id, host_id, guest_id, listing_id')
            .eq('id', bookingId)
            .maybeSingle();
        if (!booking) return NextResponse.json({ ok: false, error: 'No such booking.' }, { status: 404 });
        if (booking.host_id !== user.id) return NextResponse.json({ ok: false, error: 'Only the host of this booking can ask the guest for money.' }, { status: 403 });

        const [{ data: listing }, { data: guest }] = await Promise.all([
            admin.from('listings').select('title').eq('id', booking.listing_id).maybeSingle(),
            admin.from('profile_private').select('full_name, preferred_name, show_full_name, email').eq('id', booking.guest_id).maybeSingle(),
        ]);
        const where = (listing && listing.title) || 'your stay';
        const firstName = displayName(guest, 'there').split(' ')[0] || 'there';
        const pounds = '£' + amount.toFixed(2);

        // In the conversation, so the guest sees it where they see everything
        // else about the stay, and there is a record either way.
        await admin.from('messages').insert({
            booking_id: bookingId,
            sender_id: user.id,
            recipient_id: booking.guest_id,
            body: 'I’ve asked you for ' + pounds + ' for ' + where + ': ' + reason
                + '. I’ll follow up here — reply if anything isn’t right.',
        });

        // And an email, so it doesn't sit unseen. It points them at the message
        // thread rather than a pay button, because there is nothing to pay yet.
        if (guest && guest.email) {
            await sendEmail(
                guest.email,
                'A payment request for ' + where + ' — ' + pounds,
                emailLayout(
                    '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">A request from your host</h1>'
                        + '<p style="margin:0 0 16px;font-size:16px;">Hi ' + escapeHtml(firstName) + ', your host has asked for '
                        + '<strong>' + escapeHtml(pounds) + '</strong> for ' + escapeHtml(where) + '.</p>'
                        + '<p style="margin:0 0 16px;font-size:16px;"><strong>What it’s for:</strong> ' + escapeHtml(reason) + '</p>'
                        + '<p style="margin:0 0 16px;font-size:15px;color:#6b7280;">Open the conversation to reply or ask a question. '
                        + 'Nothing has been charged — you and your host settle this between you.</p>'
                        + button(SITE_URL + '/messages?b=' + bookingId, 'Open the conversation'),
                    'You are receiving this because you have a booking with Galloway Getaways.'
                )
            );
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('[bookings/request-money] ' + ((err && err.message) || 'failed'), { bookingId, message: String(err && err.message) }, { path: 'bookings/request-money' });
        return NextResponse.json({ ok: false, error: 'Could not send the request.' }, { status: 500 });
    }
}
