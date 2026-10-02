import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';
import { displayName } from '@/lib/utils';
import { sendEmailToAll, recipients, emailLayout, button, escapeHtml, detailRows, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// A host raises a dispute about a booking — something has gone wrong that they
// want us to look at (damage, a no-show, a guest they can't resolve with).
//
// MINIMAL by design: it does not open a Stripe chargeback or create a case
// record. It emails the directors (DISPUTES_ALERT_EMAIL, the same inbox the
// chargeback alerts use) with the booking attached and the host's account of
// it, so a person picks it up. That is what "start a dispute" needs to do
// today — get it in front of us with the booking one click away.
//
// Gated on can_bookings: the owner or a co-host who manages this booking.

export async function POST(request: Request) {
    let bookingId = '';
    try {
        const body = await request.json().catch(() => ({}));
        bookingId = (body && body.bookingId) || '';
        const reason = String((body && body.reason) || '').trim().slice(0, 120);
        const details = String((body && body.details) || '').trim().slice(0, 2000);

        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        if (!bookingId) return NextResponse.json({ ok: false, error: 'Which booking?' }, { status: 400 });
        if (!details) return NextResponse.json({ ok: false, error: 'Tell us what has gone wrong.' }, { status: 400 });

        const admin = adminClient();
        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, host_id, guest_id, check_in, check_out, status, total_price')
            .eq('id', bookingId)
            .maybeSingle();
        if (!booking) return NextResponse.json({ ok: false, error: 'No such booking.' }, { status: 404 });

        const access = await checkListing(user.id, booking.listing_id, 'can_bookings');
        if (!access) return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 });

        const [{ data: listing }, { data: guest }, { data: raiser }] = await Promise.all([
            admin.from('listings').select('title').eq('id', booking.listing_id).maybeSingle(),
            admin.from('profile_private').select('full_name, preferred_name, show_full_name').eq('id', booking.guest_id).maybeSingle(),
            admin.from('profile_private').select('full_name, preferred_name, show_full_name, email').eq('id', user.id).maybeSingle(),
        ]);

        const where = (listing && listing.title) || booking.listing_id;
        const guestName = displayName(guest, 'the guest');
        const raiserName = displayName(raiser, 'a host');

        const to = recipients(process.env.DISPUTES_ALERT_EMAIL);
        if (!to.length) {
            // Nobody to tell — record it so it isn't silently lost, and say so.
            await logError('[bookings/dispute] DISPUTES_ALERT_EMAIL is not set — a host raised a dispute nobody was emailed about', {
                bookingId, reason, raiser: user.id,
            }, { path: 'bookings/dispute' });
            return NextResponse.json({ ok: false, error: 'We couldn’t route your dispute just now. Please email hello@gallowaygetaways.co.uk.' }, { status: 500 });
        }

        const heading = 'Dispute raised — ' + where;
        const { sent, failed } = await sendEmailToAll(
            to,
            heading,
            emailLayout(
                '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">' + escapeHtml(heading) + '</h1>'
                    + '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(raiserName)
                    + ' has raised a dispute about a booking' + (reason ? ' (' + escapeHtml(reason) + ')' : '') + '.</p>'
                    + detailRows([
                        { label: 'Property', value: escapeHtml(String(where)) },
                        { label: 'Guest', value: escapeHtml(guestName) },
                        { label: 'Dates', value: escapeHtml(String(booking.check_in)) + ' → ' + escapeHtml(String(booking.check_out)) },
                        { label: 'Status', value: escapeHtml(String(booking.status || 'unknown')) },
                    ])
                    + '<p style="margin:16px 0 8px;font-size:16px;"><strong>What the host says:</strong></p>'
                    + '<p style="margin:0 0 16px;font-size:15px;white-space:pre-wrap;">' + escapeHtml(details) + '</p>'
                    + button(SITE_URL + '/dashboard/bookings/' + bookingId, 'Open the booking'),
                'You are receiving this because you are a director of Galloway Getaways.'
            )
        );

        if (failed.length) {
            await logError('[bookings/dispute] a dispute alert did not send', {
                bookingId, failed: failed.join(', '), reached: sent.join(', '),
            }, { path: 'bookings/dispute' });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('[bookings/dispute] ' + ((err && err.message) || 'failed'), { bookingId, message: String(err && err.message) }, { path: 'bookings/dispute' });
        return NextResponse.json({ ok: false, error: 'Could not raise the dispute.' }, { status: 500 });
    }
}
