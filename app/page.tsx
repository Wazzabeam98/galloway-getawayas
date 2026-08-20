import Hero from '@/components/base/Hero';
import UpcomingTrip from '@/components/UpcomingTrip';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getImageUrl } from '@/lib/utils';
import Link from 'next/link';
import { Home, Star } from 'lucide-react';

export const dynamic = 'force-dynamic';

// Some listings store a full street address in `location`, others store only
// the town and region. Guests should never see the street, so the first part
// is dropped only when it actually looks like one — a house number, or a
// street-type word. "Kirkcudbright, Dumfries and Galloway" is left alone.
const STREET_WORDS = [
  'street', 'st', 'road', 'rd', 'lane', 'avenue', 'ave', 'drive', 'close',
  'place', 'terrace', 'court', 'crescent', 'way', 'row', 'gardens', 'park',
  'square', 'wynd', 'brae', 'vennel', 'loan', 'view', 'grove', 'walk',
];

function looksLikeStreet(part: string): boolean {
  const clean = part.trim().toLowerCase();
  if (!clean) return false;
  // Starts with a house number, e.g. "28" or "57 St Cuthbert Street" or "Flat 2".
  if (/^[0-9]/.test(clean)) return true;
  if (/^(flat|apt|apartment|unit)\b/.test(clean)) return true;
  // Ends in a street-type word.
  const words = clean.replace(/[.,]/g, '').split(/\s+/);
  const last = words[words.length - 1];
  return words.length > 1 && STREET_WORDS.indexOf(last) !== -1;
}

function publicArea(location: string | null): string {
  if (!location) return 'Dumfries & Galloway';
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return location;

  // Drop every leading street-ish part, so "28, Millburn Street, Kirkcudbright"
  // loses both the number and the street. Never strips the last two parts.
  let start = 0;
  while (start < parts.length - 2 && looksLikeStreet(parts[start])) {
    start = start + 1;
  }
  if (start < parts.length - 1 && looksLikeStreet(parts[start])) {
    start = start + 1;
  }

  const kept = parts.slice(start);
  return kept.length ? kept.join(', ') : location;
}

export default async function HomePage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: listings } = await supabase
    .from('listings')
    .select('id, title, location, price_per_night, images, rating_avg, rating_count')
    .eq('status', 'published')
    .order('created_at', { ascending: false });

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Kirkcudbright Hero Banner */}
      <Hero />

      {/* Someone with a stay coming up sees it before anything else. Returns
          nothing at all for a signed-out visitor or a guest with no booking. */}
      <UpcomingTrip />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Section Heading */}
        <div className="mb-10 border-b border-stone-200 pb-4">
          <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
            Our Properties
          </h2>
          <p className="text-stone-600 text-sm md:text-base mt-1">
            Handpicked holiday rentals in Dumfries &amp; Galloway
          </p>
        </div>

        {/* Property Grid */}
        {listings && listings.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
            {listings.map((property) => {
              const rating = property.rating_avg ? Number(property.rating_avg) : null;
              const count = property.rating_count || 0;

              return (
                <Link
                  key={property.id}
                  href={`/homes/${property.id}`}
                  className="group flex flex-col space-y-2"
                >
                  <div className="w-full h-64 rounded-2xl overflow-hidden bg-stone-200 relative">
                    {property.images && property.images.length > 0 ? (
                      <img
                        src={getImageUrl(property.images[0])}
                        alt={property.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-stone-400">
                        <Home className="w-10 h-10" />
                      </div>
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-stone-900 text-base truncate">
                      {property.title}
                    </h3>

                    {rating && count > 0 ? (
                      <span className="flex items-center gap-1 text-sm text-stone-900 shrink-0">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        <span className="font-semibold">{rating.toFixed(2)}</span>
                        <span className="text-stone-400 font-normal">({count})</span>
                      </span>
                    ) : (
                      <span className="text-xs text-emerald-700 font-semibold shrink-0 mt-0.5">
                        New
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-stone-500 truncate">
                    {publicArea(property.location)}
                  </p>
                  <p className="text-sm font-semibold text-stone-900">
                    £{property.price_per_night} <span className="font-normal text-stone-500">night</span>
                  </p>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-stone-200">
            <h3 className="text-lg font-semibold text-stone-800">
              No properties listed yet
            </h3>
            <p className="text-stone-500 mt-1 max-w-md mx-auto">
              Ready to list your Kirkcudbright holiday stay? Click <strong>Add homes</strong> in the top menu to publish your first property!
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
