export const dynamic = "force-dynamic";

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import BookingsView from "@/components/BookingsView";

export default async function BookingsPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: user } = await supabase.auth.getUser();

    const { data: bookings } = await supabase
        .from("bookings")
        .select("*")
        .eq("host_id", user.user?.id)
        .order("check_in", { ascending: true });

    const listingIds = Array.from(new Set((bookings || []).map((b) => b.listing_id)));
    const guestIds = Array.from(new Set((bookings || []).map((b) => b.guest_id)));

    const { data: listings } = listingIds.length
        ? await supabase.from("listings").select("id, title, images").in("id", listingIds)
        : { data: [] };

    const { data: guests } = guestIds.length
        ? await supabase.from("profiles").select("id, full_name, preferred_name, email").in("id", guestIds)
        : { data: [] };

    // Build plain objects (not Maps) since only serializable data can cross
    // from a Server Component into a Client Component.
    const listingMap: Record<string, { title: string; images: string[] | null }> = {};
    (listings || []).forEach((l) => {
        listingMap[l.id] = { title: l.title, images: l.images };
    });

    const guestNameMap: Record<string, string> = {};
    (guests || []).forEach((g) => {
        guestNameMap[g.id] = g.preferred_name || g.full_name || g.email || "Guest";
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
            />
        </div>
    );
}
