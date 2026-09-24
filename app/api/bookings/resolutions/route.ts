import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { stripeRequest } from '@/lib/stripe';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import {
    commissionRateFor, isDamageAllowed, sendCapPounds, validateSendAmount,
    escalationDeadline, round2, toPence,
    type ResolutionDirection, type ResolutionReason,
} from '@/lib/resolutions';

export const dynamic = 'force-dynamic';

const BUCKET = 'resolution-attachments';
const NOTE_MAX = 1000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'application/pdf': 'pdf',
};

// Create a money resolution on a stay — the host either REQUESTS money from the
// guest (extra services, or damage after checkout) or SENDS money (a refund).
//   request → recorded 'pending', the guest is emailed to accept/decline/counter;
//             escalates to an admin after 72h with no answer.
//   send    → the host is sent to a one-off Stripe page; only once that clears
//             does the webhook refund the guest to their original card.
// Multipart so photos/PDF receipts ride along and land in a private bucket.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), never getSession(): this starts money movement, so the
        // identity is verified against the auth server.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const form = await request.formData();
        const bookingId = String(form.get('bookingId') || '');
        const direction = String(form.get('direction') || '') as ResolutionDirection;
        const reason = String(form.get('reason') || '') as ResolutionReason;
        const amount = round2(Number(form.get('amount')));
        const note = String(form.get('note') || '').trim();
        const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);

        if (!bookingId) return NextResponse.json({ ok: false, error: 'Missing booking' }, { status: 400 });
        if (direction !== 'request' && direction !== 'send') return NextResponse.json({ ok: false, error: 'Choose send or request.' }, { status: 400 });
        if (reason !== 'extra_services' && reason !== 'damage') return NextResponse.json({ ok: false, error: 'Choose a reason.' }, { status: 400 });
        if (!(amount > 0)) return NextResponse.json({ ok: false, error: 'Enter an amount.' }, { status: 400 });
        if (note.length > NOTE_MAX) return NextResponse.json({ ok: false, error: 'That note is too long.' }, { status: 400 });

        const admin = adminClient();

        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_out, status, amount_paid, amount_refunded, stripe_payment_intent_id')
            .eq('id', bookingId)
            .maybeSingle();
        if (!booking) return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });

        // Host-side action: the caller must be able to manage this booking
        // (owner or a co-host with the bookings permission). checkListing returns
        // null when neither holds.
        const access = await checkListing(user.id, booking.listing_id, 'can_bookings');
        if (!access) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });

        // Damage is reimbursement for a stay that has happened — refuse it while
        // the booking is still upcoming.
        if (reason === 'damage' && !isDamageAllowed(booking.check_out)) {
            return NextResponse.json({ ok: false, error: 'Damage can only be claimed after the guest has checked out.' }, { status: 400 });
        }

        // A send may not exceed what the guest has paid, net of refunds.
        if (direction === 'send') {
            const cap = sendCapPounds(booking.amount_paid, booking.amount_refunded);
            const check = validateSendAmount(amount, cap);
            if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });
        }

        const commissionRate = commissionRateFor(direction, reason);
        const nowIso = new Date().toISOString();

        const { data: created, error: insErr } = await admin
            .from('booking_resolutions')
            .insert({
                booking_id: booking.id,
                host_id: booking.host_id,
                guest_id: booking.guest_id,
                direction,
                reason,
                amount,
                note: note || null,
                commission_rate: commissionRate,
                status: direction === 'send' ? 'awaiting_host_payment' : 'pending',
                created_by: user.id,
                created_at: nowIso,
                updated_at: nowIso,
                expires_at: direction === 'request' ? escalationDeadline(nowIso) : null,
            })
            .select('id')
            .single();
        if (insErr || !created) {
            await logError('[resolutions/create] insert failed', insErr, { path: 'bookings/resolutions' });
            return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
        }
        const resolutionId = created.id;

        // Store any attachments privately, keyed under the resolution.
        for (const file of files) {
            const ext = ALLOWED_TYPES[file.type];
            if (!ext) return NextResponse.json({ ok: false, error: 'Attachments must be PNG, JPG or PDF.' }, { status: 400 });
            if (file.size > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: 'Each attachment must be under 10MB.' }, { status: 400 });
            const safe = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
            const path = resolutionId + '/' + crypto.randomUUID() + '-' + safe;
            const buf = Buffer.from(await file.arrayBuffer());
            const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, { contentType: file.type });
            if (upErr) {
                await logError('[resolutions/create] attachment upload failed', upErr, { path: 'bookings/resolutions' });
                return NextResponse.json({ ok: false, error: 'An attachment could not be uploaded. Try again.' }, { status: 500 });
            }
            await admin.from('booking_resolution_attachments').insert({
                resolution_id: resolutionId, path, content_type: file.type, uploaded_by: user.id,
            });
        }

        const { data: listing } = await admin.from('listings').select('title').eq('id', booking.listing_id).maybeSingle();
        const stayName = (listing && listing.title) || 'your stay';

        // SEND: send the host to a one-off Stripe page. Their card is NOT saved.
        // The guest is refunded only when this clears (see the webhook).
        if (direction === 'send') {
            try {
                const checkout = await stripeRequest('POST', '/checkout/sessions', {
                    mode: 'payment',
                    customer_email: user.email || undefined,
                    payment_method_types: ['card'],
                    line_items: [{
                        quantity: 1,
                        price_data: {
                            currency: 'gbp',
                            unit_amount: toPence(amount),
                            product_data: {
                                name: 'Refund to your guest — ' + stayName,
                                description: 'You are sending £' + amount.toFixed(2) + ' back to your guest. Once this payment clears, we refund them the same amount to their original card.',
                            },
                        },
                    }],
                    // No transfer, no application fee: this funds the platform's
                    // refund to the guest. No setup_future_usage: the card is not kept.
                    payment_intent_data: {
                        description: 'Galloway Getaways — host refund funding · ' + stayName,
                        metadata: { kind: 'resolution_send', resolution_id: resolutionId, booking_id: booking.id },
                    },
                    success_url: SITE_URL + '/dashboard/bookings/' + booking.id + '?sent=1',
                    cancel_url: SITE_URL + '/dashboard/bookings/' + booking.id + '?sent=cancelled',
                    metadata: { kind: 'resolution_send', resolution_id: resolutionId, booking_id: booking.id },
                });
                return NextResponse.json({ ok: true, id: resolutionId, url: checkout.url });
            } catch (err: any) {
                await admin.from('booking_resolutions').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', resolutionId);
                await logError('[resolutions/create] send checkout failed', err, { path: 'bookings/resolutions' });
                return NextResponse.json({ ok: false, error: 'Could not start the payment. Try again.' }, { status: 502 });
            }
        }

        // REQUEST: tell the guest there is money to answer.
        try {
            const { data: guestUser } = await admin.auth.admin.getUserById(booking.guest_id);
            const guestEmail = (guestUser && guestUser.user && guestUser.user.email) || '';
            if (guestEmail) {
                await sendEmail(guestEmail, 'Your host has requested £' + amount.toFixed(2), emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">Your host has requested <strong>£' + amount.toFixed(2)
                    + '</strong> for your stay at <strong>' + escapeHtml(stayName) + '</strong>'
                    + (reason === 'damage' ? ' (damage or extra cleaning)' : ' (extra services)') + '.</p>'
                    + (note ? '<p style="margin:0 0 16px;font-size:15px;color:#475569;">“' + escapeHtml(note) + '”</p>' : '')
                    + '<p style="margin:0 0 16px;font-size:16px;">You can accept and pay, decline, or suggest a different amount.</p>'
                    + button(SITE_URL + '/resolutions/' + resolutionId, 'Review the request'),
                    'You’re receiving this because you have a booking with Galloway Getaways.'));
            }
        } catch (mailErr) {
            await logError('[resolutions/create] guest notify failed', mailErr, { path: 'bookings/resolutions' });
        }
        return NextResponse.json({ ok: true, id: resolutionId });
    } catch (err: any) {
        await logError('[resolutions/create] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/resolutions' });
        return NextResponse.json({ ok: false, error: 'Could not process that.' }, { status: 500 });
    }
}
