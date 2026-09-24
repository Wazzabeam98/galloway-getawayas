import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { londonDayKey } from '@/lib/dayKey';
import { changeDelta, validateChange, round2, whoAnswers, type StaySnapshot } from '@/lib/bookingChange';
import { quoteChangeTotal } from '@/lib/quoteChange';

export const dynamic = 'force-dynamic';

// Propose a change to a stay — new dates, guest count and/or pets. EITHER side
// may start it: a host proposal is accepted by the guest, a guest proposal is
// approved by the host. Nothing moves here; the money (an increase the guest
// pays, or a decrease they're refunded) only moves once both sides agree. The
// new total is re-priced server-side from the listing's rates — the browser
// never sets the price.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(): this begins a money path.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const bookingId: string = body && body.bookingId;
        const wantCheckIn = String((body && body.checkIn) || '');
        const wantCheckOut = String((body && body.checkOut) || '');
        const wantGuests = Math.trunc(Number(body && body.guests));
        const wantChildren = Math.trunc(Number(body && body.children) || 0);
        const wantPets = Math.trunc(Number(body && body.pets) || 0);
        if (!bookingId) return NextResponse.json({ ok: false, error: 'Missing booking' }, { status: 400 });

        const admin = adminClient();
        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_in, check_out, guests, children, pets, total_price, status')
            .eq('id', bookingId)
            .maybeSingle();
        if (!booking) return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });

        // WHO IS ASKING. The guest of the booking proposes as 'guest'; anyone who
        // can manage the listing proposes as 'host'.
        let initiatedBy: 'host' | 'guest' | null = null;
        if (booking.guest_id === user.id) initiatedBy = 'guest';
        else if (await checkListing(user.id, booking.listing_id, 'can_bookings')) initiatedBy = 'host';
        if (!initiatedBy) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });

        if (!(booking.status === 'confirmed' || booking.status === 'pending')) {
            return NextResponse.json({ ok: false, error: 'This booking can’t be changed.' }, { status: 409 });
        }
        // Changes run until check-out; after that it's a money matter, not a change.
        if (String(booking.check_out).slice(0, 10) < londonDayKey()) {
            return NextResponse.json({ ok: false, error: 'This stay is over — use Send or request money instead.' }, { status: 409 });
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

        // Re-price the proposed stay from the listing's rates — never the client.
        const newTotal = await quoteChangeTotal(admin, {
            listingId: booking.listing_id,
            newCheckIn: wantCheckIn, newCheckOut: wantCheckOut,
            newGuests: wantGuests, newChildren: wantChildren, newPets: wantPets,
        });
        const next: StaySnapshot = {
            checkIn: wantCheckIn, checkOut: wantCheckOut,
            guests: wantGuests, children: wantChildren, pets: wantPets, total: newTotal,
        };

        const check = validateChange(oldStay, next, { maxGuests: Number(listing?.max_guests || 1), petsAllowed }, londonDayKey());
        if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });

        const delta = changeDelta(oldStay.total, next.total);

        // One open change at a time (partial unique index enforces it too).
        const { data: existing } = await admin
            .from('booking_change_requests')
            .select('id').eq('booking_id', bookingId).in('status', ['pending', 'awaiting_guest_payment']).maybeSingle();
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
                initiated_by: initiatedBy,
                new_check_in: next.checkIn, new_check_out: next.checkOut,
                new_guests: next.guests, new_children: next.children, new_pets: next.pets, new_total: next.total,
                old_check_in: oldStay.checkIn, old_check_out: oldStay.checkOut,
                old_guests: oldStay.guests, old_children: oldStay.children, old_pets: oldStay.pets, old_total: oldStay.total,
                price_delta: delta,
                status: 'pending',
                created_by: user.id,
                created_at: nowIso, updated_at: nowIso,
            })
            .select('id')
            .single();
        if (insErr || !created) {
            if (insErr && insErr.code === '23505') {
                return NextResponse.json({ ok: false, error: 'There’s already a change waiting on this booking.' }, { status: 409 });
            }
            await logError('[bookings/change] insert failed', insErr, { path: 'bookings/change' });
            return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
        }

        // Tell the party who must answer — the guest for a host proposal, the host
        // for a guest proposal.
        try {
            const { data: listingTitle } = await admin.from('listings').select('title').eq('id', booking.listing_id).maybeSingle();
            const stayName = (listingTitle && listingTitle.title) || 'the stay';
            const answerer = whoAnswers(initiatedBy);
            const toId = answerer === 'guest' ? booking.guest_id : booking.host_id;
            const { data: toUser } = await admin.auth.admin.getUserById(toId);
            const toEmail = (toUser && toUser.user && toUser.user.email) || '';
            if (toEmail) {
                const moneyLine = delta > 0
                    ? 'The guest would pay an extra <strong>£' + delta.toFixed(2) + '</strong>.'
                    : delta < 0
                        ? 'The guest would be refunded <strong>£' + Math.abs(delta).toFixed(2) + '</strong>.'
                        : 'There’s nothing extra to pay.';
                const subject = initiatedBy === 'host' ? 'Your host proposed a change to your stay' : 'Your guest requested a change to their stay';
                const lead = initiatedBy === 'host'
                    ? 'Your host would like to change your stay at <strong>' + escapeHtml(stayName) + '</strong>.'
                    : 'Your guest has asked to change their stay at <strong>' + escapeHtml(stayName) + '</strong>.';
                await sendEmail(toEmail, subject, emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">' + lead + '</p>'
                    + '<p style="margin:0 0 16px;font-size:15px;color:#475569;">New dates: ' + escapeHtml(next.checkIn) + ' → ' + escapeHtml(next.checkOut)
                    + ' · ' + next.guests + ' guest' + (next.guests === 1 ? '' : 's') + '</p>'
                    + '<p style="margin:0 0 16px;font-size:16px;">' + moneyLine + ' Nothing changes until it’s agreed.</p>'
                    + button(SITE_URL + '/reservations/change/' + created.id, 'Review the change'),
                    'You’re receiving this because you have a booking with Galloway Getaways.'));
            }
        } catch (mailErr) {
            await logError('[bookings/change] notify failed', mailErr, { path: 'bookings/change' });
        }

        return NextResponse.json({ ok: true, id: created.id, delta, newTotal: next.total });
    } catch (err: any) {
        await logError('[bookings/change] ' + ((err && err.message) || 'failed'), err, { path: 'bookings/change' });
        return NextResponse.json({ ok: false, error: 'Could not process that.' }, { status: 500 });
    }
}
