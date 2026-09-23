import { logError } from '@/lib/logError';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { formatUk } from '@/lib/cancellation';
import { foldOrderFamily } from '@/lib/orderFamily';
import { experienceBookingTitle } from '@/lib/experienceBookingTitle';
import { loadBookingSeats } from '@/lib/groupSeats';

export const dynamic = 'force-dynamic';

// Only the person who booked can add or remove anyone. Someone invited to a
// booking cannot invite others onto it.
async function bookedBy(admin: any, bookingId: string, userId: string) {
    const { data } = await admin
        .from('bookings')
        .select('id, listing_id, guest_id, check_in, check_out, status, guests')
        .eq('id', bookingId)
        .maybeSingle();

    if (!data || data.guest_id !== userId) return null;
    return data;
}

// The order equivalent: only the guest who booked the EXPERIENCE can invite to
// it. A seat row belongs to a booking OR an order (never both), so every
// seat-scoped action authorises through whichever parent it carries.
async function orderedBy(admin: any, orderId: string, userId: string) {
    const { data } = await admin
        .from('service_orders')
        .select('id, guest_id, status, attendees, quantity, item_unit, item_name, shape, service_date, service_time, provider_business_name')
        .eq('id', orderId)
        .maybeSingle();

    if (!data || data.guest_id !== userId) return null;
    return data;
}

// The current seats on an order, plus the profiles behind any that are taken,
// returned from every order mutation so the block updates from the response —
// it never reads booking_guests through RLS (service_orders isn't authenticated-
// readable, so the RLS subquery would come back empty). Server-authoritative.
async function loadOrderSeats(admin: any, orderId: string) {
    const { data: seatRows } = await admin
        .from('booking_guests')
        .select('id, user_id, name, email, status, invite_token, seat_index, link_sent_at')
        .eq('order_id', orderId)
        .neq('status', 'removed')
        .order('seat_index');
    const seats = seatRows || [];
    const ids = seats.filter((s: any) => s.user_id).map((s: any) => s.user_id);
    const profiles: Record<string, any> = {};
    if (ids.length) {
        const { data: profRows } = await admin
            .from('profiles')
            .select('id, avatar_url, full_name, preferred_name, show_full_name')
            .in('id', ids);
        (profRows || []).forEach((p: any) => { profiles[p.id] = p; });
    }
    return { seats, profiles };
}

