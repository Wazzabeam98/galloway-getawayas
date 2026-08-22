export const dynamic = "force-dynamic";

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import BookingsView from "@/components/BookingsView";
import { displayName } from "@/lib/utils";
import { createClient } from "@supabase/supabase-js";
import { accessibleListings } from "@/lib/access";

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

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const { data: bookings } = allowed.length
        ? await admin
            .from("bookings")
            .select("*")
            .in("listing_id", allowed)
            .order("check_in", { ascending: true })
        : { data: [] };

    const listingIds = Array.from(new Set((bookings || []).map((b) => b.listing_id)));
    const guestIds = Array.from(new Set((bookings || []).map((b) => b.guest_id)));

    const { data: listings } = listingIds.length
        ? await admin.from("listings").select("id, title, images, commission_rate, check_out_time").in("id", listingIds)
        : { data: [] };

    const { data: guests } = guestIds.length
        ? await admin.from("profiles").select("id, full_name, preferred_name, show_full_name, email").in("id", guestIds)
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
            commission_rate: l.commission_rate,
            // Decides when a stay stops being upcoming, so the split lands on
            // the guest actually leaving rather than on midnight.
            check_out_time: l.check_out_time,
        };
    });

    const guestNameMap: Record<string, string> = {};
    (guests || []).forEach((g) => {
        guestNameMap[g.id] = displayName(g, "Guest");
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
                bookings={bookings || []}
                listingMap={listingMap}
                guestNameMap={guestNameMap}
                reviewedBookingIds={reviewedBookingIds}
                ownedListingIds={ownedIds}
            />
        </div>
    );
}
