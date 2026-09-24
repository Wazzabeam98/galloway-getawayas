import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { londonDayKey } from '@/lib/dayKey';
import { changeDelta, validateChange, round2, type StaySnapshot } from '@/lib/bookingChange';

export const dynamic = 'force-dynamic';

// The HOST proposes a change to a stay — new dates, guest count, and/or a
// re-priced total. Nothing moves here: this records the proposal and emails the
// guest, who must accept before any money or booking state changes (the house
// rule, and Airbnb's own "Change reservation" — see AIRBNB-HOST-FLOWS/REPORT.md).
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(): this begins a money path.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const bookingId: string = body && body.bookingId;
        const next: StaySnapshot = {
            checkIn: String((body && body.checkIn) || ''),
            checkOut: String((body && body.checkOut) || ''),
            guests: Math.trunc(Number(body && body.guests)),
            children: Math.trunc(Number(body && body.children) || 0),
            pets: Math.trunc(Number(body && body.pets) || 0),
            total: round2(Number(body && body.total)),
        };
        if (!bookingId) return NextResponse.json({ ok: false, error: 'Missing booking' }, { status: 400 });

        const admin = adminClient();
        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_in, check_out, guests, children, pets, total_price, status')
            .eq('id', bookingId)
            .maybeSingle();
        if (!booking) return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });

        // Host-side action: caller must be able to manage this booking.
        const access = await checkListing(user.id, booking.listing_id, 'can_bookings');
        if (!access) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });

        if (!(booking.status === 'confirmed' || booking.status === 'pending')) {
            return NextResponse.json({ ok: false, error: 'This booking can’t be changed.' }, { status: 409 });
        }

        const { data: listing } = await admin
            .from('listings').select('max_guests, amenities').eq('id', booking.listing_id).maybeSingle();
        const petsAllowed = Array.isArray(listing?.amenities) && listing!.amenities.indexOf('Pets allowed') !== -1;

        const oldStay: StaySnapshot = {
            checkIn: String(booking.check_in).slice(0, 10),
            checkOut: String(booking.check_out).slice(0, 10),
            guests: Number(booking.guests || 1),
            children: Number(booking.children || 0),
            pets: Number(booking.pets || 0),
            total: round2(Number(booking.total_price || 0)),
        };

        const check = validateChange(oldStay, next, { maxGuests: Number(listing?.max_guests || 1), petsAllowed }, londonDayKey());
        if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });

        const delta = changeDelta(oldStay.total, next.total);

        // One open change at a time — the partial unique index enforces it, but
        // check first for a clean message rather than a 23505.
        const { data: existing } = await admin
            .from('booking_change_requests')
            .select('id').eq('booking_id', bookingId).eq('status', 'pending').maybeSingle();
        if (existing) {
            return NextResponse.json({ ok: false, error: 'There’s already a change waiting on this booking. Withdraw it first.' }, { status: 409 });
        }

        const nowIso = new Date().toISOString();
        const { data: created, error: insErr } = await admin
            .from('booking_change_requests')
            .insert({
                booking_id: booking.id,
                host_id: booking.host_id,
                guest_id: booking.guest_id,
                new_check_in: next.checkIn,
                new_check_out: next.checkOut,
                new_guests: next.guests,
                new_children: next.children,
                new_pets: next.pets,
                new_total: next.total,
                old_check_in: oldStay.checkIn,
                old_check_out: oldStay.checkOut,
                old_guests: oldStay.guests,
                old_children: oldStay.children,
                old_pets: oldStay.pets,
                old_total: oldStay.total,
                price_delta: delta,
                status: 'pending',
                created_by: user.id,
                created_at: nowIso,
                updated_at: nowIso,
            })
            .select('id')
            .single();
        if (insErr || !created) {
            // 23505 = the partial unique index caught a race we didn't.
            if (insErr && insErr.code === '23505') {
                return NextResponse.json({ ok: false, error: 'There’s already a change waiting on this booking.' }, { status: 409 });
            }
            await logError('[bookings/change] insert failed', insErr, { path: 'bookings/change' });
            return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
        }

        // Tell the guest there is a change to answer.
        try {
            const { data: listingTitle } = await admin.from('listings').select('title').eq('id', booking.listing_id).maybeSingle();
            const stayName = (listingTitle && listingTitle.title) || 'your stay';
            const { data: guestUser } = await admin.auth.admin.getUserById(booking.guest_id);
            const guestEmail = (guestUser && guestUser.user && guestUser.user.email) || '';
            if (guestEmail) {
                const moneyLine = delta > 0
                    ? 'If you accept, you’ll pay an extra <strong>£' + delta.toFixed(2) + '</strong>.'
                    : delta < 0
                        ? 'If you accept, you’ll be refunded <strong>£' + Math.abs(delta).toFixed(2) + '</strong>.'
                        : 'There’s nothing extra to pay.';
                await sendEmail(guestEmail, 'Your host proposed a change to your stay', emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">Your host would like to change your stay at <strong>' + escapeHtml(stayName) + '</strong>.</p>'
                    + '<p style="margin:0 0 16px;font-size:15px;color:#475569;">New dates: ' + escapeHtml(next.checkIn) + ' → ' + escapeHtml(next.checkOut)
                    + ' · ' + next.guests + ' guest' + (next.guests === 1 ? '' : 's') + '</p>'
                    + '<p style="margin:0 0 16px;font-size:16px;">' + moneyLine + ' Nothing changes until you accept.</p>'
                    + button(SITE_URL + '/reservations/change/' + created.id, 'Review the change'),
                    'You’re receiving this because you have a booking with Galloway Getaways.'));
            }
        } catch (mailErr) {
            await logError('[bookings/change] guest notify failed', mailErr, { path: 'bookings/change' });
        }

        return NextResponse.json({ ok: true, id: created.id, delta });
    } catch (err: any) {
        await logError('[bookings/change] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/change' });
        return NextResponse.json({ ok: false, error: 'Could not process that.' }, { status: 500 });
    }
}
