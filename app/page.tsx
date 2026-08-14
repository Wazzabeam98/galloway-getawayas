import Hero from '@/components/base/Hero';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getImageUrl } from '@/lib/utils';
import Link from 'next/link';
import { Home } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: listings } = await supabase
    .from('listings')
    .select('id, title, location, price_per_night, images')
    .order('created_at', { ascending: false });

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Kirkcudbright Hero Banner */}
      <Hero />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Section Heading */}
        <div className="mb-8 border-b border-stone-200 pb-4">
          <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
            Our Properties
          </h2>
          <p className="text-stone-600 text-sm md:text-base mt-1">
            Handpicked holiday rentals in Dumfries & Galloway
          </p>
        </div>

        {/* Property Grid */}
        {listings && listings.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {listings.map((property) => (
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
                <h3 className="font-bold text-stone-900 text-base truncate">{property.location}</h3>
                <p className="text-sm text-stone-500 truncate">{property.title}</p>
                <p className="text-sm font-semibold text-stone-900">
                  £{property.price_per_night} <span className="font-normal text-stone-500">night</span>
                </p>
              </Link>
            ))}
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
