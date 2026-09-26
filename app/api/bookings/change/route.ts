import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL, formatDate } from '@/lib/email';
import { logError } from '@/lib/logError';
import { londonDayKey } from '@/lib/dayKey';
import { validateChange, round2, whoAnswers, guestChangeIsInstant, type StaySnapshot } from '@/lib/bookingChange';
import { quoteChangeMoney } from '@/lib/quoteChange';
import { applyBookingChange } from '@/lib/applyBookingChange';
import { displayName } from '@/lib/utils';

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
            .select('id, listing_id, guest_id, host_id, check_in, check_out, guests, children, pets, total_price, status, nightly_breakdown')
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

        // Only the GUEST may change the guest count. A host-initiated change is
        // dates-only — refuse any attempt to move guests, children or pets (infants
        // aren't stored on the booking, so they never reach here anyway).
        if (initiatedBy === 'host' && (
            wantGuests !== Number(booking.guests || 1)
            || wantChildren !== Number(booking.children || 0)
            || wantPets !== Number(booking.pets || 0)
        )) {
            return NextResponse.json({ ok: false, error: 'Only the guest can change the guest count. You can change the dates.' }, { status: 403 });
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

        // Price the change as a DIFF against what was booked — kept nights keep
        // their paid price, added nights at today's rate, removed nights refunded
        // at what was paid (lib/changeMoney). Never the client's number.
        const { delta, newTotal } = await quoteChangeMoney(admin, booking as any, {
            newCheckIn: wantCheckIn, newCheckOut: wantCheckOut,
            newGuests: wantGuests, newChildren: wantChildren, newPets: wantPets,
        }, { initiatedBy });
        const next: StaySnapshot = {
            checkIn: wantCheckIn, checkOut: wantCheckOut,
            guests: wantGuests, children: wantChildren, pets: wantPets, total: newTotal,
        };

        const check = validateChange(oldStay, next, { maxGuests: Number(listing?.max_guests || 1), petsAllowed }, londonDayKey());
        if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });

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

        // A GUEST change with NO price change applies straight away — no host
        // approval. The delta was re-priced on the server above and the listing's
        // max-guests / pets rules were enforced by validateChange, so this is our
        // decision, not the browser's. The host is only told.
        if (guestChangeIsInstant(initiatedBy, delta)) {
            const claimIso = new Date().toISOString();
            // Claim the row (pending → accepted) as a once-only guard, then rewrite
            // the booking. delta is 0, so no money moves and no balance shifts.
            const { data: claimed } = await admin.from('booking_change_requests')
                .update({ status: 'accepted', responded_at: claimIso, updated_at: claimIso })
                .eq('id', created.id).eq('status', 'pending')
                .select('id');
            if (!claimed || !claimed.length) {
                return NextResponse.json({ ok: false, error: 'That change was just handled. Refresh and try again.' }, { status: 409 });
            }
            const applied = await applyBookingChange(admin, {
                id: created.id, booking_id: booking.id,
                new_check_in: next.checkIn, new_check_out: next.checkOut,
                new_guests: next.guests, new_children: next.children, new_pets: next.pets, new_total: next.total,
            });
            if (!applied.ok) {
                await admin.from('booking_change_requests').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', created.id);
                if (applied.oversold) return NextResponse.json({ ok: false, error: 'Those dates were just taken. Your booking is unchanged.' }, { status: 409 });
                if (applied.gone) return NextResponse.json({ ok: false, error: 'This booking is no longer active, so it can’t be changed.' }, { status: 409 });
                await logError('[bookings/change] instant apply failed', applied.error, { path: 'bookings/change' });
                return NextResponse.json({ ok: false, error: 'Could not apply the change. Your booking is unchanged.' }, { status: 500 });
            }
            await admin.from('booking_change_requests').update({ applied_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', created.id);

            // Tell the host who changed what — a message in the thread AND an email.
            try {
                const [{ data: listingRow }, { data: guestProfile }] = await Promise.all([
                    admin.from('listings').select('title').eq('id', booking.listing_id).maybeSingle(),
                    admin.from('profiles').select('full_name, preferred_name, show_full_name').eq('id', booking.guest_id).maybeSingle(),
                ]);
                const stayName = (listingRow && listingRow.title) || 'the stay';
                const guestFirst = displayName(guestProfile, 'Your guest').split(' ')[0] || 'Your guest';
                const what = describeChange(oldStay, next);
                await admin.from('messages').insert({
                    booking_id: booking.id, sender_id: user.id, recipient_id: booking.host_id,
                    body: guestFirst + ' updated the booking — ' + what + '. No change to the price, so it’s applied.',
                });
                const { data: hostUser } = await admin.auth.admin.getUserById(booking.host_id);
                const hostEmail = (hostUser && hostUser.user && hostUser.user.email) || '';
                if (hostEmail) {
                    await sendEmail(hostEmail, guestFirst + ' updated their booking at ' + stayName, emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;">' + escapeHtml(guestFirst) + ' has updated their booking at <strong>' + escapeHtml(stayName) + '</strong>.</p>'
                        + '<p style="margin:0 0 16px;font-size:15px;color:#475569;">' + escapeHtml(what) + '</p>'
                        + '<p style="margin:0 0 16px;font-size:16px;">There was no change to the price, so it has been applied — no action needed.</p>'
                        + button(SITE_URL + '/dashboard/bookings/' + booking.id, 'Open the booking'),
                        'You’re receiving this because you host this stay with Galloway Getaways.'));
                }
            } catch (mailErr) {
                await logError('[bookings/change] instant notify failed', mailErr, { path: 'bookings/change' });
            }

            return NextResponse.json({ ok: true, id: created.id, delta: 0, applied: true });
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
                // This email goes to whoever must answer: the GUEST for a host
                // proposal, the HOST for a guest proposal. Money copy is written
                // for the reader — "you'd pay / you'd be refunded" to the guest,
                // "the guest would pay / be refunded" to the host.
                const toGuest = answerer === 'guest';
                const moneyLine = delta > 0
                    ? (toGuest
                        ? 'You&rsquo;d pay an extra <strong>£' + delta.toFixed(2) + '</strong>.'
                        : 'The guest would pay an extra <strong>£' + delta.toFixed(2) + '</strong>.')
                    : delta < 0
                        ? (toGuest
                            ? 'You&rsquo;d be refunded <strong>£' + Math.abs(delta).toFixed(2) + '</strong>.'
                            : 'The guest would be refunded <strong>£' + Math.abs(delta).toFixed(2) + '</strong>.')
                        : 'There’s nothing extra to pay.';
                const subject = initiatedBy === 'host' ? 'Your host proposed a change to your stay' : 'Your guest requested a change to their stay';
                const lead = initiatedBy === 'host'
                    ? 'Your host would like to change your stay at <strong>' + escapeHtml(stayName) + '</strong>.'
                    : 'Your guest has asked to change their stay at <strong>' + escapeHtml(stayName) + '</strong>.';
                await sendEmail(toEmail, subject, emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">' + lead + '</p>'
                    + '<p style="margin:0 0 16px;font-size:15px;color:#475569;">New dates: ' + escapeHtml(formatDate(next.checkIn)) + ' → ' + escapeHtml(formatDate(next.checkOut))
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

// A short "who changed what" line for the host's message and email — only the
// levers that actually moved.
function describeChange(o: StaySnapshot, n: StaySnapshot): string {
    const parts: string[] = [];
    if (o.guests !== n.guests) parts.push('guests ' + o.guests + ' → ' + n.guests);
    if (o.children !== n.children) parts.push('children ' + o.children + ' → ' + n.children);
    if (o.pets !== n.pets) parts.push('pets ' + o.pets + ' → ' + n.pets);
    if (o.checkIn !== n.checkIn || o.checkOut !== n.checkOut) parts.push('dates ' + o.checkIn + ' → ' + n.checkIn + ', ' + o.checkOut + ' → ' + n.checkOut);
    return parts.length ? parts.join(' · ') : 'the guest count';
}
