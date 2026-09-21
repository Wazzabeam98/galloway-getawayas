'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { ArrowLeft, ChevronRight, Star } from 'lucide-react';
import { partyLabel } from '@/lib/bookingDisplay';
import ExperiencesTeaser from '@/components/ExperiencesTeaser';
import ReviewPrompts from '@/components/ReviewPrompts';
import { getImageUrl, capitializeFirst, displayName } from '@/lib/utils';
import Link from 'next/link';
import { londonDayKey } from '@/lib/dayKey';
import { liveForGuestCard, stayCountdown } from '@/lib/bookingWindows';
import { compareTripsByStart } from '@/lib/bookingOrder';

// Your trips — a LIST now, not a stack of expanding cards. Each row is a compact
// card that links to the stay's own reservation page (/trips/[bookingId]), the
// holiday-let counterpart to the experience order page. The whole reservation —
// where you'll be, who's coming, the money, the actions — lives on that page;
// this screen is the index onto it.

interface Booking {
    id: string;
    listing_id: string;
    host_id: string;
    check_in: string;
    check_out: string;
    status: string;
    payment_status: string | null;
    guests?: number | null;
    adults?: number | null;
    children?: number | null;
    pets?: number | null;
    sharedWithMe?: boolean;
}

export default function TripsPage() {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [listingMap, setListingMap] = useState<Record<string, any>>({});
    const [hostNames, setHostNames] = useState<Record<string, string>>({});
    const [showPast, setShowPast] = useState(false);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);
            if (!session?.user) { setLoading(false); return; }

            // Fetched on the server so trips shared with this person come through
            // too — and so the money is stripped from those before it ever reaches
            // the browser. The compact card needs none of the arrival detail the
            // route also returns; that lives on the reservation page.
            const tripsRes = await fetch('/api/trips');
            const bookingRows: Booking[] = tripsRes.ok ? ((await tripsRes.json()).trips || []) : [];
            setBookings(bookingRows);

            const listingIds = Array.from(new Set((bookingRows || []).map((b) => b.listing_id)));
            if (listingIds.length) {
                const { data: listings } = await supabase
                    .from('listings')
                    .select('id, title, images, location, rating_avg, rating_count')
                    .in('id', listingIds);
                const map: Record<string, any> = {};
                (listings || []).forEach((l) => { map[l.id] = l; });
                setListingMap(map);
            }

            const hostIds = Array.from(new Set((bookingRows || []).map((b) => b.host_id)));
            if (hostIds.length) {
                const { data: hosts } = await supabase.from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', hostIds);
                const names: Record<string, string> = {};
                (hosts || []).forEach((h) => { names[h.id] = displayName(h, 'Host'); });
                setHostNames(names);
            }

            setLoading(false);
        };
        load();
    }, [supabase]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
                <Logo />
                <p className="text-slate-500 animate-pulse">Loading your trips...</p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-6 text-center px-4">
                <Logo />
                <h1 className="text-2xl font-bold text-slate-900">Sign in to see your trips</h1>
                <LoginModel />
            </div>
        );
    }

    const today = new Date();
    const statusStyles: Record<string, string> = {
        confirmed: 'bg-green-100 text-green-800',
        pending: 'bg-amber-100 text-amber-800',
        declined: 'bg-slate-100 text-slate-500',
        cancelled: 'bg-slate-100 text-slate-500',
    };

    // Upcoming means a stay that could still happen — the same liveForGuestCard
    // test the home card and the reservation page use, so the three screens agree.
    const isOver = (b: Booking) => !liveForGuestCard(b, today);
    const upcoming = bookings.filter((b) => !isOver(b)).sort(compareTripsByStart);
    const past = bookings.filter(isOver).sort((a, b) => (a.check_out > b.check_out ? -1 : 1));

    const todayIso = londonDayKey();
    const hasCompletedStay = bookings.some((b) => !b.sharedWithMe && b.status === 'confirmed' && b.check_out < todayIso);

    const fmtDay = (s: string) => {
        const d = new Date(String(s).slice(0, 10) + 'T12:00:00');
        return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    };

    // One compact card, a link to the stay's reservation page. Lifted to match
    // the card family (soft shadow, hairline border, radius) — this is a surface
    // you act on, so it earns the lift.
    const renderTrip = (b: Booking) => {
        const listing = listingMap[b.listing_id];
        const hostName = capitializeFirst(hostNames[b.host_id] || 'your host');
        const hostFirstName = hostName.split(' ')[0];
        const countdown = liveForGuestCard(b, today) ? stayCountdown(b, today) : null;
        const phase = countdown?.phase ?? null;
        const phaseChip = phase === 'during' ? 'You’re here'
            : phase === 'today' ? 'You arrive today'
                : phase === 'tomorrow' ? 'You arrive tomorrow' : null;

        return (
            <Link
                key={b.id}
                href={`/trips/${b.id}`}
                className="group flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)] transition hover:border-slate-300 sm:p-5"
            >
                <div className="relative h-20 w-20 flex-none overflow-hidden rounded-xl bg-slate-200 sm:h-24 sm:w-24">
                    {listing?.images?.[0] && (
                        <Image src={getImageUrl(listing.images[0])} alt={listing.title} fill sizes="96px" className="object-cover" />
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-900 group-hover:underline">{listing?.title || 'Listing'}</div>
                            <div className="mt-0.5 text-sm text-slate-600">
                                Hosted by {hostFirstName} · {fmtDay(b.check_in)} – {fmtDay(b.check_out)}
                            </div>
                            {listing && Number(listing.rating_count) >= 3 && (
                                <div className="mt-1 inline-flex items-center gap-1 text-sm">
                                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                    <span className="font-medium text-slate-900">{Number(listing.rating_avg).toFixed(1)}</span>
                                    <span className="text-slate-500">· {listing.rating_count} review{Number(listing.rating_count) === 1 ? '' : 's'}</span>
                                </div>
                            )}
                        </div>
                        <ChevronRight className="mt-1 h-5 w-5 flex-none text-slate-300 transition group-hover:text-slate-500" />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusStyles[b.status] || 'bg-slate-100 text-slate-600'}`}>
                            {b.status}
                        </span>
                        {phaseChip && (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">{phaseChip}</span>
                        )}
                        {partyLabel(b) && <span className="text-xs text-slate-500">{partyLabel(b)}</span>}
                        {b.sharedWithMe && <span className="text-xs text-slate-400">Shared with you</span>}
                    </div>
                </div>
            </Link>
        );
    };

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 mb-4">
                <ArrowLeft className="h-4 w-4" /> Home
            </Link>
            <div className="flex items-baseline justify-between gap-4 flex-wrap mb-8">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Your trips</h1>
                {hasCompletedStay && (
                    <Link href="/passport" className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 underline">Your passport</Link>
                )}
            </div>

            {/* The review prompt, on the index rather than an order page. Renders
                nothing when there is nothing to review. */}
            <ReviewPrompts />

            {bookings.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">No trips yet</h3>
                    <p className="text-slate-500 mt-1">Once you book a stay, it'll show up here.</p>
                </div>
            ) : (
                <>
                    {upcoming.length > 0 ? (
                        <div className="space-y-4">{upcoming.map(renderTrip)}</div>
                    ) : (
                        <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
                            <h3 className="text-lg font-semibold text-slate-800">Nothing booked at the moment</h3>
                            <p className="text-slate-500 mt-1">Your past trips are below.</p>
                        </div>
                    )}

                    {past.length > 0 && (
                        <div className="mt-12">
                            <div className="flex justify-center">
                                <button
                                    type="button"
                                    onClick={() => setShowPast((o) => !o)}
                                    aria-expanded={showPast}
                                    className="inline-flex items-center rounded-lg border border-slate-900/10 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
                                >
                                    {showPast ? 'Hide past trips' : 'Past trips'}
                                </button>
                            </div>
                            {showPast && <div className="mt-6 space-y-4">{past.map(renderTrip)}</div>}
                        </div>
                    )}

                    <ExperiencesTeaser bookingId={bookings[0].id} />
                </>
            )}
        </div>
    );
}
