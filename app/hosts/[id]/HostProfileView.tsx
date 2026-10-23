import Image from 'next/image';
import { Star } from 'lucide-react';
import { getImageUrl } from '@/lib/utils';
import { MIN_PUBLIC_REVIEWS } from '@/lib/reviews';
import ListingCard from '@/components/ListingCard';
import ProviderCard from '@/components/marketplace/ProviderCard';
import ReviewStars from '@/components/ReviewStars';
import ShowAllReviews from '@/components/ShowAllReviews';
import type { HostProfile } from '@/lib/hostProfile';

// The public host profile, Airbnb's shape: a flat identity header (photo, first
// name, how long they've hosted, the combined review score), the host's "About"
// words, a grid of everything they let, and the reviews guests have left them.
//
// Everything here is public by construction — the data comes from
// lib/hostProfile, which never selects a surname, a contact detail or an address
// into what it returns. This component only lays out what it is handed.
//
// The listing/experience grid uses the normal cards, deliberately flat (a browse
// grid is scanned, not acted on — CLAUDE.md). The page sits on the slate-50
// platform tint, same as the listing page.

// A round avatar with an initial fallback — the same treatment the host card
// uses, at profile-header size.
function Avatar({ url, name, size }: { url: string | null; name: string; size: number }) {
    return (
        <div
            className="rounded-full overflow-hidden bg-slate-900 text-white flex items-center justify-center font-semibold flex-shrink-0"
            style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
            {url ? (
                <Image src={getImageUrl(url)} alt={name} width={size} height={size} className="w-full h-full object-cover" />
            ) : (
                name.charAt(0)
            )}
        </div>
    );
}

export default function HostProfileView({ profile }: { profile: HostProfile }) {
    const {
        firstName,
        avatarUrl,
        bio,
        sinceYear,
        monthsHosting,
        ratingCount,
        ratingAvg,
        listings,
        experiences,
        reviews,
    } = profile;

    // How long they've hosted, as the one stat a brand-new host still has.
    const tenure =
        monthsHosting == null
            ? null
            : monthsHosting >= 12
              ? `${Math.floor(monthsHosting / 12)} year${Math.floor(monthsHosting / 12) === 1 ? '' : 's'} hosting`
              : `${Math.max(1, monthsHosting)} month${Math.max(1, monthsHosting) === 1 ? '' : 's'} hosting`;

    const listingCount = listings.length + experiences.length;

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14">
                {/* Identity header — flat, scanned not acted on. */}
                <header className="flex flex-col items-center text-center sm:flex-row sm:items-center sm:text-left sm:gap-8">
                    <Avatar url={avatarUrl} name={firstName} size={128} />
                    <div className="mt-4 sm:mt-0">
                        <h1 className="text-3xl md:text-4xl font-bold text-slate-900">{firstName}</h1>
                        {/* The sublabel is redundant when the host has no name to
                            show and the heading already reads "Host". */}
                        {firstName !== 'Host' && (
                            <p className="mt-1 text-sm font-medium text-slate-500">Host</p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-slate-600 sm:justify-start">
                            {ratingAvg != null && (
                                <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                                    <Star className="h-4 w-4 fill-slate-900 text-slate-900" />
                                    {ratingAvg.toFixed(2)}
                                </span>
                            )}
                            {ratingCount > 0 && (
                                <span>
                                    {ratingCount} review{ratingCount === 1 ? '' : 's'}
                                </span>
                            )}
                            {tenure && <span>{tenure}</span>}
                            {sinceYear && <span>Hosting since {sinceYear}</span>}
                        </div>
                    </div>
                </header>

                {/* About */}
                {bio && (
                    <section className="mt-10 border-t border-slate-200 pt-8">
                        <h2 className="text-xl font-bold text-slate-900">About {firstName}</h2>
                        <p className="mt-3 max-w-2xl text-slate-600 whitespace-pre-line">{bio}</p>
                    </section>
                )}

                {/* Their listings */}
                {listingCount > 0 && (
                    <section className="mt-10 border-t border-slate-200 pt-8">
                        <h2 className="text-xl font-bold text-slate-900">
                            {firstName}&apos;s listing{listingCount === 1 ? '' : 's'}
                        </h2>
                        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            {listings.map((l) => (
                                <ListingCard key={l.id} listing={l} />
                            ))}
                            {experiences.map((p) => (
                                <ProviderCard key={p.id} p={p} href={`/experiences/browse/${p.id}`} />
                            ))}
                        </div>
                    </section>
                )}

                {/* Reviews guests have left the host */}
                <section className="mt-10 border-t border-slate-200 pt-8">
                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        {ratingAvg != null ? (
                            <>
                                <ReviewStars value={Math.round(ratingAvg)} size={18} />
                                {ratingAvg.toFixed(2)} · {ratingCount} review{ratingCount === 1 ? '' : 's'}
                            </>
                        ) : (
                            <>
                                {ratingCount} review{ratingCount === 1 ? '' : 's'}
                            </>
                        )}
                    </h2>

                    {reviews.length === 0 && (
                        <p className="mt-3 text-sm text-slate-600">
                            No reviews yet. Reviews appear here once guests have stayed and reviewed
                            through Galloway Getaways.
                        </p>
                    )}

                    {ratingAvg == null && ratingCount > 0 && (
                        <p className="mt-2 text-sm text-slate-600">
                            An overall score appears once {firstName} has {MIN_PUBLIC_REVIEWS} reviews.
                        </p>
                    )}

                    {reviews.length > 0 && (
                        <div className="mt-6 max-w-2xl">
                            <ShowAllReviews initial={6} className="space-y-5">
                                {reviews.map((r) => (
                                    <div key={r.id} className="border-b pb-5 last:border-0 last:pb-0">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="font-semibold text-slate-900">{r.firstName}</span>
                                            <ReviewStars value={r.rating} size={14} />
                                        </div>
                                        {r.itemName && (
                                            <div className="mb-1 text-xs text-slate-500">{r.itemName}</div>
                                        )}
                                        <p className="text-sm text-slate-700 whitespace-pre-line">{r.comment}</p>
                                    </div>
                                ))}
                            </ShowAllReviews>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
