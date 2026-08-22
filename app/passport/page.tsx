import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { townOf, townKey } from '@/lib/places';
import TownStamp from '@/components/stamps/TownStamp';
import { formatUk } from '@/lib/cancellation';

export const dynamic = 'force-dynamic';

// Worked out from completed stays rather than stored anywhere. Nothing to
// keep in step, nothing to backfill, and a cancelled stay can't leave a stamp
// behind it.
export default async function PassportPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getSession();

    if (!auth || !auth.session || !auth.session.user) redirect('/');

    const today = new Date().toISOString().split('T')[0];

    const { data: bookings } = await supabase
        .from('bookings')
        .select('id, listing_id, check_in, check_out, status')
        .eq('guest_id', auth.session.user.id)
        .eq('status', 'confirmed')
        .lt('check_out', today)
        .order('check_out', { ascending: false });

    const stays = bookings || [];

    const listingIds = Array.from(new Set(stays.map((b: any) => b.listing_id)));

    const { data: listings } = listingIds.length
        ? await supabase.from('listings').select('id, title, location').in('id', listingIds)
        : { data: [] };

    const listingMap: Record<string, any> = {};
    (listings || []).forEach((l: any) => {
        listingMap[l.id] = l;
    });

    const stamps: Record<string, any> = {};

    stays.forEach((b: any) => {
        const listing = listingMap[b.listing_id];
        if (!listing) return;

        const key = townKey(listing.location);
        if (!key) return;

        if (!stamps[key]) {
            stamps[key] = {
                town: townOf(listing.location),
                // Kept so the stamp artwork can be looked up the same way
                // the grouping was.
                location: listing.location,
                visits: 0,
                nights: 0,
                first: b.check_out,
                last: b.check_out,
                places: [] as string[],
            };
        }

        const s = stamps[key];
        s.visits += 1;
        s.nights += Math.round(
            (new Date(b.check_out).getTime() - new Date(b.check_in).getTime()) / 86400000
        );
        if (b.check_out < s.first) s.first = b.check_out;
        if (b.check_out > s.last) s.last = b.check_out;
        if (listing.title && s.places.indexOf(listing.title) === -1) s.places.push(listing.title);
    });

    const collected = Object.keys(stamps)
        .map((k) => stamps[k])
        .sort((a, b) => (a.first < b.first ? -1 : 1));

    const totalNights = collected.reduce((sum, s) => sum + s.nights, 0);

    return (
        <div className="max-w-3xl mx-auto px-6 py-12">
            <h1 className="text-2xl md:text-3xl font-bold text-stone-900 mb-1">Your passport</h1>
            <p className="text-stone-600 mb-10">
                A stamp for every place in Dumfries &amp; Galloway you&apos;ve stayed with us.
            </p>

            {collected.length === 0 ? (
                <div className="border rounded-2xl p-10 text-center">
                    <div className="text-5xl mb-4">&#9906;</div>
                    <h2 className="font-bold text-stone-900 mb-1">No stamps yet</h2>
                    <p className="text-stone-600 mb-6">
                        Your first stamp arrives once you&apos;ve stayed somewhere. There are more
                        towns and villages down here than most people expect.
                    </p>
                    <Link
                        href="/"
                        className="px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl inline-block"
                    >
                        Find somewhere to stay
                    </Link>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-3 gap-4 mb-10">
                        <div className="border rounded-2xl p-5 text-center">
                            <div className="text-3xl font-bold text-emerald-700">
                                {collected.length}
                            </div>
                            <div className="text-xs text-stone-500 mt-1">
                                {collected.length === 1 ? 'place' : 'places'}
                            </div>
                        </div>
                        <div className="border rounded-2xl p-5 text-center">
                            <div className="text-3xl font-bold text-stone-900">
                                {stays.length}
                            </div>
                            <div className="text-xs text-stone-500 mt-1">
                                {stays.length === 1 ? 'stay' : 'stays'}
                            </div>
                        </div>
                        <div className="border rounded-2xl p-5 text-center">
                            <div className="text-3xl font-bold text-stone-900">{totalNights}</div>
                            <div className="text-xs text-stone-500 mt-1">
                                {totalNights === 1 ? 'night' : 'nights'}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {collected.map((s) => (
                            <div
                                key={s.town}
                                className="border-2 border-dashed border-emerald-200 rounded-2xl p-5 bg-emerald-50/40"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-shrink-0 text-emerald-700">
                                        <TownStamp location={s.location} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-bold text-stone-900 text-lg truncate">
                                            {s.town}
                                        </div>
                                        <div className="text-xs text-stone-500 mt-0.5">
                                            {s.visits === 1
                                                ? 'Stayed ' + formatUk(new Date(s.first))
                                                : s.visits + ' stays, most recently ' + formatUk(new Date(s.last))}
                                        </div>
                                    </div>
                                    {s.visits > 1 && (
                                        <span className="flex-shrink-0 text-xs font-bold text-emerald-800 bg-emerald-100 rounded-full px-2.5 py-1">
                                            &times;{s.visits}
                                        </span>
                                    )}
                                </div>

                                <div className="text-xs text-stone-500 mt-3 truncate">
                                    {s.places.join(' · ')}
                                </div>
                            </div>
                        ))}
                    </div>

                    <p className="text-sm text-stone-500 mt-10">
                        Stamps appear after you check out. Somewhere new next time?{' '}
                        <Link href="/" className="underline hover:text-stone-800">
                            Have a look
                        </Link>
                        .
                    </p>
                </>
            )}
        </div>
    );
}
