import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripeRequest } from '@/lib/stripe';
import { SITE_URL } from '@/lib/email';
import {
    isLiveToGuests, priceOrder, guestExperiencesOpen,
    normaliseUnit, unitMultiplies, orderQuantity, orderTotal, MAX_ORDER_QUANTITY, expiryFrom,
} from '@/lib/serviceOrders';
import {
    isSlot, sessionCapacity, hasSlotCapacity, generateSessions, SLOT_HOLD_MINUTES,
    bookingIsPrivate, slotClaimKind, optionAvailability, seatConfig,
    resolvedDuration, overlapsBooked, minutesOfDay,
} from '@/lib/serviceSlots';
import { itemFulfilment } from '@/lib/serviceProviders';
import { dateFromKey, dateKey } from '@/lib/pricing';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { displayName } from '@/lib/utils';
import { withinLimits, callerAddress } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// How far ahead a bookingless (standalone) slot may be booked — the same horizon
// the public marketplace browses over. A stay bounds the against-a-cottage path;
// standalone has none.
const STANDALONE_HORIZON_DAYS = 90;

// A guest booking a slot — the instant shape. Unlike the request shapes, there is
// no provider to confirm: the seat is claimed here, the card is charged on the
// Checkout that follows, and the booking is live the moment it is paid.
//
// THE SEAT IS CLAIMED BEFORE THE CARD, AND HELD FOR 15 MINUTES. Two guests can
// reach the last 2pm at once, so the claim has to be atomic — it is a
// compare-and-swap on seats_taken (update ... where seats_taken = the value we
// read), which the database serialises. Win the swap and a 'holding' order is
// created with a 15-minute expiry; the webhook turns it into a confirmed booking
// on payment, and the sweep releases the seat if the guest never pays. Nobody is
// ever charged for a seat they could not have.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // May be null: a brand-new guest booking a STANDALONE experience need not
        // sign in first. They give their contact here and the account is minted
        // only once Stripe confirms the payment (in the webhook). An against-a-stay
        // booking still requires the signed-in booking owner — gated below, once we
        // know which shape this is.
        const { data: { user } } = await supabase.auth.getUser();

        if (!guestExperiencesOpen()) {
            return NextResponse.json({ ok: false, error: 'Guest experiences aren’t open yet.' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const providerId: string = body && body.providerId;
        const bookingId: string = body && body.bookingId;
        const sessionDate: string = body && body.sessionDate;
        const sessionTime: string = body && body.sessionTime;      // "HH:MM"
        // The product the guest picked off the provider's menu. A slot provider
        // can offer more than one — a private hire AND a shared table — so the
        // guest's choice decides which, and with it the unit, capacity, minimum
        // and mode. Absent for a single-item provider (the shape before two
        // products), where we fall back to their one item.
        const requestedItemId: string = body && body.itemId;
        const requestedQuantity: unknown = body && body.quantity;
        const note: string = (body && body.note ? String(body.note) : '').slice(0, 500);
        // The allergy field, separate from note — see the order route. A slot
        // auto-confirms, so this is the guest's one chance to state it up front.
        const allergy: string = (body && body.allergy ? String(body.allergy) : '').slice(0, 500);
        // Typed contact for an anonymous standalone booker (no session). Ignored
        // when signed in — the profile is the source of truth then. Validated only
        // on the anonymous path below.
        const typedName: string = (body && body.guestName ? String(body.guestName) : '').slice(0, 120).trim();
        const typedEmail: string = (body && body.guestEmail ? String(body.guestEmail) : '').slice(0, 200).trim().toLowerCase();
        const typedPhone: string = (body && body.guestPhone ? String(body.guestPhone) : '').slice(0, 40).trim();

        if (!providerId || !sessionDate || !sessionTime) {
            return NextResponse.json({ ok: false, error: 'Missing details' }, { status: 400 });
        }

        // STANDALONE (bookingless) vs against-a-stay. A standalone buyer is a
        // signed-in user (checked above) with no booking: identity is their
        // account, the date is any day the provider is open within the horizon (not
        // a stay window), the head count is asked, and a travelling session's
        // address is typed in — none of it derived from a booking. When a bookingId
        // IS supplied it is validated and owned exactly as before.
        const standalone = !bookingId;

        // THE AUTH GATE, now that we know the shape.
        //   against-a-stay  → must be the signed-in booking owner (checked below too)
        //   standalone      → a signed-in guest OR a brand-new one giving contact
        // A brand-new standalone guest is minted only after payment, so here we
        // only need a real email to reach them and to key the account on.
        const anonymous = standalone && !user;
        if (!standalone && !user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }
        if (anonymous) {
            const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typedEmail);
            if (!typedName || !looksLikeEmail) {
                return NextResponse.json(
                    { ok: false, error: 'Add your name and a valid email so we can send your booking.' },
                    { status: 400 }
                );
            }
            // Slow down anyone spinning up holds (and Checkout sessions) against
            // the anonymous door — by address and by caller. Fail-open like the
            // apply flow; a blocked attempt is not recorded.
            const verdict = await withinLimits([
                { bucket: 'guest-slot-book:email', key: typedEmail, max: 8, windowMinutes: 60 },
                { bucket: 'guest-slot-book:ip', key: callerAddress(request.headers), max: 20, windowMinutes: 60 },
            ]);
            if (!verdict.ok) {
                return NextResponse.json(
                    { ok: false, error: 'That’s a lot of attempts in a short time. Try again shortly.' },
                    { status: 429 }
                );
            }
        }

        const admin = adminClient();

        let booking: any = null;
        if (!standalone) {
            const { data } = await admin
                .from('bookings')
                .select('id, guest_id, listing_id, check_in, check_out, guests')
                .eq('id', bookingId)
                .maybeSingle();
            if (!data) return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 });
            // user is non-null here: the gate above returns 401 for a non-standalone
            // request without a session, and this block is the non-standalone path.
            if (data.guest_id !== user!.id) return NextResponse.json({ ok: false, error: 'Not your booking' }, { status: 403 });
            booking = data;
        }

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, business_name, trade, shape, status, stripe_account_id, stripe_payouts_enabled, plan, commission_rate, slot_length_minutes, slot_turnaround_minutes, slot_capacity, slot_min_people, cancellation_window_hours, fulfilment')
            .eq('id', providerId)
            .maybeSingle();

        if (!provider || !isSlot(provider) || !isLiveToGuests(provider) || !provider.stripe_account_id) {
            return NextResponse.json({ ok: false, error: 'That isn’t available.' }, { status: 400 });
        }

        // The chosen item carries the price, the unit, the name — and so the mode
        // (a flat item is a private hire, a per-person item a shared seat). Read
        // it by the id the guest picked, scoped to THIS provider so a foreign or
        // inactive id cannot be booked; fall back to the provider's single item
        // when none was sent. Everything downstream — unit, capacity, minimum,
        // private/shared — derives from this row, never from the browser.
        const itemQuery = admin
            .from('service_provider_items')
            .select('id, name, description, price, unit, active, duration_minutes, fulfilment, capacity, min_people')
            .eq('provider_id', provider.id)
            .eq('active', true)
            .gt('price', 0);
        const { data: item } = requestedItemId
            ? await itemQuery.eq('id', requestedItemId).maybeSingle()
            : await itemQuery.order('sort_order', { ascending: true }).limit(1).maybeSingle();
        if (!item) return NextResponse.json({ ok: false, error: 'That isn’t available.' }, { status: 400 });

        const unit = normaliseUnit(item.unit);

        // The seats and minimum for THIS item — its own when set, else the
        // provider's (the phased fallback). Every seat read below goes through
        // `seat`, and it's the SAME object handed to optionAvailability, so the
        // enforcement here reads exactly what the panel greyed with.
        const seat = seatConfig(item.capacity, item.min_people, provider);

        // The date must fall inside the stay, and the (date, time) must be a real
        // session the template offers and the provider has not blocked. Never
        // trust the pair from the browser.
        const when = dateFromKey(sessionDate);
        if (standalone) {
            // No stay to bound it: any day from today to the horizon. The
            // future-time check below still rejects a time already past today.
            const today = dateFromKey(londonDayKey());
            const horizon = dateFromKey(shiftDayKey(londonDayKey(), STANDALONE_HORIZON_DAYS));
            if (when < today || when > horizon) {
                return NextResponse.json({ ok: false, error: 'Pick a day within the next few months.' }, { status: 400 });
            }
        } else {
            const start = dateFromKey(booking.check_in);
            const end = dateFromKey(booking.check_out);
            if (when < start || when >= end) {
                return NextResponse.json({ ok: false, error: 'Pick a time during your stay.' }, { status: 400 });
            }
        }

        // The length THIS booking runs is the chosen treatment's own duration when
        // it has one (massage: 30/45/60/90), else the provider's single length
        // (sauna, a class). The reset gap is the provider's, folded into the block
        // the day reserves but never shown to the guest. Both come off the trusted
        // server rows, never the browser.
        const durationMinutes = resolvedDuration(item, provider);
        const turnaround = Math.max(0, Number(provider.slot_turnaround_minutes) || 0);

        const [{ data: avail }, { data: blocks }, { data: partialRows }] = await Promise.all([
            admin.from('slot_availability').select('day_of_week, open_time, close_time').eq('provider_id', provider.id),
            admin.from('slot_blocks').select('blocked_date').eq('provider_id', provider.id),
            // The provider's PARTIAL blocks on this date — rows the host closed off.
            // The database exclusion is the authority (the establishing CAS below
            // hits it), but feeding them into the grid here refuses a covered start
            // up front, with a friendly message and no wasted Checkout.
            admin.from('slot_sessions').select('session_time, duration_minutes')
                .eq('provider_id', provider.id).eq('session_date', sessionDate).eq('blocked', true),
        ]);
        const partialBlocks = (partialRows || []).map((b: any) => {
            const startMin = minutesOfDay(String(b.session_time).slice(0, 5));
            return { date: sessionDate, startMin, endMin: startMin + (Number(b.duration_minutes) || 0) };
        });
        // The grid THIS treatment is offered on: starts step by duration + turnaround
        // (so consecutive bookings never overlap once the reset gap is counted), and a
        // start only needs room for the treatment itself before close. For a fixed-grid
        // provider (no per-item duration, turnaround 0) this is the identical grid as
        // before — step and fit both equal slot_length_minutes. Partial blocks drop
        // any covered start, the same rule the guest panel greyed with.
        const legit = generateSessions(
            (avail || []).map((a: any) => ({ day_of_week: a.day_of_week, open_time: a.open_time, close_time: a.close_time })),
            (blocks || []).map((b: any) => b.blocked_date),
            durationMinutes + turnaround,
            sessionDate, sessionDate,
            durationMinutes,
            partialBlocks,
        ).some((s) => s.time === sessionTime);
        if (!legit) {
            return NextResponse.json({ ok: false, error: 'That time isn’t available. Pick another.' }, { status: 400 });
        }

        // The session must still be in the future.
        if (new Date(sessionDate + 'T' + (sessionTime.length === 5 ? sessionTime + ':00' : sessionTime) + 'Z').getTime() <= Date.now()) {
            return NextResponse.json({ ok: false, error: 'That time has passed. Pick another.' }, { status: 400 });
        }

        // A per-person item is a shared table, and a shared table needs a real
        // number of seats. Without a capacity, sessionCapacity() falls back to 1
        // and the "shared" table would sell a single seat at a per-person price —
        // a private hire in all but name, at the wrong price and mode. Refuse a
        // misconfigured item HERE, before the seat is claimed and before Stripe,
        // exactly as the minimum is: an unbookable listing must not be booked, not
        // quietly sold as something it isn't. (A flat item needs no capacity — a
        // private hire is always one booking — so this bites per-person only.)
        if (unitMultiplies(unit) && !hasSlotCapacity(seat)) {
            return NextResponse.json(
                { ok: false, error: 'This session isn’t bookable yet — the host hasn’t set how many people it’s for. Try again later or message them.' },
                { status: 400 }
            );
        }

        const capacity = sessionCapacity(seat, unit);
        // A flat item is a private hire (takes the whole session); a per-person
        // item is a seat at a shared table. The first booking pins the time to
        // one mode; a later booking of the other kind is refused below.
        const isPrivate = bookingIsPrivate(unit);
        const quantity = orderQuantity(unit, unitMultiplies(unit) ? requestedQuantity : 1);
        if (quantity === null) {
            return NextResponse.json(
                { ok: false, error: 'Choose how many, up to ' + MAX_ORDER_QUANTITY + '.' },
                { status: 400 }
            );
        }

        // THE HEAD COUNT on a PRIVATE session. A flat item is bought once at one
        // price whatever the head count, but the provider still needs to know how
        // many are coming (mats, chairs, cups). The honest cap is the provider's
        // declared capacity where it has one (a room/table size), else the cottage
        // booking's guest count — you cannot bring more people than are staying,
        // and a traveller declares no capacity. Clamped here, never trusted from
        // the browser; NULL for a per-person booking, where the quantity IS the
        // head count. It does not touch price.
        // The head-count ceiling for a private/travelling session. Against a stay
        // it's the cottage party; standalone has no cottage, so it's the provider's
        // declared capacity (a studio/table size), or a sane ceiling for a
        // traveller who declares none.
        const cottageGuests = standalone
            ? (Number(seat.slot_capacity) > 0 ? Number(seat.slot_capacity) : 20)
            : Math.max(1, Number(booking.guests) || 1);
        // The booked item's location: its own for a 'both' provider, else the
        // provider's single answer. A TRAVELLING item ignores the provider's
        // studio capacity — no cap on a session in the guest's own cottage beyond
        // who is staying there — so its head-count cap is the cottage alone.
        const bookedFulfilment = itemFulfilment(item, provider.fulfilment);
        const itemIsTravelling = bookedFulfilment === 'delivery';
        const declaredCap = itemIsTravelling ? null : (Number(seat.slot_capacity) > 0 ? Number(seat.slot_capacity) : null);
        const attendeesCap = declaredCap != null ? Math.min(declaredCap, cottageGuests) : cottageGuests;
        const attendees = isPrivate
            ? Math.min(Math.max(1, Math.floor(Number(body.attendees) || 1)), attendeesCap)
            : null;

        // THE PER-PERSON MINIMUM — the real invariant, not the picker floor.
        // A tasting or class priced per person may set a smallest group it will
        // run for (slot_min_people, default 1 = no minimum). It bites only when
        // the unit multiplies (per person); a whole-group flat price is one
        // booking regardless of head count. Enforced HERE so a crafted request
        // that goes under the floor is rejected, exactly as the ceiling is.
        const minPeople = unitMultiplies(unit) ? Math.max(1, Number(seat.slot_min_people) || 1) : 1;
        if (quantity < minPeople) {
            return NextResponse.json(
                { ok: false, error: 'This session is for a minimum of ' + minPeople + ' people.' },
                { status: 400 }
            );
        }

        // ---- refuse an overlapping interval, before Stripe -----------------
        // The COURTESY half of the overlap guard. The authority is the database
        // (slot_sessions_no_overlap); this check exists so a guest whose grid is a
        // moment stale gets the same friendly "that time just filled up" WITHOUT a
        // pointless Checkout being spun up, and so this is the same rule the panel
        // greyed times with. It reads the provider's booked sessions on this date
        // and refuses if THIS booking's block overlaps a DIFFERENT one. A session
        // at the same start-time is not an overlap — it is the one session this
        // booking joins or establishes (the seat CAS below handles it) — so those
        // are filtered out by start minute (robust to HH:MM vs HH:MM:SS). If a race
        // slips a new overlap in after this read, the establishing CAS below hits
        // the exclusion constraint and returns the same 409.
        const startMin = minutesOfDay(sessionTime);
        const { data: bookedRows } = await admin.from('slot_sessions')
            .select('session_time, duration_minutes, turnaround_minutes')
            .eq('provider_id', provider.id).eq('session_date', sessionDate).gt('seats_taken', 0);
        const otherBooked = (bookedRows || []).filter((r: any) => minutesOfDay(r.session_time) !== startMin);
        if (overlapsBooked(sessionTime, durationMinutes, turnaround, otherBooked)) {
            return NextResponse.json({ ok: false, error: 'That time just filled up. Pick another.' }, { status: 409 });
        }

        // ---- claim the seat, atomically -----------------------------------
        // Materialise the session row (idempotent on the unique key), then take
        // seats by compare-and-swap. A lost swap means someone else moved it
        // between our read and our write, so re-read and try again; a full
        // session is a clean 409.
        //
        // THE MODE IS PINNED HERE. The booking that fills an EMPTY session (fresh,
        // or reopened by a cancellation) sets whether the time is a private hire
        // or a shared table, and its capacity, in the same CAS. A later booking of
        // the OTHER kind — a private hire on a table people have joined, or a seat
        // on a privately-hired room — is refused (mode-clash). This is what stops
        // a private booking silently taking one seat of a shared table.
        await admin.from('slot_sessions')
            .upsert({ provider_id: provider.id, session_date: sessionDate, session_time: sessionTime, capacity, seats_taken: 0, private: isPrivate },
                { onConflict: 'provider_id,session_date,session_time', ignoreDuplicates: true });

        let claimed = false;
        let modeClash = false;
        for (let attempt = 0; attempt < 5 && !claimed; attempt++) {
            const { data: sess } = await admin.from('slot_sessions')
                .select('id, capacity, seats_taken, private')
                .eq('provider_id', provider.id).eq('session_date', sessionDate).eq('session_time', sessionTime)
                .maybeSingle();
            if (!sess) break;

            const kind = slotClaimKind(sess, isPrivate);
            if (kind === 'mode-clash') { modeClash = true; break; }

            // WHETHER THIS OPTION STILL FITS is the one truth optionAvailability
            // holds — the same function the guest panel greys times with and the
            // host diary reads. Checked here against the row we just read; the CAS
            // below is what makes the take atomic, so a race that slips between
            // this read and the write loses the swap and retries. One source, not
            // a capacity rule re-implemented per surface.
            const avail = optionAvailability(sess, unit, seat);
            if (!avail.possible || quantity > avail.seatsLeft) {
                return NextResponse.json({ ok: false, error: 'That time just filled up. Pick another.' }, { status: 409 });
            }

            if (kind === 'establish') {
                // Empty session: this booking sets the mode, the capacity AND the
                // length it runs — duration_minutes and the frozen turnaround, from
                // which the database computes the block interval this session holds.
                // The CAS is guarded by seats_taken = 0. Of two bookings racing on a
                // fresh (or reopened) time, exactly one wins; the loser retries, now
                // sees the mode it set, and either joins it or clashes.
                //
                // As seats go 0 → quantity this row enters the no-overlap exclusion
                // constraint. If it overlaps a session booked since our courtesy
                // check above (the race the database is the authority on), the
                // UPDATE raises exclusion_violation (23P01): the take fails, nothing
                // is charged, and the guest gets the same "that time just filled up".
                const { data: swapped, error: swapErr } = await admin.from('slot_sessions')
                    .update({ seats_taken: quantity, private: isPrivate, capacity, duration_minutes: durationMinutes, turnaround_minutes: turnaround })
                    .eq('id', sess.id).eq('seats_taken', 0)   // CAS guard: still empty
                    .select('id');
                if (swapErr) {
                    if ((swapErr as any).code === '23P01') {
                        return NextResponse.json({ ok: false, error: 'That time just filled up. Pick another.' }, { status: 409 });
                    }
                    break;   // any other write error: fall through to the generic 409 below
                }
                if (swapped && swapped.length) claimed = true;
                continue;
            }

            // kind === 'join' — same mode, take seats against the pinned capacity.
            const { data: swapped } = await admin.from('slot_sessions')
                .update({ seats_taken: sess.seats_taken + quantity })
                .eq('id', sess.id).eq('seats_taken', sess.seats_taken)   // CAS guard
                .select('id');
            if (swapped && swapped.length) claimed = true;
        }
        if (modeClash) {
            return NextResponse.json(
                {
                    ok: false,
                    error: isPrivate
                        ? 'That time already has others joining — pick another to book it privately.'
                        : 'That time is booked privately — pick another to join a group.',
                },
                { status: 409 }
            );
        }
        if (!claimed) {
            return NextResponse.json({ ok: false, error: 'That time just filled up. Pick another.' }, { status: 409 });
        }

        const { data: sessionRow } = await admin.from('slot_sessions')
            .select('id').eq('provider_id', provider.id).eq('session_date', sessionDate).eq('session_time', sessionTime)
            .maybeSingle();

        // Helper to give the seat back if anything below fails.
        const releaseSeat = async () => {
            if (!sessionRow) return;
            const { data: s } = await admin.from('slot_sessions').select('seats_taken').eq('id', sessionRow.id).maybeSingle();
            if (s) await admin.from('slot_sessions').update({ seats_taken: Math.max(0, s.seats_taken - quantity) }).eq('id', sessionRow.id);
        };

        const unitPrice = Number(item.price);
        const total = orderTotal(unitPrice, quantity);
        const pricing = priceOrder(provider, { bandPrice: total }, []);
        const business = provider.business_name || 'Your experience';
        const itemName = item.name || business;
        const nowIso = new Date().toISOString();

        // A TRAVELLING session freezes the DESTINATION address onto the order —
        // where the provider goes. This is the pick-your-stay path: the guest has
        // a booking with us, so the address is their stay's cottage, composed
        // server-side from the trusted booking -> listing (the same booking whose
        // guest_id we already checked is this user), NEVER from the browser. Only
        // for a travelling ITEM; NULL otherwise. For a 'both' provider that means
        // the booked item's own direction (itemIsTravelling), not the provider's
        // 'both'. A guest with no booking types an address into this same column —
        // scoped separately, not built here.
        let serviceAddress: string | null = null;
        if (itemIsTravelling) {
            if (standalone) {
                // No cottage to travel to — the buyer types where. Required for a
                // travelling session, or the provider has nowhere to go.
                serviceAddress = (body && body.serviceAddress ? String(body.serviceAddress) : '').slice(0, 300).trim() || null;
                if (!serviceAddress) {
                    return NextResponse.json({ ok: false, error: 'Add the address the provider should come to.' }, { status: 400 });
                }
            } else if (booking.listing_id) {
                const { data: stay } = await admin.from('listings')
                    .select('street_address, postcode, location')
                    .eq('id', booking.listing_id).maybeSingle();
                if (stay) {
                    serviceAddress = [stay.street_address, stay.postcode, stay.location].filter(Boolean).join(', ') || null;
                }
            }
        }

        // The contact snapshot the provider needs, frozen at purchase. For a
        // signed-in buyer it comes from their profile — honouring show_full_name,
        // never a surname beyond it. For an anonymous standalone buyer there is no
        // profile yet, so it is the contact they typed; the same snapshot then
        // carries them to the account minted from it at payment. Against a stay the
        // webhook writes this; a standalone slot order is inserted here and paid
        // instantly, so write it here too (no profile_private, no widening of the
        // guest/host privacy view).
        let guestName: string | null = null, guestPhone: string | null = null, guestEmail: string | null = user ? (user.email || null) : null;
        if (anonymous) {
            guestName = typedName || null;
            guestPhone = typedPhone || null;
            guestEmail = typedEmail || null;
        } else if (standalone && user) {
            const { data: prof } = await admin.from('profiles')
                .select('full_name, preferred_name, show_full_name, phone, email').eq('id', user.id).maybeSingle();
            guestName = displayName(prof, '') || null;
            guestPhone = prof ? prof.phone : null;
            guestEmail = (prof && prof.email) || user.email || null;
        }

        // The holding order — created HERE, not in the webhook, because the seat
        // is already taken and the hold must exist to be swept if unpaid.
        const { data: order, error: orderErr } = await admin.from('service_orders')
            .insert({
                provider_id: provider.id,
                // Null for an anonymous standalone booker — the account is minted
                // from the snapshot below once payment confirms (webhook), and the
                // guest_present_once_paid CHECK permits null only while 'holding'.
                guest_id: user ? user.id : null,
                listing_id: standalone ? null : (booking.listing_id || null),
                booking_id: standalone ? null : booking.id,
                // The buyer's contact, for the provider — written here for a
                // standalone order (the webhook writes it for the against-a-stay one).
                guest_name: standalone ? guestName : undefined,
                guest_phone: standalone ? guestPhone : undefined,
                guest_email: standalone ? guestEmail : undefined,
                trade: provider.trade || null,
                shape: 'slot',
                slot_session_id: sessionRow ? sessionRow.id : null,
                service_date: sessionDate,
                service_time: sessionTime,
                // Freeze the treatment length at purchase, beside item_name/price:
                // what the guest bought and the provider is turning up for must not
                // change if the menu's duration is edited later.
                duration_minutes: durationMinutes,
                // Freeze the fulfilment DIRECTION beside the duration: what a guest
                // booked (come-to-me vs the provider travelling) must not flip if
                // the provider later switches their setup. For a 'both' provider
                // this is the booked ITEM's direction, not the provider's 'both' —
                // an order is at one place. The order page reads this, never the
                // provider's live value.
                fulfilment: bookedFulfilment,
                // The frozen destination for a travelling session (see above).
                service_address: serviceAddress,
                guests: standalone ? (attendees ?? quantity ?? null) : (booking.guests ?? null),
                attendees,
                quantity,
                unit_price: unitPrice,
                item_unit: unit,
                price: total,
                commission_rate: pricing.commissionRate,
                status: 'holding',
                item_id: item.id,
                item_name: itemName,
                item_description: item.description || '',
                provider_business_name: business,
                note: note || null,
                allergy: allergy || null,
                expires_at: new Date(Date.now() + SLOT_HOLD_MINUTES * 60 * 1000).toISOString(),
                created_at: nowIso,
            })
            .select('id')
            .single();

        if (orderErr || !order) {
            await releaseSeat();
            return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
        }

        try {
            const lineName = quantity > 1 ? itemName + ' × ' + quantity : itemName;
            const checkout = await stripeRequest('POST', '/checkout/sessions', {
                mode: 'payment',
                // Prefill the payer email with the one on file (signed in) or the
                // one just typed (anonymous). The address Stripe actually verifies
                // is what the webhook keys the account on, not this prefill.
                customer_email: user ? user.email : (guestEmail || undefined),
                payment_method_types: ['card'],
                line_items: [{
                    quantity: 1,
                    price_data: {
                        currency: 'gbp',
                        unit_amount: pricing.amountPence,
                        product_data: {
                            name: lineName + ' · ' + sessionDate + ' ' + sessionTime,
                            description: 'Booked with ' + business
                                + '. Galloway Getaways takes the payment on their behalf and is not the provider.',
                        },
                    },
                }],
                // Instant: captured on payment, not held. The slot IS the confirmation.
                payment_intent_data: {
                    on_behalf_of: provider.stripe_account_id,
                    application_fee_amount: pricing.applicationFeePence,
                    transfer_data: { destination: provider.stripe_account_id },
                    description: 'Galloway experience — ' + business + ' · ' + itemName,
                    metadata: { kind: 'slot_order', order_id: order.id, provider_id: provider.id, booking_id: standalone ? '' : booking.id },
                },
                // Land on the booking itself — a real confirmation with what
                // happens next and an add-to-calendar — not a banner on /trips.
                success_url: SITE_URL + '/experiences/order/' + order.id + '?booked=1',
                cancel_url: SITE_URL + '/trips?experience=cancelled',
                // Give up on the Checkout at the hold's edge, so an abandoned one
                // stops being payable at the same moment the seat is released.
                expires_at: Math.floor(Date.now() / 1000) + SLOT_HOLD_MINUTES * 60,
                metadata: { kind: 'slot_order', order_id: order.id, provider_id: provider.id, booking_id: standalone ? '' : booking.id, guest_id: user ? user.id : '' },
            });

            return NextResponse.json({ ok: true, url: checkout.url });
        } catch (err: any) {
            // Checkout never started — undo the hold and the seat.
            await admin.from('service_orders').update({ status: 'expired' }).eq('id', order.id);
            await releaseSeat();
            console.error('[services/slots/book]', err && err.message);
            return NextResponse.json({ ok: false, error: 'Could not start that. Try again.' }, { status: 500 });
        }
    } catch (err: any) {
        console.error('[services/slots/book]', err && err.message);
        return NextResponse.json({ ok: false, error: (err && err.message) || 'Could not start that' }, { status: 500 });
    }
}
