export const dynamic = "force-dynamic";

import Toast from "@/components/base/Toast";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { getImageUrl } from "@/lib/utils";
import DeleteHomebtn from "@/components/DeleteHomebtn";
import HideListingBtn from "@/components/HideListingBtn";
import Link from "next/link";
import { Eye, Home, Plus } from "lucide-react";

function ListingCard({ item, isDraft }: { item: any; isDraft: boolean }) {
    const editHref = isDraft ? `/addhome?draft=${item.id}` : `/edit-listing/${item.id}`;
    const isHidden = item.status === 'hidden';

    return (
        <div className="relative group">
            <Link href={editHref} className="block">
                <div className="w-full h-56 rounded-2xl overflow-hidden bg-slate-200 relative">
                    {item.images && item.images.length > 0 ? (
                        <img
                            src={getImageUrl(item.images[0])}
                            alt={item.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-slate-400">
                            <Home className="w-10 h-10" />
                        </div>
                    )}
                    <span className={`absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm ${isDraft ? 'bg-amber-100 text-amber-800' : isHidden ? 'bg-slate-200 text-slate-700' : 'bg-white/95'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isDraft ? 'bg-amber-500' : isHidden ? 'bg-slate-500' : 'bg-green-500'}`} />
                        {isDraft ? 'In progress' : isHidden ? 'Hidden' : 'Listed'}
                    </span>
                </div>
                <h3 className="font-semibold text-slate-900 mt-3 truncate">{item.title || 'Untitled listing'}</h3>
                <p className="text-sm text-slate-500 truncate">{item.location || 'No location yet'}</p>
                {!isDraft && (
                    <p className="text-sm font-medium text-slate-700 mt-0.5">£{item.price_per_night} / night</p>
                )}
                {isDraft && (
                    <p className="text-sm font-medium text-amber-700 mt-0.5">Click to finish setting up</p>
                )}
                {isHidden && (
                    <p className="text-sm font-medium text-slate-600 mt-0.5">
                        Not taking new bookings
                    </p>
                )}
            </Link>

            <div className="absolute top-3 right-3 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                {!isDraft && !isHidden && (
                    <Link
                        href={`/homes/${item.id}`}
                        title="See how guests see it"
                        className="h-8 px-3 rounded-full bg-white/95 hover:bg-white shadow-sm flex items-center gap-1.5 text-xs font-semibold text-slate-700"
                    >
                        <Eye className="w-3.5 h-3.5" />
                        View
                    </Link>
                )}
                {!isDraft && (
                    <HideListingBtn id={item.id} hidden={isHidden} title={item.title} />
                )}
                <DeleteHomebtn id={item.id} />
            </div>
        </div>
    );
}

export default async function Dashboard() {
    const serverSupabase = createServerComponentClient({ cookies });
    const { data: user } = await serverSupabase.auth.getUser();
    const { data: homes } = await serverSupabase
        .from("listings")
        .select("id, images, title, location, price_per_night, created_at, status")
        .eq("host_id", user.user?.id)
        .order("created_at", { ascending: false });

    const published = homes?.filter((h) => h.status === 'published' || h.status === 'hidden') || [];
    const drafts = homes?.filter((h) => h.status === 'draft') || [];

    return (
        <div>
            <Toast />
            <div className="max-w-7xl mx-auto px-6 py-10">
                <div className="flex items-center justify-between mb-8">
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Your listings</h1>
                    <Link
                        href="/addhome"
                        title="Create a new listing"
                        className="w-10 h-10 rounded-full border border-slate-300 hover:bg-slate-100 flex items-center justify-center text-slate-800 transition flex-shrink-0"
                    >
                        <Plus className="w-5 h-5" />
                    </Link>
                </div>

                {drafts.length > 0 && (
                    <div className="mb-10">
                        <h2 className="text-lg font-semibold text-slate-800 mb-4">In progress</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {drafts.map((item) => (
                                <ListingCard key={item.id} item={item} isDraft />
                            ))}
                        </div>
                    </div>
                )}

                {published.length > 0 && (
                    <div>
                        {drafts.length > 0 && <h2 className="text-lg font-semibold text-slate-800 mb-4">Published</h2>}
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {published.map((item) => (
                                <ListingCard key={item.id} item={item} isDraft={false} />
                            ))}
                        </div>
                    </div>
                )}

                {published.length === 0 && drafts.length === 0 && (
                    <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                        <h3 className="text-lg font-semibold text-slate-800">No listings yet</h3>
                        <p className="text-slate-500 mt-1 mb-5">Add your first property to start taking bookings.</p>
                        <Link
                            href="/addhome"
                            className="inline-flex items-center px-5 py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg transition"
                        >
                            <Plus className="w-4 h-4 mr-2" /> Create a listing
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
