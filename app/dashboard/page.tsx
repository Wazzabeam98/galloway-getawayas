export const dynamic = "force-dynamic";

import Toast from "@/components/base/Toast";
import TemplateGapWarning from "@/components/TemplateGapWarning";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { getImageUrl } from "@/lib/utils";
import { publicArea } from "@/lib/places";
import DeleteHomebtn from "@/components/DeleteHomebtn";
import { createClient } from "@supabase/supabase-js";
import { accessibleListings } from "@/lib/access";
import LeaveListingBtn from "@/components/LeaveListingBtn";
import HideListingBtn from "@/components/HideListingBtn";
import Link from "next/link";
import { Eye, Home, Plus } from "lucide-react";

function ListingCard({ item, isDraft }: { item: any; isDraft: boolean }) {
    const editHref = isDraft ? `/addhome?draft=${item.id}` : `/edit-listing/${item.id}`;
    const isHidden = item.status === 'hidden';
    // Finished, sent, and waiting for an owner to look at it. Nothing writes
    // this status yet — the screens learn it before the data can hold it, so
    // that a host can never press Submit and watch their property disappear
    // off their own dashboard.
    const isWaiting = item.status === 'pending_review';
    // A draft with a note on it was returned by an owner with something to fix.
    // A draft without one was simply never finished.
    const sentBack = isDraft && !!item.review_note;

    const pillTone = isDraft
        ? 'bg-amber-100 text-amber-800'
        : isWaiting ? 'bg-sky-100 text-sky-900'
        : isHidden ? 'bg-slate-200 text-slate-700'
        : 'bg-white/95';

    const dotTone = isDraft
        ? 'bg-amber-500'
        : isWaiting ? 'bg-sky-600'
        : isHidden ? 'bg-slate-500'
        : 'bg-green-500';

    const pillLabel = isDraft
        ? (sentBack ? 'Needs changes' : 'In progress')
        : isWaiting ? 'Waiting for approval'
        : isHidden ? 'Hidden'
        : 'Listed';

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
                    <span className={`absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm ${pillTone}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${dotTone}`} />
                        {pillLabel}
                    </span>
                </div>
                <h3 className="font-semibold text-slate-900 mt-3 truncate">{item.title || 'Untitled listing'}</h3>
                <p className="text-sm text-slate-500 truncate">{item.location ? publicArea(item.location) : 'No location yet'}</p>
                {!isDraft && (
                    <p className="text-sm font-medium text-slate-700 mt-0.5">£{item.price_per_night} / night</p>
                )}
                {isDraft && !sentBack && (
                    <p className="text-sm font-medium text-amber-700 mt-0.5">Click to finish setting up</p>
                )}
                {/* A draft carrying a review note was sent back, not abandoned.
                    Saying only "click to finish setting up" to somebody whose
                    listing we returned is how they read it as their own
                    forgetfulness and never find out what we asked for. */}
                {sentBack && (
                    <p className="text-sm font-medium text-amber-800 mt-0.5">
                        Sent back: {item.review_note}
                    </p>
                )}
                {isWaiting && (
                    <p className="text-sm font-medium text-sky-800 mt-0.5">
                        We&apos;re checking it over — nothing more for you to do
                    </p>
                )}
                {isHidden && (
                    <p className="text-sm font-medium text-slate-600 mt-0.5">
                        Not taking new bookings
                    </p>
                )}
            </Link>

            <div className="absolute top-3 right-3 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                {!isDraft && !isHidden && !isWaiting && (
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
    const access = await accessibleListings(user.user?.id || '');
    const ownedIds = access.filter((a) => a.isOwner).map((a) => a.listingId);
    const helpingIds = access.filter((a) => !a.isOwner).map((a) => a.listingId);

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const allIds = ownedIds.concat(helpingIds);

    const { data: homes } = allIds.length
        ? await admin
            .from("listings")
            .select("id, images, title, location, price_per_night, created_at, status, review_note")
            .in("id", allIds)
            .order("created_at", { ascending: false })
        : { data: [] };

    const owned = (homes || []).filter((h) => ownedIds.indexOf(h.id) !== -1);
    const helping = (homes || []).filter((h) => helpingIds.indexOf(h.id) !== -1);

    const accessIdOf = (listingId: string) =>
        access.find((a) => a.listingId === listingId && !a.isOwner)?.accessId || null;

    // Every status a host owns has to land in one of these, or the listing
    // simply is not on their dashboard. 'pending_review' belongs with the live
    // ones rather than with drafts: the host has finished it and there is
    // nothing left for them to do, which is the opposite of what "In progress"
    // says.
    const published = owned.filter(
        (h) => h.status === 'published' || h.status === 'hidden' || h.status === 'pending_review'
    );
    const drafts = owned.filter((h) => h.status === 'draft');

    return (
        <div>
            <Toast />
            {/* Only shows when a guest is actually arriving somewhere with no
                check-in message. The settings grid answers "is anything
                missing"; this answers "is it about to matter". */}
            <TemplateGapWarning />
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

                {helping.length > 0 && (
                    <div className="mt-14">
                        <h2 className="text-xl font-bold text-slate-900 mb-1">
                            Properties you help with
                        </h2>
                        <p className="text-sm text-slate-500 mb-6">
                            These belong to someone else. What you can do with each depends on what
                            they&apos;ve given you.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                            {helping.map((item) => (
                                <div key={item.id} className="relative group">
                                    <Link href={`/homes/${item.id}`} className="block">
                                        <div className="w-full h-56 rounded-2xl overflow-hidden bg-slate-200 relative">
                                            {item.images && item.images.length > 0 ? (
                                                <img
                                                    src={getImageUrl(item.images[0])}
                                                    alt={item.title}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-400">
                                                    <Home className="w-10 h-10" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="mt-3">
                                            <h3 className="font-bold text-slate-900 truncate">
                                                {item.title}
                                            </h3>
                                            <p className="text-slate-500 text-sm truncate">
                                                {publicArea(item.location)}
                                            </p>
                                        </div>
                                    </Link>
                                    {accessIdOf(item.id) && (
                                        <LeaveListingBtn
                                            accessId={accessIdOf(item.id) as string}
                                            title={item.title}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

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
