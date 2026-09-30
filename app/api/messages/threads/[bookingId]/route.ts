import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { checkListing } from '@/lib/access';
import { contactNumberVisible } from '@/lib/stayWindow';
import { firstName, getImageUrl, formatTime } from '@/lib/utils';
import { groupLabel, cancellationWords } from '@/lib/bookingDisplay';
import { cancellationPosition } from '@/lib/cancellationView';
import { ukDate, ukWeekday, daysBetweenKeys } from '@/lib/dayKey';
import { stayCountdown, arrivalSecretsWindowOpen } from '@/lib/bookingWindows';
import { bookingReleasesPrivateData } from '@/lib/bookingEntitlement';
import { rateFor, netOfFee } from '@/lib/fees';
import { formatGBP } from '@/lib/formatMoney';
import { publicArea } from '@/lib/places';

export const dynamic = 'force-dynamic';

// One call for everything the two right-hand panes need: the conversation,
// who it's with, and the booking behind it.
//
// Done here rather than in the browser because a co-host is neither party on
// these rows, and because what a companion may see has to be decided
// server-side — see the money fields below.
export async function GET(
    req: NextRequest,
    { params }: { params: { bookingId: string } }
) {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession() — getSession() trusts an unsigned
    // cookie, so a forged one impersonates any user. getUser() verifies
    // the token against the auth server. Matches the admin/services routes.
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
    }

    const uid = user.id;
    const bookingId = params.bookingId;

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const { data: booking } = await admin
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .maybeSingle();

    if (!booking) {
        return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }

    const isGuest = booking.guest_id === uid;
    const isHost = booking.host_id === uid;

    let isCompanion = false;
    let isCoHost = false;

    if (!isGuest && !isHost) {
        const { data: companion } = await admin
            .from('booking_guests')
            .select('id')
            .eq('booking_id', bookingId)
            .eq('user_id', uid)
            .eq('status', 'active')
            .maybeSingle();

        isCompanion = !!companion;

        if (!isCompanion) {
            const access = await checkListing(uid, booking.listing_id, 'can_messages');
            isCoHost = !!access;
        }
    }

    if (!isGuest && !isHost && !isCompanion && !isCoHost) {
        return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });
    }

    const { data: listing } = await admin
        .from('listings')
        .select('id, host_id, title, location, images, check_in_time, check_in_end_time, check_out_time, check_in_method, cancellation_policy, commission_rate, max_guests, amenities')
        .eq('id', booking.listing_id)
        .maybeSingle();

    // The person on the other side of the conversation. For anyone on the
    // host's side that's the guest; for the guest it's the host.
    const otherId = isGuest ? booking.host_id : booking.guest_id;

    const { data: otherProfile } = await admin
        .from('profile_private')
        .select('id, full_name, preferred_name, show_full_name, phone, avatar_url')
        .eq('id', otherId)
        .maybeSingle();

    const { data: messages } = await admin
        .from('messages')
        .select('id, sender_id, body, created_at, read_at')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: true });

    // Money is for the two people whose money it is. A companion was added to
    // a trip; they were not shown the price and must not be here either.
    const showMoney = isGuest || isHost || isCoHost;

    // Being one of the two people on a booking is not on its own a reason to
    // be handed the other one's phone number: the same rule the reservation
    // card and the booking screen use applies here, and it did not before, so
    // this panel was still showing a guest's number on a stay that had been
    // cancelled months ago. The number is not sent at all when it is not to be
    // shown — a value that reaches the browser has been given out, whatever
    // the screen does with it afterwards.
    const phoneOnFile = (otherProfile && otherProfile.phone) || null;
    const phoneAllowed = isGuest || isHost || isCoHost;
    const phoneNow =
        phoneAllowed && contactNumberVisible(booking, listing && listing.check_out_time);

    // Said rather than left blank, so a host looking for a number knows it is
    // coming rather than assuming the guest never gave one.
    const phoneHeld = phoneAllowed && phoneOnFile && !phoneNow
        ? (booking.status === 'cancelled' || booking.status === 'declined'
            ? 'closed'
            : 'early')
        : null;

    // The reservation-pane header, in the SAME shape the experience threads use
    // (ReservationHeader): a stay and an experience read as one product. The host
    // side sees the guest large with the listing photo tucked into the corner and
    // "Isla's group of 2"; the guest/companion side sees the listing large with
    // its initial, mirroring how a guest sees the business on an experience thread.
    const onHostSide = isHost || isCoHost;

    // The two people the card names, from their PUBLIC profiles — FIRST name only
    // (never displayName: the display-names guard keeps this route clear of it, so
    // a counterparty is never shown a surname). The guest is who the party is
    // about; the owner is who hosts it.
    const [{ data: guestPublic }, { data: ownerPublic }] = await Promise.all([
        admin.from('profiles').select('full_name, preferred_name, show_full_name, avatar_url').eq('id', booking.guest_id).maybeSingle(),
        listing && listing.host_id
            ? admin.from('profiles').select('full_name, preferred_name, show_full_name, avatar_url').eq('id', listing.host_id).maybeSingle()
            : Promise.resolve({ data: null }),
    ]);
    const guestFirst = firstName(guestPublic, 'Guest');
    const guestAvatar = guestPublic && guestPublic.avatar_url ? getImageUrl(String(guestPublic.avatar_url)) : null;
    // A real first name where the host has one; a plain fallback otherwise (never
    // "your", which is what splitting "your host" on the space would leave).
    const ownerFirst = firstName(ownerPublic, '') || 'your host';
    const ownerAvatar = ownerPublic && ownerPublic.avatar_url ? getImageUrl(String(ownerPublic.avatar_url)) : null;
    const listingPhoto = listing && Array.isArray(listing.images) && listing.images[0]
        ? getImageUrl(String(listing.images[0])) : null;
    const listingTitle = (listing && listing.title) || 'your stay';
    const area = listing && listing.location ? publicArea(listing.location) : null;

    // The header, viewer-aware, keeping the avatar+listing-photo pairing on both
    // sides: the host sees the guest large and "Isla's group of 2"; the guest sees
    // their host large and the listing name.
    const header = onHostSide
        ? { avatarUrl: guestAvatar, initial: (guestFirst || 'G').slice(0, 1).toUpperCase(), photoUrl: listingPhoto, heading: groupLabel(guestFirst, booking.guests), personFirst: guestFirst }
        : { avatarUrl: ownerAvatar, initial: (ownerFirst || 'H').slice(0, 1).toUpperCase(), photoUrl: listingPhoto, heading: listingTitle, personFirst: ownerFirst };

    // Dates, always DD/MM/YYYY from the day key (never toISOString, which slips a
    // day under BST). Nights from part arithmetic on the keys.
    const ciKey = String(booking.check_in).slice(0, 10);
    const coKey = String(booking.check_out).slice(0, 10);
    const nights = Math.max(1, daysBetweenKeys(ciKey, coKey));
    const dateRange = ukDate(ciKey) + ' – ' + ukDate(coKey);
    const ciTime = listing && formatTime(listing.check_in_time);
    const ciEnd = listing && formatTime(listing.check_in_end_time);
    const coTime = listing && formatTime(listing.check_out_time);

    // Arrival secrets — a server-side wall: pulled ONLY when the existing rules
    // allow them, so a viewer who may not see them never has the value sent. The
    // host (or a co-host holding the listing permission) always may; the guest may
    // only on a paid, confirmed stay (an unpaid row costs nothing to create) and
    // only inside the arrival window — the same two gates the arrival page draws.
    const hostSecrets = isHost || (isCoHost && !!(await checkListing(uid, booking.listing_id, 'can_listing')));
    const guestSecrets = isGuest && bookingReleasesPrivateData(booking)
        && arrivalSecretsWindowOpen({ check_in: booking.check_in, check_out: booking.check_out }, new Date());
    let arrival: { doorCode: string | null; wifiName: string | null; wifiPassword: string | null } | null = null;
    if (hostSecrets || guestSecrets) {
        const [{ data: arr }, { data: code }, { data: override }] = await Promise.all([
            admin.from('listing_arrival').select('wifi_name, wifi_password').eq('listing_id', booking.listing_id).maybeSingle(),
            admin.from('listing_access_codes').select('code').eq('listing_id', booking.listing_id).maybeSingle(),
            admin.from('booking_access_codes').select('code').eq('booking_id', booking.id).maybeSingle(),
        ]);
        arrival = {
            doorCode: (override && override.code) || (code && code.code) || null,
            wifiName: (arr && arr.wifi_name) || null,
            wifiPassword: (arr && arr.wifi_password) || null,
        };
    }

    // The guest party as rows: the lead guest, then "+1 adult / +1 child / +1 pet".
    const adults = Number(booking.adults || 0) || Math.max(1, Number(booking.guests || 1) - Number(booking.children || 0));
    const kids = Number(booking.children || 0);
    const pets = Number(booking.pets || 0);
    const extras: string[] = [];
    if (adults - 1 > 0) extras.push('+' + (adults - 1) + ((adults - 1) === 1 ? ' adult' : ' adults'));
    if (kids > 0) extras.push('+' + kids + (kids === 1 ? ' child' : ' children'));
    if (pets > 0) extras.push('+' + pets + (pets === 1 ? ' pet' : ' pets'));

    // Cancellation: the tier name, and the free-until date only while it is free.
    const cw = cancellationWords(listing && listing.cancellation_policy);
    const pos = cancellationPosition({ checkIn: ciKey, policy: (listing && listing.cancellation_policy) || null });
    const freeUntil = pos.kind === 'free' && pos.freeUntilKey ? ukDate(pos.freeUntilKey) : null;

    // Money, viewer-aware and computed server-side. Host: what the guest paid, our
    // commission and their take. Guest: what they paid. Companion: nothing (they
    // were never shown the price). Rates and figures match the host booking page.
    // Same figures and units as the host booking page: `rate` is a PERCENT (the
    // booking's stamped rate, else the listing's standard one), and the fee is
    // taken with netOfFee so base + fee reconcile to the take exactly.
    const total = Number(booking.total_price || 0);
    const paid = Number(booking.amount_paid || 0);
    const refunded = Number(booking.amount_refunded || 0);
    const netPaid = Math.round((paid - refunded) * 100) / 100;
    const rate = (booking.commission_rate !== null && booking.commission_rate !== undefined)
        ? Number(booking.commission_rate) : rateFor(listing);
    const grossDue = Math.round((total - refunded) * 100) / 100;
    const youGetBase = grossDue > 0 ? grossDue : 0;
    const youGet = netOfFee(youGetBase, rate);
    const fee = Math.round((youGetBase - youGet) * 100) / 100;
    let money: any = null;
    if (onHostSide) {
        money = {
            showMoney: true, caption: 'Money', total: formatGBP(youGet), nightsLabel: 'Your take',
            description: 'What the guest paid, our fee, and what reaches you.',
            rows: [
                { label: 'Guest paid', value: formatGBP(youGetBase) },
                { label: 'Our fee (' + rate + '%)', value: '-' + formatGBP(fee), muted: true },
                { label: 'You get', value: formatGBP(youGet) },
            ],
            working: 'Guest paid ' + formatGBP(youGetBase) + ' − our ' + rate + '% fee ' + formatGBP(fee) + ' = ' + formatGBP(youGet) + '.',
        };
    } else if (isGuest) {
        money = {
            showMoney: true, caption: 'Money', total: formatGBP(netPaid), nightsLabel: 'What you paid',
            description: 'What you paid for this booking.',
            rows: [
                { label: 'You paid', value: formatGBP(netPaid) },
                ...(refunded > 0 ? [{ label: 'Refunded', value: '-' + formatGBP(refunded), muted: true }] : []),
            ],
        };
    }

    const reservation = {
        avatarUrl: header.avatarUrl,
        initial: header.initial,
        photoUrl: header.photoUrl,
        heading: header.heading,
        // Dates + nights, then the listing name (host) or the area (guest, whose
        // heading is already the listing name).
        whenLabel: dateRange + ' · ' + nights + (nights === 1 ? ' night' : ' nights'),
        itemName: onHostSide ? listingTitle : (area || ''),
        status: null,
        when: { heading: 'When', value: dateRange },
        where: null,
        note: null,
        allergy: null,
        money,
        moneyNote: null,
        phone: null,
        messageHref: null,
        personFirst: header.personFirst,
        guests: null,
        cancellation: null,
        manage: null,
        guestManage: null,
        // Stay cards.
        stay: {
            checkIn: {
                heading: 'Check-in', weekday: ukWeekday(ciKey), dateLabel: ukDate(ciKey),
                timeLabel: ciTime ? ('From ' + ciTime + (ciEnd ? '–' + ciEnd : '')) : null,
            },
            checkOut: {
                heading: 'Check-out', weekday: ukWeekday(coKey), dateLabel: ukDate(coKey),
                timeLabel: coTime ? ('By ' + coTime) : null,
            },
            arrival,
        },
        guestsList: {
            lead: { name: guestFirst, avatarUrl: guestAvatar, initial: (guestFirst || 'G').slice(0, 1).toUpperCase() },
            extras,
        },
        hostedBy: {
            label: 'Hosted by', name: ownerFirst, sub: area,
            avatarUrl: ownerAvatar, initial: (ownerFirst || 'H').slice(0, 1).toUpperCase(),
            isViewer: isHost,
        },
        stayCancellation: { tier: cw.tier, summary: cw.summary, freeUntil },
        booked: ukDate(String(booking.created_at).slice(0, 10)),
        reference: String(booking.id).slice(0, 8),
        viewListingHref: listing ? '/homes/' + listing.id : null,
    };

    return NextResponse.json({
        ok: true,
        role: isGuest ? 'guest' : isHost ? 'host' : isCoHost ? 'co_host' : 'companion',
        header,
        reservation,
        canSeePhone: phoneAllowed,
        other: {
            id: otherId,
            name: firstName(otherProfile, isGuest ? 'Host' : 'Guest'),
            phone: phoneNow ? phoneOnFile : null,
            // 'early' — there is a number, but it is not close enough to
            // arrival. 'closed' — the booking is cancelled or was declined.
            phoneHeld: phoneHeld,
            avatar: (otherProfile && otherProfile.avatar_url) || null,
        },
        // commission_rate is read above for the host's money rows; it is the
        // platform's number, not the guest's, so it does not leave the server.
        listing: listing ? (({ commission_rate, ...rest }: any) => rest)(listing) : null,
        booking: {
            id: booking.id,
            check_in: booking.check_in,
            check_out: booking.check_out,
            guests: booking.guests,
            adults: booking.adults,
            children: booking.children,
            pets: booking.pets,
            status: booking.status,
            created_at: booking.created_at,
            // free_cancel_until is no longer sent: the pane computes the
            // cancellation position live from check_in + the listing's policy.
            cancellation_policy: listing && listing.cancellation_policy,
            total_price: showMoney ? booking.total_price : null,
            amount_paid: showMoney ? booking.amount_paid : null,
            // Fed to the Manage-reservation flows: the refund figure the host's
            // Send-money sheet and either side's Cancel confirm compute from
            // net paid. Money, so withheld from a companion the same as the rest.
            amount_refunded: showMoney ? booking.amount_refunded : null,
            cleaning_fee: showMoney ? booking.cleaning_fee : null,
            balance_amount: showMoney ? booking.balance_amount : null,
            balance_due_date: showMoney ? booking.balance_due_date : null,
            payment_status: showMoney ? booking.payment_status : null,
        },
        messages: messages || [],
    });
}
