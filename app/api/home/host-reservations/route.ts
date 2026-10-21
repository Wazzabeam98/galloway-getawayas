import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { DEFAULT_COMMISSION_PERCENT, rateFor, netOfFee } from '@/lib/fees';
import { formatGBP } from '@/lib/formatMoney';
import { londonDayKey } from '@/lib/dayKey';
import { getImageUrl, firstName } from '@/lib/utils';
import { formatUk } from '@/lib/cancellation';
import { accessibleListings } from '@/lib/access';
import { contactNumberVisible } from '@/lib/stayWindow';

export const dynamic = 'force-dynamic';

const NOSTORE = { headers: { 'Cache-Control': 'private, no-store' } } as const;

// The host-mode counterpart to /api/home/upcoming-trip: the next arrivals for
// someone who has switched to hosting, for the home page's HostReservationsClient.
// Fetched on the client so the edge-cached HTML carries no host's takings,
// guest names or phone numbers. Every money figure, the earnings/phone
// permission gates and the contact-number window are decided here on the
// server — the browser only lays the result out. Mirrors
// components/HostReservations.tsx. Per-viewer, never cached.
//
// `mode` tells the client what the viewer's work side resolves to; the client
// asks /api/nav for that and only mounts this when mode === 'host', but the
// shape stays the same whether or not there are arrivals.
export async function GET() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ reservations: [], fallbackToTrip: false }, NOSTORE);

        const access = await accessibleListings(user.id);
        const allowed = access.filter((a) => a.can_bookings).map((a) => a.listingId);
        const earningsAllowed = access.filter((a) => a.can_earnings).map((a) => a.listingId);
        // Accepting/declining is never delegated — /api/stripe/refund answers 403
        // to anyone who is not the host_id, so a co-host is shown no answer button.
        const ownedIds = access.filter((a) => a.isOwner).map((a) => a.listingId);

        // The mode cookie outlives the listings that justified it — someone who
        // removed their last property gets the guest card back instead.
        if (allowed.length === 0) {
            return NextResponse.json({ reservations: [], fallbackToTrip: true }, NOSTORE);
        }

        const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            { auth: { persistSession: false } },
        );

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayKey = londonDayKey();

        const { data: bookings } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, check_in, check_out, status, payment_status, guests, total_price, commission_rate, amount_paid, amount_refunded, balance_due_date')
            .in('listing_id', allowed)
            .in('status', ['confirmed', 'pending'])
            .gte('check_in', todayKey)
            .order('check_in', { ascending: true })
            .limit(4);

        if (!bookings || bookings.length === 0) {
            return NextResponse.json({ reservations: [], fallbackToTrip: false }, NOSTORE);
        }

        const listingIds = Array.from(new Set(bookings.map((b) => b.listing_id)));
        const guestIds = Array.from(new Set(bookings.map((b) => b.guest_id)));

        const { data: listings } = await admin
            .from('listings')
            .select('id, title, location, images, commission_rate')
            .in('id', listingIds);

        const { data: guests } = guestIds.length
            ? await admin
                .from('profile_private')
                .select('id, full_name, first_name, last_name, preferred_name, show_full_name, phone')
                .in('id', guestIds)
            : { data: [] };

        const listingMap: Record<string, { title: string; location: string | null; image: string | null; rate: number }> = {};
        (listings || []).forEach((l) => {
            listingMap[l.id] = {
                title: l.title,
                location: l.location,
                image: l.images && l.images.length > 0 ? getImageUrl(l.images[0]) : null,
                rate: rateFor(l),
            };
        });

        const guestNameMap: Record<string, string> = {};
        const guestPhoneMap: Record<string, string | null> = {};
        (guests || []).forEach((g) => {
            guestNameMap[g.id] = firstName(g, 'Guest');
            guestPhoneMap[g.id] = g.phone || null;
        });

        const { data: unreadRows } = await admin
            .from('messages')
            .select('booking_id')
            .in('booking_id', bookings.map((b) => b.id))
            .eq('recipient_id', user.id)
            .is('read_at', null);

        const unreadMap: Record<string, number> = {};
        (unreadRows || []).forEach((m: any) => {
            unreadMap[m.booking_id] = (unreadMap[m.booking_id] || 0) + 1;
        });

        const reservations = bookings
            .map((booking) => {
                const listing = listingMap[booking.listing_id];
                if (!listing) return null;

                const checkIn = new Date(booking.check_in);
                checkIn.setHours(0, 0, 0, 0);
                const checkOut = new Date(booking.check_out);
                checkOut.setHours(0, 0, 0, 0);

                const days = Math.round((checkIn.getTime() - today.getTime()) / 86400000);
                const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000);

                const headline = days === 0 ? 'Arriving today' : days === 1 ? 'Arriving tomorrow' : days + ' days to go';
                const arrivalShort = checkIn.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

                const guestName = guestNameMap[booking.guest_id] || 'Guest';

                // The rate stamped on the booking wins, so a stay is always netted
                // at the rate that applied when it was taken. Same order the
                // earnings page uses, so the two agree.
                const rate = booking.commission_rate !== null && booking.commission_rate !== undefined
                    ? Number(booking.commission_rate)
                    : listing.rate ?? DEFAULT_COMMISSION_PERCENT;

                const refunded = Number(booking.amount_refunded || 0);
                const grossDue = Math.round((Number(booking.total_price || 0) - refunded) * 100) / 100;
                const earns = netOfFee(grossDue > 0 ? grossDue : 0, rate);

                const paysOn = new Date(booking.check_in);
                paysOn.setHours(0, 0, 0, 0);
                paysOn.setDate(paysOn.getDate() + 1);

                const stillOwed = Math.round((Number(booking.total_price || 0) - Number(booking.amount_paid || 0)) * 100) / 100;
                const balanceDue = booking.balance_due_date ? new Date(booking.balance_due_date) : null;
                if (balanceDue) balanceDue.setHours(0, 0, 0, 0);
                const balanceLate = stillOwed > 0 && !!balanceDue && balanceDue.getTime() < today.getTime();

                const showMoney = earningsAllowed.indexOf(booking.listing_id) !== -1;
                const canAnswer = ownedIds.indexOf(booking.listing_id) !== -1;

                // Close enough to arrival that a host may need to ring them. Same
                // rule as the booking screen and messages panel (lib/stayWindow).
                const phone = contactNumberVisible(booking) ? guestPhoneMap[booking.guest_id] : null;

                return {
                    id: booking.id,
                    status: booking.status,
                    title: listing.title,
                    location: listing.location,
                    image: listing.image,
                    headline,
                    arrivalShort,
                    days,
                    nights,
                    guests: booking.guests,
                    guestName,
                    checkInUk: formatUk(checkIn),
                    checkOutUk: formatUk(checkOut),
                    showMoney,
                    canAnswer,
                    earns: formatGBP(earns),
                    grossDue: formatGBP(grossDue),
                    feeAmount: formatGBP(Math.round((grossDue - earns) * 100) / 100),
                    rate,
                    paysOnUk: formatUk(paysOn),
                    stillOwed,
                    stillOwedGBP: formatGBP(stillOwed),
                    balanceLate,
                    balanceDueUk: balanceDue ? formatUk(balanceDue) : null,
                    unread: unreadMap[booking.id] || 0,
                    phone,
                    // Raw money for BookingActions (its own server routes re-check
                    // everything; these only size its confirm copy).
                    totalPrice: Number(booking.total_price || 0),
                    amountPaid: Number(booking.amount_paid || 0),
                    amountRefunded: Number(booking.amount_refunded || 0),
                };
            })
            .filter(Boolean);

        return NextResponse.json({ reservations, fallbackToTrip: false }, NOSTORE);
    } catch (err: any) {
        console.error('[home/host-reservations]', err && err.message);
        return NextResponse.json({ reservations: [], fallbackToTrip: false }, NOSTORE);
    }
}