// Authorise a seat row by its parent, for the actions that load a row first.
// Returns { order } or { booking } when the caller owns the parent, else null.
async function ownsRowParent(admin: any, row: any, userId: string) {
    if (row && row.order_id) {
        const order = await orderedBy(admin, row.order_id, userId);
        return order ? { order } : null;
    }
    if (row && row.booking_id) {
        const booking = await bookedBy(admin, row.booking_id, userId);
        return booking ? { booking } : null;
    }
    return null;
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

        // ---- Fill the sheet with one seat per place on the booking ---------
        // Called when the group sheet opens. Every seat on the booking that
        // isn't already a row gets one, each with its own single-use link ready
        // to share — so the sheet shows the whole party the moment it opens,
        // with nothing to add first. Idempotent: it only tops up the shortfall,
        // so re-opening the sheet mints nothing new.
        if (action === 'ensure-seats') {
            // The experience twin: one seat per place BOOKED minus the booker's,
            // capped by the order's attendee count (someone who booked two places
            // gets one companion seat). Same atomic top-up, its own RPC.
            const orderId: string = body.orderId;
            if (orderId) {
                const order = await orderedBy(admin, orderId, user.id);
                if (!order) {
                    return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
                }
                if (order.status === 'cancelled' || order.status === 'refunded' || order.status === 'declined' || order.status === 'expired') {
                    return NextResponse.json({ ok: false, error: 'This experience is no longer live.' }, { status: 400 });
                }
                // The invite list runs to the seats PAID FOR, minus the booker's
                // own place — folding in any confirmed per-person top-ups, so this
                // hint agrees with the ensure_order_seats RPC (which sums the same
                // family). Using attendees alone reported 0 for a per-person order.
                const { data: kids } = await admin
                    .from('service_orders')
                    .select('quantity, attendees, item_unit')
                    .eq('parent_order_id', orderId)
                    .eq('status', 'confirmed');
                const capacity = Math.max(0, foldOrderFamily(order as any, (kids as any[]) || []).headcount - 1);
                const { data: minted, error: seatErr } = await admin
                    .rpc('ensure_order_seats', { p_order: orderId, p_inviter: user.id });
                if (seatErr) {
                    await logError('booking-guests/ensure-seats: could not top up the experience seats', seatErr, {
                        path: 'api/booking-guests', userId: user.id,
                    });
                    return NextResponse.json({ ok: false, error: 'Could not set up the seats.' }, { status: 500 });
                }
                return NextResponse.json({ ok: true, capacity, minted: minted ?? 0, ...(await loadOrderSeats(admin, orderId)) });
            }

            const bookingId: string = body.bookingId;
            if (!bookingId) {
                return NextResponse.json({ ok: false, error: 'Which booking?' }, { status: 400 });
            }
            const booking = await bookedBy(admin, bookingId, user.id);
            if (!booking) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }
            if (booking.status === 'cancelled' || booking.status === 'declined') {
                return NextResponse.json({ ok: false, error: 'This booking has been cancelled.' }, { status: 400 });
            }

            // The booker is one of the party; the rest are companion seats. This
            // is the SAME count the party-total column (guests) carries — adults
            // plus children — so the sheet and the card agree.
            const capacity = Math.max(0, ((booking.guests as number) || 1) - 1);

            // Atomic top-up in one statement, guarded by a partial unique index on
            // (booking_id, seat_index): two devices — or two tabs — opening the
            // sheet at once can no longer each insert the shortfall and double the
            // seats. See 20260903174512_booking_seats_are_atomic.sql.
            const { data: minted, error: seatErr } = await admin
                .rpc('ensure_booking_seats', { p_booking: bookingId, p_inviter: user.id });
            if (seatErr) {
                await logError('booking-guests/ensure-seats: could not top up the party seats', seatErr, {
                    path: 'api/booking-guests', userId: user.id,
                });
                return NextResponse.json({ ok: false, error: 'Could not set up the seats.' }, { status: 500 });
            }

            // Return the seats server-authoritatively — the booker can't read
            // booking_guests from the browser (the order-guests RLS policy touches
            // service_orders, which authenticated can't read, so the select
            // errors), so the sheet reads them here, exactly as the order side does.
            return NextResponse.json({ ok: true, capacity, minted: minted ?? 0, ...(await loadBookingSeats(admin, bookingId)) });
        }

        // ---- Label or bind a seat (optional, on the seat's own row) --------
        // A booker can put a name on a seat, or bind its link to an email so
        // only that address can claim it. Both optional and both reversible;
        // this is the only place name/email live now that they're out of the
        // main share flow.
        if (action === 'label') {
            const guestRowId: string = body.guestId;
            const email: string = ((body.email || '') as string).trim().toLowerCase();
            const name: string = ((body.name || '') as string).trim();

            if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                return NextResponse.json(
                    { ok: false, error: 'That doesn’t look like an email address.' },
                    { status: 400 }
                );
            }

            const { data: row } = await admin
                .from('booking_guests')
                .select('id, booking_id, order_id, status')
                .eq('id', guestRowId)
                .maybeSingle();
            if (!row || row.status === 'removed') {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }
            if (!(await ownsRowParent(admin, row, user.id))) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }
            // Someone already on the seat isn't relabelled from here.
            if (row.status === 'active') {
                return NextResponse.json({ ok: false, error: 'They’ve already joined.' }, { status: 400 });
            }

            // Binding to an address pre-points the seat at that account if it
            // exists; clearing the address unbinds it.
            const { data: matched } = email
                ? await admin.from('profiles').select('id').ilike('email', email).maybeSingle()
                : { data: null };

            const { error } = await admin
                .from('booking_guests')
                .update({ name: name || null, email: email || null, user_id: (matched && matched.id) || null })
                .eq('id', guestRowId);
            if (error) {
                const duplicate = (error.message || '').indexOf('booking_guests_unique_person') !== -1;
                return NextResponse.json(
                    { ok: false, error: duplicate ? 'That address is already on this trip.' : error.message },
                    { status: 400 }
                );
            }
            return NextResponse.json({ ok: true, ...(row.order_id ? await loadOrderSeats(admin, row.order_id) : {}) });
        }

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
                .select('id, booking_id, order_id')
                .eq('id', guestRowId)
                .maybeSingle();
            if (!row) {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }
            if (!(await ownsRowParent(admin, row, user.id))) {
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
                .select('id, booking_id, order_id')
                .eq('id', guestRowId)
                .maybeSingle();
            if (!row) {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }
            if (!(await ownsRowParent(admin, row, user.id))) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }
            await admin
                .from('booking_guests')
                .update({ link_sent_at: new Date().toISOString() })
                .eq('id', guestRowId);
            return NextResponse.json({ ok: true });
        }

        // ---- Attach a KNOWN person (the prefill tap) -----------------------
        // The order is attached to a stay, so the picker offered the people
        // already on that booking as tappable names. Tapping one fills an empty
        // order seat with that known user directly — they are already a real
        // account on the trip, so there is nothing to accept: the seat goes
        // straight to active. Capped because only attendees-1 seats exist.
        if (action === 'attach-known') {
            const guestRowId: string = body.guestId;   // the empty ORDER seat
            const personId: string = body.userId;       // a profiles.id from the stay
            const { data: row } = await admin
                .from('booking_guests')
                .select('id, booking_id, order_id, status')
                .eq('id', guestRowId)
                .maybeSingle();
            if (!row || row.status === 'removed') {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }
            const parent = await ownsRowParent(admin, row, user.id);
            if (!parent || !row.order_id) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }
            if (row.status === 'active') {
                return NextResponse.json({ ok: false, error: 'That seat is taken.' }, { status: 400 });
            }
            if (!personId || personId === user.id) {
                return NextResponse.json({ ok: false, error: 'Pick someone else on the trip.' }, { status: 400 });
            }
            const { data: prof } = await admin
                .from('profiles').select('id, full_name, preferred_name').eq('id', personId).maybeSingle();
            if (!prof) {
                return NextResponse.json({ ok: false, error: 'That person could not be found.' }, { status: 404 });
            }
            const { error } = await admin
                .from('booking_guests')
                .update({
                    user_id: personId,
                    name: (prof.preferred_name || prof.full_name) || null,
                    status: 'active',
                    accepted_at: new Date().toISOString(),
                    invite_token: crypto.randomUUID(),   // retire the unused link
                })
                .eq('id', guestRowId);
            if (error) {
                const duplicate = (error.message || '').indexOf('unique') !== -1;
                return NextResponse.json({ ok: false, error: duplicate ? 'They’re already coming.' : error.message }, { status: 400 });
            }
            return NextResponse.json({ ok: true, ...(await loadOrderSeats(admin, row.order_id)) });
        }

        // ---- Send (or resend) the branded invite email for one companion ----
        if (action === 'email') {
            const guestRowId: string = body.guestId;
            const { data: row } = await admin
                .from('booking_guests')
                .select('id, booking_id, order_id, email, name, invite_token, status')
                .eq('id', guestRowId)
                .maybeSingle();
            if (!row || row.status === 'removed') {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }
            const parent = await ownsRowParent(admin, row, user.id);
            if (!parent) {
                return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            }
            if (!row.email) {
                return NextResponse.json({ ok: false, error: 'Add an email first, or share the link.' }, { status: 400 });
            }

            const { data: bookerProfile } = await admin
                .from('profiles').select('full_name, preferred_name').eq('id', user.id).maybeSingle();
            const bookerName =
                (bookerProfile && (bookerProfile.preferred_name || bookerProfile.full_name)) || 'Someone';

            // An experience invite reads about the experience \u2014 its name and date,
            // never the cottage secrets or the price. A stay invite keeps its
            // existing wording.
            if ((parent as any).order) {
                const o = (parent as any).order;
                // Comes-to-you leads with the listing name and carries its item as
                // a detail; every other shape keeps the item name as the title.
                const { title: invTitle, detail: invDetail } = experienceBookingTitle(o);
                await sendEmail(
                    row.email,
                    bookerName + ' has invited you to an experience',
                    emailLayout(
                        '<p style="margin:0 0 16px;font-size:16px;"><strong>'
                            + escapeHtml(bookerName)
                            + '</strong> has invited you to <strong>'
                            + escapeHtml(invTitle || 'an experience')
                            + '</strong>'
                            + (invDetail ? ' — ' + escapeHtml(invDetail) : '')
                            + (o.service_date ? ' on ' + formatUk(new Date(String(o.service_date))) : '')
                            + '.</p>'
                            + '<p style="margin:0 0 16px;font-size:16px;">Accept and you\u2019ll see where to go and when, and can message the host. You won\u2019t be able to change or cancel the booking, and you won\u2019t see what was paid.</p>'
                            + '<p style="margin:0 0 16px;font-size:14px;color:#6b7280;">Sign in with <strong>'
                            + escapeHtml(row.email)
                            + '</strong> \u2014 the address this was sent to \u2014 to accept.</p>'
                            + button(SITE_URL + '/trip-invite/' + row.invite_token, 'See the experience'),
                        'You\u2019re receiving this because someone invited you to an experience.'
                    )
                );
            } else {
                const booking = (parent as any).booking;
                const { data: listing } = await admin
                    .from('listings').select('title').eq('id', booking.listing_id).maybeSingle();
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
            }

            await admin
                .from('booking_guests')
                .update({ link_sent_at: new Date().toISOString() })
                .eq('id', row.id);

            return NextResponse.json({ ok: true });
        }

        // ---- Empty a seat --------------------------------------------------
        // The seat is part of the booking, so taking someone off it doesn't
        // delete the row — it frees the seat: identity cleared, a fresh token
        // minted (so the old link dies with the person who held it), back to an
        // unclaimed "Guest" ready to invite again. Keeps one row per place.
        if (action === 'remove') {
            const guestRowId: string = body.guestId;

            const { data: row } = await admin
                .from('booking_guests')
                .select('id, booking_id, order_id, user_id')
                .eq('id', guestRowId)
                .maybeSingle();

            if (!row) {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }

            const owns = await ownsRowParent(admin, row, user.id);

            // The booker can empty anyone's seat; anyone can leave their own. This
            // is the over-capacity answer too: if a place is later cancelled and
            // the list is over the cap, an already-accepted companion is NEVER
            // auto-evicted — the booker removes someone deliberately, here.
            const isSelf = row.user_id === user.id;

            if (!owns && !isSelf) {
                return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });
            }

            await admin
                .from('booking_guests')
                .update({
                    status: 'invited',
                    user_id: null,
                    name: null,
                    email: null,
                    accepted_at: null,
                    link_sent_at: null,
                    invite_token: crypto.randomUUID(),
                })
                .eq('id', guestRowId);

            return NextResponse.json({ ok: true, ...(row.order_id ? await loadOrderSeats(admin, row.order_id) : {}) });
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
