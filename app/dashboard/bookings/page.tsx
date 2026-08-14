export const dynamic = "force-dynamic";

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { getImageUrl, capitializeFirst } from "@/lib/utils";
import BookingActions from "@/components/BookingActions";
import Link from "next/link";

export default async function BookingsPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: user } = await supabase.auth.getUser();

    const { data: bookings } = await supabase
        .from("bookings")
        .select("*")
        .eq("host_id", user.user?.id)
        .order("created_at", { ascending: false });

    const listingIds = Array.from(new Set((bookings || []).map((b) => b.listing_id)));
    const guestIds = Array.from(new Set((bookings || []).map((b) => b.guest_id)));

    const { data: listings } = listingIds.length
        ? await supabase.from("listings").select("id, title, images").in("id", listingIds)
        : { data: [] };

    const { data: guests } = guestIds.length
        ? await supabase.from("profiles").select("id, full_name, preferred_name, email").in("id", guestIds)
        : { data: [] };

    const listingMap = new Map((listings || []).map((l) => [l.id, l]));
    const guestMap = new Map((guests || []).map((g) => [g.id, g]));

    const pending = (bookings || []).filter((b) => b.status === "pending");
    const others = (bookings || []).filter((b) => b.status !== "pending");

    const statusStyles: Record<string, string> = {
        confirmed: "bg-green-100 text-green-800",
        declined: "bg-slate-100 text-slate-500",
        cancelled: "bg-slate-100 text-slate-500",
    };

    const BookingRow = ({ booking, showActions }: { booking: any; showActions: boolean }) => {
        const listing = listingMap.get(booking.listing_id);
        const guest = guestMap.get(booking.guest_id);
        const guestName = guest?.preferred_name || guest?.full_name || guest?.email || "Guest";

        return (
            <div className="border rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-200 flex-shrink-0">
                        {listing?.images?.[0] && (
                            <img src={getImageUrl(listing.images[0])} alt={listing.title} className="w-full h-full object-cover" />
                        )}
                    </div>
                    <div>
                        <div className="font-semibold text-slate-900">{listing?.title || "Listing"}</div>
                        <div className="text-sm text-slate-600">
                            {capitializeFirst(guestName)} · {booking.check_in} → {booking.check_out} · {booking.guests} guest{booking.guests > 1 ? "s" : ""}
                        </div>
                        <div className="text-sm font-medium text-slate-700">£{booking.total_price}</div>
                        <Link href={`/messages/${booking.id}`} className="text-xs font-semibold text-slate-500 underline hover:text-slate-800">
                            Message guest
                        </Link>
                    </div>
                </div>

                {showActions ? (
                    <BookingActions bookingId={booking.id} />
                ) : (
                    <div className="flex items-center gap-3">
                        <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize ${statusStyles[booking.status] || "bg-slate-100 text-slate-600"}`}>
                            {booking.status}
                        </span>
                        {booking.status === "confirmed" && new Date(booking.check_in) >= new Date() && (
                            <BookingActions bookingId={booking.id} mode="confirmed" />
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="max-w-4xl mx-auto px-6 py-10">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-8">Bookings</h1>

            {pending.length > 0 && (
                <div className="mb-10">
                    <h2 className="text-lg font-semibold text-slate-800 mb-4">Awaiting your response</h2>
                    <div className="space-y-4">
                        {pending.map((b) => (
                            <BookingRow key={b.id} booking={b} showActions />
                        ))}
                    </div>
                </div>
            )}

            {others.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold text-slate-800 mb-4">Booking history</h2>
                    <div className="space-y-4">
                        {others.map((b) => (
                            <BookingRow key={b.id} booking={b} showActions={false} />
                        ))}
                    </div>
                </div>
            )}

            {pending.length === 0 && others.length === 0 && (
                <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">No booking requests yet</h3>
                    <p className="text-slate-500 mt-1">Once a guest requests to book, it'll show up here.</p>
                </div>
            )}
        </div>
    );
}
