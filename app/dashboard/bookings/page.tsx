export const dynamic = "force-dynamic";

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import BookingsView from "@/components/BookingsView";
import { firstName } from "@/lib/utils";
import { createClient } from "@supabase/supabase-js";
import { accessibleListings } from "@/lib/access";
import { accessibleHotels } from "@/lib/hotelAccess";
import { hotelsOpen } from "@/lib/hotels";

export default async function BookingsPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: user } = await supabase.auth.getUser();

    // Bookings on properties they own, plus any they co-host with permission
    // to handle bookings. Read with the service key because a co-host is not
    // the host_id on these rows, so row-level security would hide them.
    const access = await accessibleListings(user.user?.id || '');
    const allowed = access.filter((a) => a.can_bookings).map((a) => a.listingId);

    // Accepting, declining, cancelling and refunding are never delegated —
    // the routes behind them answer 403 to anyone who is not the host_id. A
    // co-host may see these bookings and message about them; the buttons that
    // would fail are left off.
    const ownedIds = access.filter((a) => a.isOwner).map((a) => a.listingId);

    // Money is its own permission. A co-host who handles bookings but not
    // earnings never has the figures sent — stripped here, on the server, not
    // hidden in the browser, because anything handed to a client component is
    // readable in the page whether or not it is drawn.
    const earningIds = new Set(access.filter((a) => a.isOwner || a.can_earnings).map((a) => a.listingId));

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const uid = user.user?.id || '';
    const BOOKING_COLS =
        // Named, not '*': the payout transfer, the Stripe ids and the
        // platform's own figures are nobody's business on this screen.
        "id, listing_id, room_type_id, guest_id, host_id, check_in, check_out, guests, status, payment_status, total_price, amount_paid, amount_refunded, commission_rate, created_at";

    const { data: listingBookings } = allowed.length
        ? await admin
            .from("bookings")
            .select(BOOKING_COLS)
            .in("listing_id", allowed)
            .order("check_in", { ascending: true })
        : { data: [] };

    // Hotel bookings for this person — the hotels they own or co-host with
    // booking permission. A hotel stay is a normal bookings row (room_type_id
    // set, listing_id NULL), so it shares this whole screen; only its name and
    // photo come from the room type and its hotel, below. Behind the flag.
    const hotelsLive = hotelsOpen();
    const hotelAccess = hotelsLive ? await accessibleHotels(uid) : [];
    const allowedHotelIds = hotelAccess.filter((a) => a.can_bookings).map((a) => a.hotelId);
    const ownedHotelIds = new Set(hotelAccess.filter((a) => a.isOwner).map((a) => a.hotelId));
    const earningHotelIds = new Set(hotelAccess.filter((a) => a.isOwner || a.can_earnings).map((a) => a.hotelId));

    const { data: roomTypes } = allowedHotelIds.length
        ? await admin.from("hotel_room_types").select("id, hotel_id, name").in("hotel_id", allowedHotelIds)
        : { data: [] };
    const roomTypeIds = (roomTypes || []).map((r: any) => r.id);
    const ownedRoomTypeIds = (roomTypes || []).filter((r: any) => ownedHotelIds.has(r.hotel_id)).map((r: any) => r.id);
    const earningRoomTypeIds = new Set((roomTypes || []).filter((r: any) => earningHotelIds.has(r.hotel_id)).map((r: any) => r.id));

    const { data: hotelBookings } = roomTypeIds.length
        ? await admin
            .from("bookings")
            .select(BOOKING_COLS)
            .in("room_type_id", roomTypeIds)
            .order("check_in", { ascending: true })
        : { data: [] };

    const bookings = [...(listingBookings || []), ...(hotelBookings || [])]
        .sort((a: any, b: any) => (a.check_in < b.check_in ? -1 : a.check_in > b.check_in ? 1 : 0));

    const listingIds = Array.from(new Set((bookings || []).map((b) => b.listing_id).filter(Boolean)));
    const guestIds = Array.from(new Set((bookings || []).map((b) => b.guest_id)));

    const { data: listings } = listingIds.length
        ? await admin.from("listings").select("id, title, images, commission_rate, check_out_time").in("id", listingIds)
        : { data: [] };

    const { data: guests } = guestIds.length
        ? await admin.from("profiles").select("id, full_name, first_name, last_name, preferred_name, show_full_name").in("id", guestIds)
        : { data: [] };

    // Build plain objects (not Maps) since only serializable data can cross
    // from a Server Component into a Client Component.
    const listingMap: Record<
        string,
        {
            title: string;
            images: string[] | null;
            commission_rate: number | null;
            check_out_time: string | null;
        }
    > = {};
    (listings || []).forEach((l) => {
        listingMap[l.id] = {
            title: l.title,
            images: l.images,
            commission_rate: earningIds.has(l.id) ? l.commission_rate : null,
            // Decides when a stay stops being upcoming, so the split lands on
            // the guest actually leaving rather than on midnight.
            check_out_time: l.check_out_time,
        };
    });

    // Hotel bookings resolve their card from the room type and its hotel — the
    // same ListingInfo shape, keyed by room_type_id (which is what the view
    // looks a listing-less booking up by). "Hotel name — Room type" as the
    // title, the hotel's photos, and the frozen commission off the booking.
    const bookedRoomTypeIds = Array.from(new Set((hotelBookings || []).map((b: any) => b.room_type_id).filter(Boolean)));
    if (bookedRoomTypeIds.length) {
        const rtById: Record<string, any> = {};
        (roomTypes || []).forEach((r: any) => { rtById[r.id] = r; });
        const bookedHotelIds = Array.from(new Set(bookedRoomTypeIds.map((id) => rtById[id]?.hotel_id).filter(Boolean)));
        const { data: hotelRows } = bookedHotelIds.length
            ? await admin.from("hotels").select("id, name, images, commission_rate").in("id", bookedHotelIds)
            : { data: [] };
        const hotelById: Record<string, any> = {};
        (hotelRows || []).forEach((h: any) => { hotelById[h.id] = h; });
        bookedRoomTypeIds.forEach((rtId) => {
            const rt = rtById[rtId];
            const hotel = rt ? hotelById[rt.hotel_id] : null;
            listingMap[rtId] = {
                title: hotel ? `${hotel.name} — ${rt.name}` : (rt?.name || 'Room'),
                images: hotel?.images || null,
                commission_rate: earningRoomTypeIds.has(rtId) ? (hotel?.commission_rate ?? null) : null,
                // Hotels have no per-listing checkout time; the day's end does.
                check_out_time: null,
            };
        });
    }

    const guestNameMap: Record<string, string> = {};
    (guests || []).forEach((g) => {
        guestNameMap[g.id] = firstName(g, "Guest");
    });

    const { data: myGuestReviews } = await supabase
        .from("reviews")
        .select("booking_id")
        .eq("reviewer_id", user.user?.id)
        .eq("review_type", "host_to_guest");
    const reviewedBookingIds = (myGuestReviews || []).map((r) => r.booking_id);

    return (
        <div className="max-w-4xl mx-auto px-6 py-10">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-8">Bookings</h1>
            <BookingsView
                bookings={(bookings || []).map((b: any) => {
                    const maySeeMoney = b.listing_id ? earningIds.has(b.listing_id) : earningRoomTypeIds.has(b.room_type_id);
                    return maySeeMoney ? b : {
                        ...b, total_price: null, amount_paid: null, amount_refunded: null, commission_rate: null,
                    };
                })}
                listingMap={listingMap}
                guestNameMap={guestNameMap}
                reviewedBookingIds={reviewedBookingIds}
                ownedListingIds={[...ownedIds, ...ownedRoomTypeIds]}
            />
        </div>
    );
}
