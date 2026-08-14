export const dynamic = "force-dynamic";

import Toast from "@/components/base/Toast";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { getImageUrl } from "@/lib/utils";
import DeleteHomebtn from "@/components/DeleteHomebtn";
import Link from "next/link";
import { Eye, Home } from "lucide-react";

export default async function Dashboard() {
    const serverSupabase = createServerComponentClient({ cookies });
    const { data: user } = await serverSupabase.auth.getUser();
    const { data: homes } = await serverSupabase
        .from("listings")
        .select("id, images, title, location, price_per_night, created_at")
        .eq("host_id", user.user?.id)
        .order("created_at", { ascending: false });

    return (
        <div>
            <Toast />
            <div className="max-w-7xl mx-auto px-6 py-10">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-8">Your listings</h1>

                {homes && homes.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {homes.map((item) => (
                            <div key={item.id} className="relative group">
                                <Link href={`/edit-listing/${item.id}`} className="block">
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
                                        <span className="absolute top-3 left-3 bg-white/95 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Listed
                                        </span>
                                    </div>
                                    <h3 className="font-semibold text-slate-900 mt-3 truncate">{item.title}</h3>
                                    <p className="text-sm text-slate-500 truncate">{item.location}</p>
                                    <p className="text-sm font-medium text-slate-700 mt-0.5">£{item.price_per_night} / night</p>
                                </Link>

                                <div className="absolute top-3 right-3 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                                    <Link
                                        href={`/homes/${item.id}`}
                                        title="View live listing"
                                        className="w-8 h-8 rounded-full bg-white/95 shadow-sm flex items-center justify-center text-slate-700 hover:text-slate-900"
                                    >
                                        <Eye className="w-4 h-4" />
                                    </Link>
                                    <DeleteHomebtn id={item.id} />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                        <h3 className="text-lg font-semibold text-slate-800">No listings yet</h3>
                        <p className="text-slate-500 mt-1">Click "Become a host" to publish your first property.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
