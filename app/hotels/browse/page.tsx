import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminClient } from '@/lib/supabaseAdmin';
import { getImageUrl } from '@/lib/utils';
import { hotelsOpen } from '@/lib/hotels';
import { Star, MapPin } from 'lucide-react';

export const dynamic = 'force-dynamic';

// This is a public page that will be offered to Google once hotels launch; name
// its own canonical (the root layout supplies none). Until the flag is on in
// production the page 404s there, so nothing is indexed early.
export const metadata = { alternates: { canonical: '/hotels/browse' } };

// The hotel browse grid — the hotel twin of /holiday-cottages. Browse grids are
// deliberately FLAT (not lifted): content you scan, not a surface you act on.
// Rendered server-side with the service role, published hotels only. Held behind
// hotelsOpen().
export default async function HotelsBrowsePage() {
    if (!hotelsOpen()) notFound();

    const admin = adminClient();
    const { data: hotels } = await admin
        .from('hotels')
        .select('id, name, star_rating, property_type, location, images')
        .eq('status', 'published')
        .order('created_at', { ascending: false });

    // The cheapest room per hotel, for a "from £…" line.
    const ids = (hotels || []).map((h: any) => h.id);
    const fromPrice: Record<string, number> = {};
    if (ids.length) {
        const { data: rooms } = await admin
            .from('hotel_room_types')
            .select('hotel_id, price_per_night')
            .in('hotel_id', ids)
            .eq('active', true);
        (rooms || []).forEach((r: any) => {
            const p = Number(r.price_per_night);
            if (!(r.hotel_id in fromPrice) || p < fromPrice[r.hotel_id]) fromPrice[r.hotel_id] = p;
        });
    }

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Hotels in Dumfries &amp; Galloway</h1>
                <p className="mt-1 text-slate-600">Rooms you can book direct — no platform fee.</p>

                {(hotels || []).length === 0 ? (
                    <p className="mt-10 text-slate-600">No hotels yet. Check back soon.</p>
                ) : (
                    <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {(hotels || []).map((h: any) => {
                            const cover = (h.images || []).filter(Boolean)[0];
                            return (
                                <Link key={h.id} href={`/hotels/${h.id}`} className="group block">
                                    <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-100">
                                        {cover && <img src={getImageUrl(cover)} alt={h.name} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />}
                                    </div>
                                    <div className="mt-2">
                                        <div className="flex items-center gap-1.5">
                                            <h2 className="font-semibold text-slate-900">{h.name}</h2>
                                            {h.star_rating ? (
                                                <span className="inline-flex items-center text-amber-500">
                                                    {Array.from({ length: h.star_rating }).map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}
                                                </span>
                                            ) : null}
                                        </div>
                                        {h.location && <p className="inline-flex items-center gap-1 text-sm text-slate-600"><MapPin className="h-3.5 w-3.5" /> {h.location}</p>}
                                        {h.id in fromPrice && <p className="mt-0.5 text-sm text-slate-800"><span className="font-semibold">from £{fromPrice[h.id].toFixed(0)}</span> / night</p>}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </main>
    );
}
